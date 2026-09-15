// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IForgeMarketAdapter, TokenLifecycle} from "./interfaces/IForgeMarketAdapter.sol";
import {IPonsV2, IPonsV2BondingCurve, IPoolManager, IUnlockCallback} from "./interfaces/IPonsV2.sol";

/// @notice State-aware market adapter that dynamically routes swaps between PONS bonding curve and migrated Uniswap V4 pool.
contract PonsMarketAdapterV2 is IForgeMarketAdapter, IUnlockCallback, ReentrancyGuard {
    bytes32 private activeUnlock;
    using SafeERC20 for IERC20;

    IPonsV2 public immutable ponsFactory;
    address public immutable poolManager;
    address public immutable memeHook;

    error MarketNotAvailable();
    error SlippageExceeded(uint256 actual, uint256 minimum);
    error UnauthorizedUnlock();
    error TransferFailed();
    error QuoteResult(uint256 amountOut);

    event MarketSwapExecuted(
        address indexed token, TokenLifecycle lifecycle, uint256 ethIn, uint256 tokensOut, address recipient
    );

    constructor(address ponsFactory_, address poolManager_, address memeHook_) {
        require(ponsFactory_.code.length > 0, "Invalid factory");
        require(
            poolManager_ == address(0) || poolManager_ == IPonsV2(ponsFactory_).poolManager(), "Noncanonical manager"
        );
        require(memeHook_ == address(0) || memeHook_ == IPonsV2(ponsFactory_).memeHook(), "Noncanonical hook");
        ponsFactory = IPonsV2(ponsFactory_);
        poolManager = poolManager_ != address(0) ? poolManager_ : IPonsV2(ponsFactory_).poolManager();
        memeHook = memeHook_ != address(0) ? memeHook_ : IPonsV2(ponsFactory_).memeHook();
    }

    receive() external payable {}

    function getTokenLifecycle(address token) public view override returns (TokenLifecycle) {
        IPonsV2.LaunchedToken memory launch = ponsFactory.getLaunchedToken(token);
        if (!launch.exists || launch.token != token || launch.pairToken != address(0)) return TokenLifecycle.UNKNOWN;

        if (launch.phase == 0) {
            if (launch.curve == address(0)) return TokenLifecycle.UNKNOWN;
            if (IPonsV2BondingCurve(launch.curve).readyToGraduate() || IPonsV2BondingCurve(launch.curve).graduated()) {
                return TokenLifecycle.GRADUATED;
            }
            return TokenLifecycle.BONDING;
        } else if (launch.phase == 1) {
            return TokenLifecycle.GRADUATED;
        } else if (launch.phase == 2) {
            return TokenLifecycle.MIGRATED;
        } else {
            return TokenLifecycle.UNKNOWN;
        }
    }

    function getBondingMarket(address token) external view override returns (address) {
        return ponsFactory.getLaunchedToken(token).curve;
    }

    function getMigratedMarket(address token)
        public
        view
        override
        returns (bytes32 poolId, address poolManager_, address hook_)
    {
        IPoolManager.PoolKey memory key = _getPoolKey(token);
        poolId = keccak256(abi.encode(key));
        return (poolId, poolManager, memeHook);
    }

    function _getPoolKey(address token) internal view returns (IPoolManager.PoolKey memory) {
        IPonsV2.LaunchedToken memory launch = ponsFactory.getLaunchedToken(token);
        (address c0, address c1) = address(0) < token ? (address(0), token) : (token, address(0));
        return IPoolManager.PoolKey({
            currency0: c0, currency1: c1, fee: launch.poolFee, tickSpacing: launch.tickSpacing, hooks: memeHook
        });
    }

    function canBuy(address token) public view override returns (bool) {
        TokenLifecycle lifecycle = getTokenLifecycle(token);
        if (lifecycle == TokenLifecycle.BONDING) {
            address curve = ponsFactory.getLaunchedToken(token).curve;
            return !IPonsV2BondingCurve(curve).graduated() && !IPonsV2BondingCurve(curve).readyToGraduate();
        } else if (lifecycle == TokenLifecycle.MIGRATED) {
            return poolManager != address(0);
        }
        return false;
    }

    function quoteBuy(address token, uint256 amountIn) external override nonReentrant returns (uint256 amountOut) {
        return _quoteBuy(token, amountIn, msg.sender);
    }

    function quoteBuyForRecipient(address token, uint256 amountIn, address recipient)
        external
        nonReentrant
        returns (uint256)
    {
        return _quoteBuy(token, amountIn, recipient);
    }

    function _quoteBuy(address token, uint256 amountIn, address recipient) private returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        TokenLifecycle lifecycle = getTokenLifecycle(token);
        if (lifecycle == TokenLifecycle.BONDING) {
            address curveAddr = ponsFactory.getLaunchedToken(token).curve;
            IPonsV2BondingCurve curve = IPonsV2BondingCurve(curveAddr);
            (uint256 quoteReserve, uint256 tokenReserve) = curve.getReserves();
            if (quoteReserve == 0 || tokenReserve == 0) return 0;

            uint256 feeBps = curve.feeBps();
            uint256 taxBps = curve.creatorTaxBps();
            if (feeBps + taxBps > 9900) return 0;
            uint256 snipeBps = curve.currentSnipeTaxBps(recipient);
            uint256 maxSnipe = 9900 - feeBps - taxBps;
            if (snipeBps > maxSnipe) snipeBps = maxSnipe;
            // Match the canonical curve's three independently rounded fee legs.
            uint256 netIn = amountIn - (amountIn * feeBps) / 10000 - (amountIn * taxBps) / 10000 - (amountIn * snipeBps)
                / 10000;
            amountOut = (netIn * tokenReserve) / (quoteReserve + netIn);
            uint256 sellable = curve.sellableTokens();
            if (amountOut > sellable) amountOut = sellable;
            return amountOut;
        } else if (lifecycle == TokenLifecycle.MIGRATED) {
            if (amountIn > uint256(uint128(type(int128).max))) revert MarketNotAvailable();
            bytes memory unlockData = abi.encode(true, token, amountIn, uint256(0), recipient);
            activeUnlock = keccak256(unlockData);
            try IPoolManager(poolManager).unlock(unlockData) returns (bytes memory) {
                activeUnlock = bytes32(0);
                revert MarketNotAvailable();
            } catch (bytes memory reason) {
                activeUnlock = bytes32(0);
                if (reason.length != 36) revert MarketNotAvailable();
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(reason, 0x20))
                    amountOut := mload(add(reason, 0x24))
                }
                if (selector != QuoteResult.selector || amountOut == 0) revert MarketNotAvailable();
                return amountOut;
            }
        }
        return 0;
    }

    function buy(address token, uint256 minAmountOut) external payable override returns (uint256 amountOut) {
        return buy(token, minAmountOut, msg.sender);
    }

    function buy(address token, uint256 minAmountOut, address recipient)
        public
        payable
        override
        nonReentrant
        returns (uint256 amountOut)
    {
        if (minAmountOut == 0 || recipient == address(0) || msg.value == 0) revert MarketNotAvailable();
        if (!canBuy(token)) revert MarketNotAvailable();
        TokenLifecycle lifecycle = getTokenLifecycle(token);

        if (lifecycle == TokenLifecycle.BONDING) {
            address curve = ponsFactory.getLaunchedToken(token).curve;
            uint256 nativeBefore = address(this).balance - msg.value;
            uint256 balanceBefore = IERC20(token).balanceOf(recipient);
            IPonsV2BondingCurve(curve).buy{value: msg.value}(msg.value, minAmountOut, recipient);
            uint256 balanceAfter = IERC20(token).balanceOf(recipient);
            amountOut = balanceAfter - balanceBefore;
            if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

            if (address(this).balance > nativeBefore) {
                (bool refunded,) = payable(msg.sender).call{value: address(this).balance - nativeBefore}("");
                if (!refunded) revert TransferFailed();
            }

            emit MarketSwapExecuted(token, lifecycle, msg.value, amountOut, recipient);
            return amountOut;
        } else if (lifecycle == TokenLifecycle.MIGRATED) {
            bytes memory unlockData = abi.encode(false, token, msg.value, minAmountOut, recipient);
            activeUnlock = keccak256(unlockData);
            bytes memory result = IPoolManager(poolManager).unlock(unlockData);
            activeUnlock = bytes32(0);
            amountOut = abi.decode(result, (uint256));
            emit MarketSwapExecuted(token, lifecycle, msg.value, amountOut, recipient);
            return amountOut;
        } else {
            revert MarketNotAvailable();
        }
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        if (msg.sender != poolManager || activeUnlock == bytes32(0) || keccak256(rawData) != activeUnlock) {
            revert UnauthorizedUnlock();
        }
        activeUnlock = bytes32(0);
        (bool quoteOnly, address token, uint256 ethIn, uint256 minAmountOut, address recipient) =
            abi.decode(rawData, (bool, address, uint256, uint256, address));
        IPoolManager.PoolKey memory key = _getPoolKey(token);

        // Swap exact input ETH for Token: zeroForOne is true when currency0 is address(0)
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(ethIn),
            sqrtPriceLimitX96: 4295128740 // Min sqrt price + 1
        });

        int256 delta = IPoolManager(poolManager).swap(key, params, "");
        uint256 ethOwed = uint256(int256(-int128(delta >> 128)));
        uint256 tokensOut = uint256(int256(int128(delta)));
        if (quoteOnly) revert QuoteResult(tokensOut);
        if (tokensOut < minAmountOut) revert SlippageExceeded(tokensOut, minAmountOut);

        // Settle ETH input to PoolManager
        IPoolManager(poolManager).settle{value: ethOwed}();

        // Transfer tokens to recipient
        IPoolManager(poolManager).take(key.currency1, recipient, tokensOut);

        // Refund any unspent ETH
        if (ethIn > ethOwed) {
            (bool ok,) = payable(recipient).call{value: ethIn - ethOwed}("");
            if (!ok) revert TransferFailed();
        }

        return abi.encode(tokensOut);
    }
}
