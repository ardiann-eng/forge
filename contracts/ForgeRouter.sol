// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPonsEscrow, IPonsLauncherToken} from "./interfaces/IPonsV2.sol";
import {IForgeMarketAdapter, IForgeBuybackVault, IForgeHolderRewards, TokenLifecycle} from "./interfaces/IForgeMarketAdapter.sol";

/// @notice Programmable creator-fee router with failure isolation and automated execution across protocol destinations.
contract ForgeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Destination {
        address recipient;
        uint16 bps;
        uint8 kind; // 0 Creator, 1 Treasury, 2 Custom, 3 Buyback, 4 Buy+Burn, 5 Liquidity, 6 Holders
    }

    address public immutable creator;
    address public immutable factory;
    address public immutable feeEscrow;
    address public immutable marketAdapter;
    address public immutable buybackVault;
    address public immutable holderRewards;
    uint256 public immutable creationTimestamp;
    string public metadataURI;
    address public token;

    Destination[] private destinations;

    uint256 public totalReceived;
    uint256 public totalProcessed;
    uint256 public outstanding;
    mapping(address => uint256) public claimable;

    mapping(address => uint256) public tokenTotalReceived;
    mapping(address => uint256) public tokenTotalProcessed;
    mapping(address => uint256) public tokenOutstanding;
    mapping(address => mapping(address => uint256)) public tokenClaimable;

    // Dedicated advanced fee action reserves
    uint256 public buybackReserve;
    uint256 public burnReserve;
    uint256 public liquidityReserve;
    uint256 public holderRewardReserve;

    // Cumulative statistics
    uint256 public totalETHUsedForBuyback;
    uint256 public totalTokensBoughtBack;
    uint256 public totalETHUsedForBurn;
    uint256 public totalTokensBurned;
    uint256 public minExecutionThreshold;

    error InvalidConfiguration();
    error Unauthorized();
    error AlreadyBound();
    error NothingToProcess();
    error NothingToClaim();
    error TransferFailed();
    error InvalidAmount();
    error TokenNotBound();
    error AdapterUnavailable();
    error MarketNotAvailable();
    error MinimumOutputRequired();
    error ThresholdNotMet();
    error BondingActiveLiquidityAccumulating();

    event FeesReceived(address indexed sender, uint256 amount);
    event FeesProcessed(address indexed asset, uint256 amount);
    event ClaimableCreated(address indexed asset, address indexed recipient, uint256 amount);
    event Claimed(address indexed asset, address indexed recipient, uint256 amount);
    event TokenBound(address indexed token);

    event BuybackReserveAdded(address indexed token, uint256 amount);
    event BurnReserveAdded(address indexed token, uint256 amount);
    event LiquidityReserveAdded(address indexed token, uint256 amount);
    event HolderRewardReserveAdded(address indexed token, uint256 amount);

    event BuybackExecuted(address indexed token, address indexed market, uint256 ethIn, uint256 tokensOut, address recipient);
    event BuyAndBurnExecuted(address indexed token, uint256 ethIn, uint256 tokensBought, address burnDestination);
    event HolderRewardsFunded(address indexed token, uint256 indexed epochId, uint256 amount, bytes32 merkleRoot, uint256 snapshotBlock);
    event LiquidityProcessed(address indexed token, uint256 amount, uint256 totalReserve);
    event MinExecutionThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    constructor(
        address creator_,
        address escrow_,
        address marketAdapter_,
        address buybackVault_,
        address holderRewards_,
        Destination[] memory flow,
        string memory uri
    ) {
        if (creator_ == address(0) || escrow_ == address(0) || flow.length == 0 || flow.length > 16) revert InvalidConfiguration();
        creator = creator_;
        factory = msg.sender;
        feeEscrow = escrow_;
        marketAdapter = marketAdapter_;
        buybackVault = buybackVault_;
        holderRewards = holderRewards_;
        creationTimestamp = block.timestamp;
        metadataURI = uri;

        uint256 sum;
        for (uint256 i; i < flow.length; ++i) {
            Destination memory d = flow[i];
            if (d.bps == 0 || d.kind > 6) revert InvalidConfiguration();

            if (d.kind <= 2) {
                // Direct recipient destinations
                if (d.recipient == address(0) || d.recipient == address(this) || (d.kind == 0 && d.recipient != creator_)) {
                    revert InvalidConfiguration();
                }
                for (uint256 j; j < i; ++j) {
                    if (flow[j].kind <= 2 && flow[j].recipient == d.recipient) revert InvalidConfiguration();
                }
            } else {
                // Protocol action destinations (Buyback, Buy+Burn, Liquidity, Holders)
                // Enforce recipient == address(0) unless specified as vault/rewards, and no duplicates of same kind
                if (d.recipient != address(0) && d.recipient != address(this) && d.recipient != buybackVault_ && d.recipient != holderRewards_) {
                    revert InvalidConfiguration();
                }
                for (uint256 j; j < i; ++j) {
                    if (flow[j].kind == d.kind) revert InvalidConfiguration();
                }
            }
            sum += d.bps;
            destinations.push(d);
        }
        if (sum != 10_000) revert InvalidConfiguration();
    }

    receive() external payable {
        totalReceived += msg.value;
        emit FeesReceived(msg.sender, msg.value);
    }

    function getDestinations() external view returns (Destination[] memory) {
        return destinations;
    }

    function bindToken(address token_) external {
        if (msg.sender != factory) revert Unauthorized();
        if (token != address(0)) revert AlreadyBound();
        if (token_.code.length == 0) revert InvalidConfiguration();
        token = token_;
        emit TokenBound(token_);
    }

    function setMinExecutionThreshold(uint256 threshold) external {
        if (msg.sender != creator) revert Unauthorized();
        emit MinExecutionThresholdUpdated(minExecutionThreshold, threshold);
        minExecutionThreshold = threshold;
    }

    /// @notice Anyone may pull this router's revenue from its fixed PONS escrow.
    function collectFees() external nonReentrant {
        IPonsEscrow(feeEscrow).claim();
    }

    function collectTokenFees(address asset) external nonReentrant {
        IPonsEscrow(feeEscrow).claimToken(asset);
    }

    function process() external nonReentrant {
        uint256 allocated = outstanding + buybackReserve + burnReserve + liquidityReserve + holderRewardReserve;
        uint256 amount = address(this).balance > allocated ? address(this).balance - allocated : 0;
        if (amount == 0) revert NothingToProcess();

        if (totalReceived < totalProcessed + amount) totalReceived = totalProcessed + amount;
        totalProcessed += amount;

        _allocate(address(0), amount);
    }

    function processToken(address asset) external nonReentrant {
        uint256 amount = IERC20(asset).balanceOf(address(this)) - tokenOutstanding[asset];
        if (amount == 0) revert NothingToProcess();

        tokenOutstanding[asset] += amount;
        tokenTotalProcessed[asset] += amount;
        tokenTotalReceived[asset] = tokenTotalProcessed[asset];

        _allocate(asset, amount);
    }

    function _allocate(address asset, uint256 amount) private {
        uint256 used;
        for (uint256 i; i < destinations.length; ++i) {
            Destination memory d = destinations[i];
            uint256 share = i + 1 == destinations.length ? amount - used : Math.mulDiv(amount, d.bps, 10_000);
            used += share;

            if (d.kind <= 2) {
                if (asset == address(0)) {
                    claimable[d.recipient] += share;
                    outstanding += share;
                } else {
                    tokenClaimable[asset][d.recipient] += share;
                    tokenOutstanding[asset] += share;
                }
                emit ClaimableCreated(asset, d.recipient, share);
            } else if (d.kind == 3) {
                buybackReserve += share;
                emit BuybackReserveAdded(token, share);
            } else if (d.kind == 4) {
                burnReserve += share;
                emit BurnReserveAdded(token, share);
            } else if (d.kind == 5) {
                liquidityReserve += share;
                emit LiquidityReserveAdded(token, share);
            } else if (d.kind == 6) {
                holderRewardReserve += share;
                emit HolderRewardReserveAdded(token, share);
            }
        }
        emit FeesProcessed(asset, amount);
    }

    /// @notice Independent claim for creator, treasury, and custom recipients.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        outstanding -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(address(0), msg.sender, amount);
    }

    function claimToken(address asset) external nonReentrant {
        uint256 amount = tokenClaimable[asset][msg.sender];
        if (amount == 0) revert NothingToClaim();
        tokenClaimable[asset][msg.sender] = 0;
        tokenOutstanding[asset] -= amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Claimed(asset, msg.sender, amount);
    }

    /// @notice Permissionless execution of market buyback with slippage protection.
    function executeBuyback(uint256 amount, uint256 minTokensOut) external nonReentrant returns (uint256 tokensBought) {
        if (amount == 0 || amount > buybackReserve) revert InvalidAmount();
        if (minExecutionThreshold > 0 && amount < minExecutionThreshold) revert ThresholdNotMet();
        if (token == address(0)) revert TokenNotBound();
        if (marketAdapter == address(0)) revert AdapterUnavailable();
        if (!IForgeMarketAdapter(marketAdapter).canBuy(token)) revert MarketNotAvailable();
        if (minTokensOut == 0) revert MinimumOutputRequired();

        buybackReserve -= amount;
        address vault = buybackVault != address(0) ? buybackVault : address(this);
        tokensBought = IForgeMarketAdapter(marketAdapter).buy{value: amount}(token, minTokensOut, vault);

        totalETHUsedForBuyback += amount;
        totalTokensBoughtBack += tokensBought;

        if (buybackVault != address(0)) {
            IForgeBuybackVault(buybackVault).recordBuyback(token, amount, tokensBought);
        }

        emit BuybackExecuted(token, marketAdapter, amount, tokensBought, vault);
    }

    /// @notice Permissionless execution of market buy + burn.
    function executeBurn(uint256 amount, uint256 minTokensOut) external nonReentrant returns (uint256 tokensBurned) {
        if (amount == 0 || amount > burnReserve) revert InvalidAmount();
        if (minExecutionThreshold > 0 && amount < minExecutionThreshold) revert ThresholdNotMet();
        if (token == address(0)) revert TokenNotBound();
        if (marketAdapter == address(0)) revert AdapterUnavailable();
        if (!IForgeMarketAdapter(marketAdapter).canBuy(token)) revert MarketNotAvailable();
        if (minTokensOut == 0) revert MinimumOutputRequired();

        burnReserve -= amount;
        uint256 tokensBought = IForgeMarketAdapter(marketAdapter).buy{value: amount}(token, minTokensOut, address(this));

        address burnDest;
        try IPonsLauncherToken(token).burn(tokensBought) {
            burnDest = address(0);
        } catch {
            IERC20(token).safeTransfer(0x000000000000000000000000000000000000dEaD, tokensBought);
            burnDest = 0x000000000000000000000000000000000000dEaD;
        }

        totalETHUsedForBurn += amount;
        totalTokensBurned += tokensBought;
        tokensBurned = tokensBought;

        emit BuyAndBurnExecuted(token, amount, tokensBought, burnDest);
    }

    /// @notice Funds a new holder rewards Merkle epoch from the holder reward reserve.
    function fundHolderRewards(bytes32 merkleRoot, uint256 snapshotBlock, uint256 amount) external nonReentrant returns (uint256 epochId) {
        if (msg.sender != creator && msg.sender != factory) revert Unauthorized();
        if (amount == 0 || amount > holderRewardReserve) revert InvalidAmount();
        if (token == address(0)) revert TokenNotBound();
        if (holderRewards == address(0)) revert AdapterUnavailable();

        holderRewardReserve -= amount;
        epochId = IForgeHolderRewards(holderRewards).createEpoch{value: amount}(token, merkleRoot, snapshotBlock);

        emit HolderRewardsFunded(token, epochId, amount, merkleRoot, snapshotBlock);
    }

    /// @notice Processes the liquidity reserve, checking lifecycle state.
    function executeLiquidity(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > liquidityReserve) revert InvalidAmount();
        if (token == address(0)) revert TokenNotBound();

        if (marketAdapter != address(0)) {
            TokenLifecycle lifecycle = IForgeMarketAdapter(marketAdapter).getTokenLifecycle(token);
            if (lifecycle == TokenLifecycle.BONDING) {
                revert BondingActiveLiquidityAccumulating();
            }
        }

        emit LiquidityProcessed(token, amount, liquidityReserve);
    }
}
