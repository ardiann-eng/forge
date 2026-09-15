// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ForgeRouter} from "../contracts/ForgeRouter.sol";
import {ForgeRouterFactory} from "../contracts/ForgeRouterFactory.sol";
import {ForgeBuybackVault} from "../contracts/ForgeBuybackVault.sol";
import {ForgeHolderRewards} from "../contracts/ForgeHolderRewards.sol";
import {PonsMarketAdapter} from "../contracts/PonsMarketAdapter.sol";
import {PonsMarketAdapterV2} from "../contracts/PonsMarketAdapterV2.sol";
import {IForgeMarketAdapter, TokenLifecycle} from "../contracts/interfaces/IForgeMarketAdapter.sol";
import {IPonsV2, IPonsV2BondingCurve, IPoolManager} from "../contracts/interfaces/IPonsV2.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract MockPonsToken is ERC20 {
    bool public burnReverts;

    constructor() ERC20("Mock Launcher Token", "MLT") {
        _mint(msg.sender, 1_000_000_000 ether);
    }

    function setBurnReverts(bool reverts) external {
        burnReverts = reverts;
    }

    function burn(uint256 value) external {
        require(!burnReverts, "Burn disabled");
        _burn(msg.sender, value);
    }
}

contract MockCurve is IPonsV2BondingCurve {
    address public override token;
    address public override pairToken = address(0);
    uint256 public override graduationThreshold = 4.2 ether;
    bool public override graduated;
    bool public override readyToGraduate;
    uint256 public override feeBps = 100; // 1%
    uint256 public override creatorTaxBps = 200; // 2%
    uint256 public quoteReserveVal = 1.68 ether;
    uint256 public tokenReserveVal = 1_000_000_000 ether;
    uint256 public override sellableTokens = 714_285_714 ether;

    constructor(address token_) {
        token = token_;
    }

    function setGraduated(bool g) external {
        graduated = g;
    }

    function setReadyToGraduate(bool r) external {
        readyToGraduate = r;
    }

    function getReserves() external view override returns (uint256, uint256) {
        return (quoteReserveVal, tokenReserveVal);
    }

    function realQuoteReserve() external view override returns (uint256) {
        return quoteReserveVal;
    }

    function tokenReserve() external view override returns (uint256) {
        return tokenReserveVal;
    }

    function quoteReserve() external view override returns (uint256) {
        return quoteReserveVal;
    }

    function currentSnipeTaxBps(address) external pure override returns (uint256) {
        return 0;
    }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        override
        returns (uint256 tokensOut)
    {
        require(msg.value == quoteIn, "Native mismatch");
        require(!graduated && !readyToGraduate, "Curve closed");
        // Simplified constant-product pricing for test
        tokensOut = (quoteIn * 100_000 ether) / 1 ether;
        require(tokensOut >= minTokensOut, "Slippage exceeded");
        ERC20(token).transfer(recipient, tokensOut);
    }

    function sell(uint256, uint256, address) external pure override returns (uint256) {
        return 0;
    }
}

contract MockPonsFactory is IPonsV2 {
    address public override feeEscrow;
    address public override poolManager;
    address public override memeHook = address(0x1111);
    address public override positionManager = address(0x2222);
    address public override locker = address(0x3333);
    address public override buybackVault = address(0x4444);

    mapping(address => LaunchedToken) public tokens;

    constructor(address escrow_, address pm_) {
        feeEscrow = escrow_;
        poolManager = pm_;
    }

    function setToken(address t, LaunchedToken memory l) external {
        tokens[t] = l;
    }

    function getLaunchedToken(address token_) external view override returns (LaunchedToken memory) {
        return tokens[token_];
    }
}

contract MockPoolManager is IPoolManager {
    function unlock(bytes calldata data) external override returns (bytes memory) {
        // Callback to caller
        bytes memory result = MockUnlockCallback(msg.sender).unlockCallback(data);
        return result;
    }

    function swap(PoolKey memory, SwapParams memory params, bytes calldata) external override returns (int256 delta) {
        uint256 ethIn = uint256(-params.amountSpecified);
        uint256 tokensOut = ethIn * 50_000;
        int128 amount0 = -int128(uint128(ethIn));
        int128 amount1 = int128(uint128(tokensOut));
        return (int256(amount0) << 128) | int256(uint256(uint128(amount1)));
    }

    function settle() external payable override returns (uint256) {
        return msg.value;
    }

    function take(address currency, address to, uint256 amount) external override {
        MockPonsToken(currency).transfer(to, amount);
    }
}

interface MockUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

contract MockEscrow {
    receive() external payable {}

    function claim() external returns (uint256) {
        return 0;
    }
}

contract ForgeAdaptersTest is Test {
    MockPonsFactory ponsFactory;
    MockPoolManager poolManager;
    MockPonsToken token;
    MockCurve curve;
    MockEscrow escrow;

    PonsMarketAdapter marketAdapter;
    ForgeBuybackVault buybackVault;
    ForgeHolderRewards holderRewards;
    ForgeRouterFactory factory;
    ForgeRouter router;

    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury");
    address holder1 = makeAddr("holder1");
    address holder2 = makeAddr("holder2");

    bytes32 merkleRoot;
    bytes32[] proof1;
    bytes32[] proof2;

    function setUp() public {
        vm.deal(address(this), 100 ether);
        vm.deal(creator, 50 ether);

        poolManager = new MockPoolManager();
        escrow = new MockEscrow();
        ponsFactory = new MockPonsFactory(address(escrow), address(poolManager));
        token = new MockPonsToken();
        curve = new MockCurve(address(token));

        token.transfer(address(curve), 500_000_000 ether);
        token.transfer(address(poolManager), 100_000_000 ether);

        IPonsV2.LaunchedToken memory launched = IPonsV2.LaunchedToken({
            token: address(token),
            curve: address(curve),
            deployer: creator,
            creatorFeeRecipient: address(0), // will bind router
            pairToken: address(0),
            graduationThreshold: 4.2 ether,
            poolFee: 0,
            tickSpacing: 200,
            creatorTaxBps: 200,
            buybackEnabled: false,
            phase: 0, // Bonding
            sweptQuote: 0,
            sweptTokens: 0,
            sweptAt: 0,
            exists: true
        });
        ponsFactory.setToken(address(token), launched);

        factory = new ForgeRouterFactory(address(ponsFactory), address(escrow));
        marketAdapter = new PonsMarketAdapter(address(ponsFactory), address(poolManager), ponsFactory.memeHook());
        buybackVault = new ForgeBuybackVault(address(factory));
        holderRewards = new ForgeHolderRewards(address(factory));

        factory.setAdapters(address(marketAdapter), address(buybackVault), address(holderRewards));

        // Create router with 7 destination kinds:
        // 20% Creator (0), 20% Treasury (1), 20% Buyback (3), 15% Burn (4), 15% Liquidity (5), 10% Holders (6)
        ForgeRouter.Destination[] memory flow = new ForgeRouter.Destination[](6);
        flow[0] = ForgeRouter.Destination(creator, 2000, 0);
        flow[1] = ForgeRouter.Destination(treasury, 2000, 1);
        flow[2] = ForgeRouter.Destination(address(0), 2000, 3); // Buyback
        flow[3] = ForgeRouter.Destination(address(0), 1500, 4); // Buy+Burn
        flow[4] = ForgeRouter.Destination(address(0), 1500, 5); // Liquidity
        flow[5] = ForgeRouter.Destination(address(0), 1000, 6); // Holders

        vm.prank(creator);
        router = ForgeRouter(payable(factory.createRouter(flow, "ipfs://metadata")));

        // Bind token
        launched.creatorFeeRecipient = address(router);
        ponsFactory.setToken(address(token), launched);
        vm.prank(creator);
        factory.bindToken(address(router), address(token));

        // Generate 2-leaf Merkle tree for holder rewards
        // Leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
        bytes32 leaf1 = keccak256(bytes.concat(keccak256(abi.encode(holder1, 0.4 ether))));
        bytes32 leaf2 = keccak256(bytes.concat(keccak256(abi.encode(holder2, 0.6 ether))));

        if (leaf1 <= leaf2) {
            merkleRoot = keccak256(abi.encodePacked(leaf1, leaf2));
        } else {
            merkleRoot = keccak256(abi.encodePacked(leaf2, leaf1));
        }
        proof1 = new bytes32[](1);
        proof1[0] = leaf2;
        proof2 = new bytes32[](1);
        proof2[0] = leaf1;
    }

    function deposit(uint256 n) internal {
        (bool ok,) = address(router).call{value: n}("");
        assertTrue(ok);
    }

    function testOnlyRegisteredRouterCanRecordBuyback() public {
        vm.expectRevert(ForgeBuybackVault.Unauthorized.selector);
        buybackVault.recordBuyback(address(token), 1 ether, 1 ether);
    }

    function testOnlyRegisteredRouterCanCreateRewardsEpoch() public {
        vm.expectRevert(ForgeHolderRewards.Unauthorized.selector);
        holderRewards.createEpoch{value: 1 ether}(address(token), bytes32(uint256(1)), block.number);
    }

    function testStateAwareLifecycleDetection() public {
        assertEq(uint8(marketAdapter.getTokenLifecycle(address(token))), uint8(TokenLifecycle.BONDING));
        assertTrue(marketAdapter.canBuy(address(token)));
        assertEq(marketAdapter.getBondingMarket(address(token)), address(curve));

        // Transition to graduated / swept
        IPonsV2.LaunchedToken memory l = ponsFactory.getLaunchedToken(address(token));
        l.phase = 1; // Swept
        ponsFactory.setToken(address(token), l);
        assertEq(uint8(marketAdapter.getTokenLifecycle(address(token))), uint8(TokenLifecycle.GRADUATED));
        assertFalse(marketAdapter.canBuy(address(token)));

        // Transition to migrated
        l.phase = 2; // PoolCreated
        ponsFactory.setToken(address(token), l);
        assertEq(uint8(marketAdapter.getTokenLifecycle(address(token))), uint8(TokenLifecycle.MIGRATED));
        assertTrue(marketAdapter.canBuy(address(token)));
    }

    function testFeeBucketAllocation() public {
        deposit(10 ether);
        router.process();

        assertEq(router.claimable(creator), 2 ether);
        assertEq(router.claimable(treasury), 2 ether);
        assertEq(router.buybackReserve(), 2 ether);
        assertEq(router.burnReserve(), 1.5 ether);
        assertEq(router.liquidityReserve(), 1.5 ether);
        assertEq(router.holderRewardReserve(), 1 ether);
        assertEq(router.outstanding(), 4 ether);
    }

    function testBuybackExecutionDuringBonding() public {
        deposit(10 ether);
        router.process();

        uint256 buybackETH = router.buybackReserve();
        assertEq(buybackETH, 2 ether);

        uint256 tokensOut = router.executeBuyback(buybackETH, 1000 ether);
        assertGt(tokensOut, 0);
        assertEq(router.buybackReserve(), 0);
        assertEq(token.balanceOf(address(buybackVault)), tokensOut);
        assertEq(buybackVault.totalETHUsed(address(token)), 2 ether);
        assertEq(buybackVault.totalTokensBought(address(token)), tokensOut);
    }

    function testBuybackSlippageRevert() public {
        deposit(10 ether);
        router.process();

        // Expect revert if minTokensOut is higher than market yields
        vm.expectRevert("Slippage exceeded");
        router.executeBuyback(1 ether, 1_000_000_000 ether);
    }

    function testBuyAndBurnExecution() public {
        deposit(10 ether);
        router.process();

        uint256 supplyBefore = token.totalSupply();
        uint256 burnETH = router.burnReserve();
        assertEq(burnETH, 1.5 ether);

        uint256 tokensBurned = router.executeBurn(burnETH, 1000 ether);
        assertGt(tokensBurned, 0);
        assertEq(router.burnReserve(), 0);
        assertEq(token.totalSupply(), supplyBefore - tokensBurned);
    }

    function testBuyAndBurnFallbackDeadAddress() public {
        deposit(10 ether);
        router.process();

        // Disable native burn so it falls back to 0xdead
        token.setBurnReverts(true);

        uint256 deadBalanceBefore = token.balanceOf(0x000000000000000000000000000000000000dEaD);
        uint256 tokensBurned = router.executeBurn(1 ether, 100 ether);
        assertGt(tokensBurned, 0);
        assertEq(token.balanceOf(0x000000000000000000000000000000000000dEaD), deadBalanceBefore + tokensBurned);
    }

    function testLiquidityReserveAccumulatingDuringBonding() public {
        deposit(10 ether);
        router.process();

        assertEq(router.liquidityReserve(), 1.5 ether);
        // While bonding, execution must revert to keep funds in reserve
        vm.expectRevert(ForgeRouter.BondingActiveLiquidityAccumulating.selector);
        router.executeLiquidity(1.5 ether);
        assertEq(router.liquidityReserve(), 1.5 ether);
    }

    function testHolderRewardsFundingAndClaim() public {
        deposit(10 ether);
        router.process();

        assertEq(router.holderRewardReserve(), 1 ether);

        // Creator funds rewards epoch with the 1 ETH
        vm.prank(creator);
        uint256 epochId = router.fundHolderRewards(merkleRoot, block.number, 1 ether);
        assertEq(epochId, 0);
        assertEq(router.holderRewardReserve(), 0);
        assertEq(address(holderRewards).balance, 1 ether);

        // Holder 1 claims 0.4 ETH
        uint256 h1Before = holder1.balance;
        holderRewards.claim(0, holder1, 0.4 ether, proof1);
        assertEq(holder1.balance, h1Before + 0.4 ether);
        assertTrue(holderRewards.hasClaimed(0, holder1));

        // Double claim prevention
        vm.expectRevert(ForgeHolderRewards.AlreadyClaimed.selector);
        holderRewards.claim(0, holder1, 0.4 ether, proof1);

        // Holder 2 claims 0.6 ETH
        uint256 h2Before = holder2.balance;
        holderRewards.claim(0, holder2, 0.6 ether, proof2);
        assertEq(holder2.balance, h2Before + 0.6 ether);
        assertTrue(holderRewards.hasClaimed(0, holder2));
    }

    function testHolderRewardsInvalidProofRevert() public {
        deposit(10 ether);
        router.process();

        vm.prank(creator);
        router.fundHolderRewards(merkleRoot, block.number, 1 ether);

        bytes32[] memory fakeProof = new bytes32[](1);
        fakeProof[0] = bytes32(uint256(9999));

        vm.expectRevert(ForgeHolderRewards.InvalidProof.selector);
        holderRewards.claim(0, holder1, 0.4 ether, fakeProof);
    }

    function testIsolationWhenBuybackFails() public {
        deposit(10 ether);
        router.process();

        // If market buyback fails due to bad slippage, creator & treasury can still claim without issue
        vm.expectRevert("Slippage exceeded");
        router.executeBuyback(2 ether, 999_999_999 ether);

        assertEq(router.buybackReserve(), 2 ether);

        // Creator claim succeeds
        uint256 cBefore = creator.balance;
        vm.prank(creator);
        router.claim();
        assertEq(creator.balance, cBefore + 2 ether);

        // Treasury claim succeeds
        uint256 tBefore = treasury.balance;
        vm.prank(treasury);
        router.claim();
        assertEq(treasury.balance, tBefore + 2 ether);
    }

    function testPostMigrationV4Buyback() public {
        // Switch token to phase 2 (PoolCreated / Migrated)
        IPonsV2.LaunchedToken memory l = ponsFactory.getLaunchedToken(address(token));
        l.phase = 2;
        ponsFactory.setToken(address(token), l);

        deposit(5 ether);
        router.process();

        uint256 bought = router.executeBuyback(1 ether, 1000 ether);
        assertGt(bought, 0);
        assertEq(token.balanceOf(address(buybackVault)), bought);
    }

    function testV2PostMigrationQuoteAndBuy() public {
        IPonsV2.LaunchedToken memory l = ponsFactory.getLaunchedToken(address(token));
        l.phase = 2;
        ponsFactory.setToken(address(token), l);
        PonsMarketAdapterV2 adapterV2 =
            new PonsMarketAdapterV2(address(ponsFactory), address(poolManager), ponsFactory.memeHook());

        uint256 quote = adapterV2.quoteBuyForRecipient(address(token), 1 ether, address(this));
        assertEq(quote, 50_000 ether);
        uint256 before = token.balanceOf(address(this));
        uint256 bought = adapterV2.buy{value: 1 ether}(address(token), quote, address(this));

        assertEq(bought, quote);
        assertEq(token.balanceOf(address(this)) - before, quote);
    }

    function testFuzzConservationWithAllActions(uint96 n) public {
        vm.assume(n >= 10000);
        vm.deal(address(this), n);
        deposit(n);
        router.process();

        uint256 c = router.claimable(creator);
        uint256 t = router.claimable(treasury);
        uint256 bb = router.buybackReserve();
        uint256 bn = router.burnReserve();
        uint256 lq = router.liquidityReserve();
        uint256 hr = router.holderRewardReserve();

        assertEq(c + t + bb + bn + lq + hr, n);
        assertEq(address(router).balance, n);
    }
}
