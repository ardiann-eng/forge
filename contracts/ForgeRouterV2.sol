// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPonsV2, IPonsV2BondingCurve, IPonsEscrow, IPonsLauncherToken} from "./interfaces/IPonsV2.sol";
import {
    IForgeMarketAdapter,
    IForgeBuybackVault,
    IForgeHolderRewards,
    TokenLifecycle
} from "./interfaces/IForgeMarketAdapter.sol";

import {IForgeStrategyPrice} from "./interfaces/IForgeStrategyPrice.sol";

/// @notice V2 programmable creator-fee router with failure isolation and automated execution across protocol destinations.
contract ForgeRouterV2 is ReentrancyGuard {
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
    uint256 public constant AUTOMATION_INTERVAL = 5 minutes;
    uint256 public lastBuybackExecution;
    uint256 public lastBurnExecution;

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

    event BuybackExecuted(
        address indexed token, address indexed market, uint256 ethIn, uint256 tokensOut, address recipient
    );
    event BuyAndBurnExecuted(address indexed token, uint256 ethIn, uint256 tokensBought, address burnDestination);
    event HolderRewardsFunded(
        address indexed token, uint256 indexed epochId, uint256 amount, bytes32 merkleRoot, uint256 snapshotBlock
    );
    event LiquidityProcessed(address indexed token, uint256 amount, uint256 totalReserve);
    event MinExecutionThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    constructor(
        address creator_,
        address escrow_,
        address marketAdapter_,
        address buybackVault_,
        address holderRewards_,
        Destination[] memory flow,
        string memory uri,
        StrategyConfig memory strategies_,
        address priceResolver_
    ) {
        if (marketAdapter_.code.length == 0 || buybackVault_.code.length == 0 || holderRewards_.code.length == 0) revert InvalidConfiguration();
        if (creator_ == address(0) || escrow_ == address(0) || flow.length == 0 || flow.length > 16) {
            revert InvalidConfiguration();
        }
        creator = creator_;
        factory = msg.sender;
        feeEscrow = escrow_;
        marketAdapter = marketAdapter_;
        buybackVault = buybackVault_;
        holderRewards = holderRewards_;
        creationTimestamp = block.timestamp;
        metadataURI = uri;

        _configureStrategies(strategies_, priceResolver_);
        uint256 sum;
        for (uint256 i; i < flow.length; ++i) {
            Destination memory d = flow[i];
            if (d.bps == 0 || d.kind > 8 || d.kind == 2 || d.kind == 5) revert InvalidConfiguration();

            if (d.kind <= 2) {
                // Direct recipient destinations
                if (
                    d.recipient == address(0) || d.recipient == address(this)
                        || (d.kind == 0 && d.recipient != creator_)
                ) {
                    revert InvalidConfiguration();
                }
                for (uint256 j; j < i; ++j) {
                    if (flow[j].kind <= 2 && flow[j].recipient == d.recipient) revert InvalidConfiguration();
                }
            } else {
                // Protocol action destinations (Buyback, Buy+Burn, Liquidity, Holders)
                // Enforce recipient == address(0) unless specified as vault/rewards, and no duplicates of same kind
                if (
                    d.recipient != address(0) && d.recipient != address(this) && d.recipient != buybackVault_
                        && d.recipient != holderRewards_
                ) {
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
        if (msg.sender == marketAdapter) return;
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
    function collectFees() external nonReentrant returns (uint256 amount) {
        return IPonsEscrow(feeEscrow).claim();
    }

    function collectTokenFees(address asset) external nonReentrant {
        IPonsEscrow(feeEscrow).claimToken(asset);
    }

    function process() public nonReentrant {
        uint256 allocated = outstanding + buybackReserve + burnReserve + liquidityReserve + holderRewardReserve
            + gradBoostBalance + dcaBuybackBalance;
        uint256 amount = address(this).balance > allocated ? address(this).balance - allocated : 0;
        if (amount == 0) revert NothingToProcess();

        if (totalReceived < totalProcessed + amount) totalReceived = totalProcessed + amount;
        totalProcessed += amount;

        _allocate(address(0), amount);
    }

    // V2 supports native PONS fee revenue only. ERC20 fees cannot corrupt native reserves.
    function processToken(address) external pure {
        revert InvalidConfiguration();
    }

    function processFees() external {
        process();
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
            } else if (d.kind == 7) {
                gradBoostBalance += share;
                emit StrategyReserveAdded(token, 7, share);
            } else if (d.kind == 8) {
                if (dcaCancelled) {
                    claimable[creator] += share;
                    outstanding += share;
                    emit ClaimableCreated(address(0), creator, share);
                } else {
                    dcaBuybackBalance += share;
                    emit StrategyReserveAdded(token, 8, share);
                }
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
        // Every five-minute run consumes the complete fee batch accumulated
        // since the preceding execution. Partial discretionary buys are not allowed.
        if (amount == 0 || amount != buybackReserve) revert InvalidAmount();
        _guardAutomatedBatch(amount, minTokensOut, lastBuybackExecution);

        buybackReserve -= amount;
        lastBuybackExecution = block.timestamp;
        address vault = buybackVault;
        (uint256 bought, uint256 spent) = _buy(amount, minTokensOut);
        tokensBought = bought;
        buybackReserve += amount - spent;
        IERC20(token).safeTransfer(vault, bought);
        amount = spent;

        totalETHUsedForBuyback += amount;
        totalTokensBoughtBack += tokensBought;

        if (buybackVault != address(0)) {
            IForgeBuybackVault(buybackVault).recordBuyback(token, amount, tokensBought);
        }

        emit BuybackExecuted(token, marketAdapter, amount, tokensBought, vault);
    }

    /// @notice Permissionless execution of market buy + burn.
    function executeBurn(uint256 amount, uint256 minTokensOut) external nonReentrant returns (uint256 tokensBurned) {
        if (amount == 0 || amount != burnReserve) revert InvalidAmount();
        _guardAutomatedBatch(amount, minTokensOut, lastBurnExecution);

        burnReserve -= amount;
        lastBurnExecution = block.timestamp;
        (uint256 tokensBought, uint256 spent) = _buy(amount, minTokensOut);
        burnReserve += amount - spent;
        amount = spent;

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
    function fundHolderRewards(bytes32 merkleRoot, uint256 snapshotBlock, uint256 amount)
        external
        nonReentrant
        returns (uint256 epochId)
    {
        if (msg.sender != creator && msg.sender != factory) revert Unauthorized();
        if (amount == 0 || amount > holderRewardReserve) revert InvalidAmount();
        if (token == address(0)) revert TokenNotBound();
        if (holderRewards == address(0)) revert AdapterUnavailable();

        holderRewardReserve -= amount;
        epochId = IForgeHolderRewards(holderRewards).createEpoch{value: amount}(token, merkleRoot, snapshotBlock);

        emit HolderRewardsFunded(token, epochId, amount, merkleRoot, snapshotBlock);
    }

    struct Limits {
        uint256 minExecutionNative;
        uint256 maxExecutionNative;
        uint16 slippageBps;
        uint32 cooldownSeconds;
    }

    struct Level {
        uint16 dropBps;
        uint16 spendBps;
    }

    struct StrategyConfig {
        uint16 triggerProgressBps;
        Limits grad;
        Limits dca;
        Level[] levels;
    }
    Limits public baseLimits;
    Limits public gradLimits;
    Limits public dcaLimits;
    uint16 public triggerProgressBps;
    address public priceResolver;
    uint256 public gradBoostBalance;
    uint256 public dcaBuybackBalance;
    uint256 public lastGradExecution;
    uint256 public lastDcaExecution;
    uint256 public lastDcaCheck;
    bool public dcaCancelled;
    uint256 public anchorPrice;
    uint256 public dcaPlanReserve;
    uint256 public dcaPlanSpent;
    uint256 public dcaEpoch;
    bool public paused;
    Level[] private levels;
    mapping(uint256 => mapping(uint256 => bool)) public levelExecuted;
    error ExecutionUnavailable();
    error ExecutionGuard();
    event StrategyReserveAdded(address indexed token, uint8 kind, uint256 amount);
    event GradBoostExecuted(address indexed token, uint256 ethIn, uint256 tokensOut, uint256 progressBps);
    event DcaChecked(
        address indexed token, uint256 indexed epoch, uint256 previousPrice, uint256 currentPrice, uint256 nextReference
    );
    event DcaCancelled(address indexed token, uint256 returnedToCreator);
    event DcaBuybackExecuted(address indexed token, uint256 epoch, uint256 level, uint256 ethIn, uint256 tokensOut);
    event StrategyPaused(bool paused);

    function version() external pure returns (uint256) {
        return 2;
    }

    function getLevels() external view returns (Level[] memory) {
        return levels;
    }

    function _validateLimits(Limits memory l) private pure {
        if (
            l.minExecutionNative == 0 || l.maxExecutionNative < l.minExecutionNative || l.slippageBps == 0
                || l.slippageBps > 1000 || l.cooldownSeconds < 60
        ) revert InvalidConfiguration();
    }

    function _configureStrategies(StrategyConfig memory c, address resolver) private {
        _validateLimits(c.grad);
        _validateLimits(c.dca);
        if (c.dca.cooldownSeconds != AUTOMATION_INTERVAL) revert InvalidConfiguration();
        if (c.triggerProgressBps > 10000 || c.levels.length == 0 || c.levels.length > 5) {
            revert InvalidConfiguration();
        }
        triggerProgressBps = c.triggerProgressBps;
        gradLimits = c.grad;
        dcaLimits = c.dca;
        baseLimits = c.dca;
        priceResolver = resolver;
        for (uint256 i; i < c.levels.length; ++i) {
            Level memory l = c.levels[i];
            if (l.dropBps == 0 || l.dropBps >= 10000 || (i > 0 && l.dropBps <= c.levels[i - 1].dropBps)) {
                revert InvalidConfiguration();
            }
            levels.push(l);
        }
    }

    function setPaused(bool value) external {
        if (msg.sender != creator) revert Unauthorized();
        paused = value;
        emit StrategyPaused(value);
    }

    function bondingProgressBps() public view returns (uint256) {
        if (token == address(0) || marketAdapter == address(0)) revert ExecutionUnavailable();
        IForgeMarketAdapter a = IForgeMarketAdapter(marketAdapter);
        if (a.getTokenLifecycle(token) != TokenLifecycle.BONDING) revert ExecutionUnavailable();
        IPonsV2BondingCurve c = IPonsV2BondingCurve(a.getBondingMarket(token));
        uint256 threshold = c.graduationThreshold();
        if (threshold == 0 || c.token() != token || c.pairToken() != address(0)) revert ExecutionUnavailable();
        return Math.min(10000, Math.mulDiv(c.realQuoteReserve(), 10000, threshold));
    }

    function _guardBuy(uint256 amount, uint256 minOut, uint256 deadline, Limits memory l, uint256 last) private {
        if (paused || token == address(0) || marketAdapter == address(0)) revert ExecutionUnavailable();
        if (
            amount < l.minExecutionNative || amount > l.maxExecutionNative || minOut == 0 || deadline < block.timestamp
                || deadline > block.timestamp + 300 || (last > 0 && block.timestamp < last + l.cooldownSeconds)
        ) revert ExecutionGuard();
        if (!IForgeMarketAdapter(marketAdapter).canBuy(token)) revert ExecutionUnavailable();
        uint256 quote = IForgeMarketAdapter(marketAdapter).quoteBuy(token, amount);
        if (quote == 0) revert ExecutionUnavailable();
        uint256 floor = Math.mulDiv(quote, 10000 - l.slippageBps, 10000);
        if (floor == 0 || minOut < floor) revert ExecutionGuard();
    }

    function _guardAutomatedBatch(uint256 amount, uint256 minOut, uint256 lastExecution) private {
        uint256 intervalStart = lastExecution == 0 ? creationTimestamp : lastExecution;
        if (
            paused || token == address(0) || marketAdapter == address(0) || minOut == 0
                || block.timestamp < intervalStart + AUTOMATION_INTERVAL
        ) revert ExecutionGuard();
        if (!IForgeMarketAdapter(marketAdapter).canBuy(token)) revert ExecutionUnavailable();
        uint256 quote = IForgeMarketAdapter(marketAdapter).quoteBuy(token, amount);
        if (quote == 0) revert ExecutionUnavailable();
        uint256 floor = Math.mulDiv(quote, 10000 - baseLimits.slippageBps, 10000);
        if (floor == 0 || minOut < floor) revert ExecutionGuard();
    }

    function _guardDeadlineBatch(uint256 amount, uint256 minOut, uint256 deadline, uint16 slippageBps) private {
        if (
            paused || token == address(0) || marketAdapter == address(0) || amount == 0 || minOut == 0
                || deadline < block.timestamp || deadline > block.timestamp + 300
        ) revert ExecutionGuard();
        if (!IForgeMarketAdapter(marketAdapter).canBuy(token)) revert ExecutionUnavailable();
        uint256 quote = IForgeMarketAdapter(marketAdapter).quoteBuy(token, amount);
        if (quote == 0) revert ExecutionUnavailable();
        uint256 floor = Math.mulDiv(quote, 10000 - slippageBps, 10000);
        if (floor == 0 || minOut < floor) revert ExecutionGuard();
    }

    // Measure actual receipts. Adapter refund is returned to the same reserve, never fee revenue.
    function _buy(uint256 amount, uint256 minOut) private returns (uint256 bought, uint256 spent) {
        uint256 beforeTokens = IERC20(token).balanceOf(address(this));
        uint256 beforeNative = address(this).balance;
        IForgeMarketAdapter(marketAdapter).buy{value: amount}(token, minOut, address(this));
        bought = IERC20(token).balanceOf(address(this)) - beforeTokens;
        spent = beforeNative - address(this).balance;
        if (bought < minOut || spent > amount || spent == 0) revert ExecutionGuard();
    }

    function executeGradBoost(uint256 amount, uint256 minOut, uint256 deadline) external nonReentrant {
        uint256 progress = bondingProgressBps();
        if (progress < triggerProgressBps || amount > gradBoostBalance) revert ExecutionGuard();
        _guardBuy(amount, minOut, deadline, gradLimits, lastGradExecution);
        gradBoostBalance -= amount;
        lastGradExecution = block.timestamp;
        (uint256 bought, uint256 spent) = _buy(amount, minOut);
        gradBoostBalance += amount - spent;
        IERC20(token).safeTransfer(buybackVault, bought);
        IForgeBuybackVault(buybackVault).recordBuyback(token, spent, bought);
        emit GradBoostExecuted(token, spent, bought, progress);
    }

    function _prices() private view returns (uint256 low, uint256 high) {
        if (priceResolver == address(0) || token == address(0)) revert ExecutionUnavailable();
        uint256 updatedAt;
        uint256 window;
        bool supported;
        (low, high, updatedAt, window, supported) = IForgeStrategyPrice(priceResolver).bounds(token);
        if (
            !supported || low == 0 || high < low || updatedAt > block.timestamp || block.timestamp - updatedAt > 120
                || window < 120
        ) revert ExecutionUnavailable();
    }

    /// @notice Exactly one decision per interval. Highest matching tier sizes a buy from CURRENT reserve.
    /// Comparing current upper bound against previous lower bound is conservative about a dip.
    function previewDca() public view returns (bool due, uint256 level, uint256 amount, uint256 low, uint256 high) {
        if (paused || dcaCancelled || (lastDcaCheck > 0 && block.timestamp < lastDcaCheck + dcaLimits.cooldownSeconds))
        {
            return (false, 0, 0, 0, 0);
        }
        (low, high) = _prices();
        due = true;
        // First check and restart after missed intervals establish a fresh baseline without spending.
        if (lastDcaCheck == 0 || block.timestamp > lastDcaCheck + uint256(dcaLimits.cooldownSeconds) * 2) {
            return (due, 0, 0, low, high);
        }
        bool matched;
        for (uint256 i; i < levels.length; ++i) {
            if (high <= Math.mulDiv(anchorPrice, 10000 - levels[i].dropBps, 10000)) {
                level = i;
                matched = true;
            }
        }
        if (matched) {
            // A confirmed dip consumes the complete fee batch accumulated in
            // this DCA reserve during the interval.
            amount = dcaBuybackBalance;
        }
    }

    /// @notice A keeper or anyone can submit the constrained check. No arbitrary pool/token/recipient.
    function checkDca(uint256 minOut, uint256 deadline) external nonReentrant {
        (bool due, uint256 level, uint256 amount, uint256 low, uint256 high) = previewDca();
        if (!due || deadline < block.timestamp || deadline > block.timestamp + 300) revert ExecutionGuard();
        uint256 previous = anchorPrice;
        lastDcaCheck = block.timestamp;
        anchorPrice = low;
        ++dcaEpoch;
        dcaPlanReserve = dcaBuybackBalance;
        dcaPlanSpent = 0;
        emit DcaChecked(token, dcaEpoch, previous, high, low);
        if (amount == 0) return;
        _guardDeadlineBatch(amount, minOut, deadline, dcaLimits.slippageBps);
        levelExecuted[dcaEpoch][level] = true;
        lastDcaExecution = block.timestamp;
        dcaBuybackBalance -= amount;
        (uint256 bought, uint256 spent) = _buy(amount, minOut);
        dcaBuybackBalance += amount - spent;
        dcaPlanSpent = spent;
        IERC20(token).safeTransfer(buybackVault, bought);
        IForgeBuybackVault(buybackVault).recordBuyback(token, spent, bought);
        emit DcaBuybackExecuted(token, dcaEpoch, level, spent, bought);
    }

    /// @notice Permanent creator cancellation. Reserve and future DCA fees become creator pull claims.
    function cancelDca() external nonReentrant {
        if (msg.sender != creator) revert Unauthorized();
        if (dcaCancelled) revert ExecutionGuard();
        dcaCancelled = true;
        uint256 amount = dcaBuybackBalance;
        dcaBuybackBalance = 0;
        claimable[creator] += amount;
        outstanding += amount;
        emit DcaCancelled(token, amount);
        emit ClaimableCreated(address(0), creator, amount);
    }

}
