// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ForgeRouterV2 as Router} from "../contracts/ForgeRouterV2.sol";
import {IForgeMarketAdapter, TokenLifecycle} from "../contracts/interfaces/IForgeMarketAdapter.sol";
import {IForgeStrategyPrice} from "../contracts/interfaces/IForgeStrategyPrice.sol";

contract StrategyToken is ERC20 {
    bool public fail;
    constructor() ERC20("Real test token", "TEST") {}

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function setFail(bool value) external {
        fail = value;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        require(!fail, "transfer failed");
        return super.transfer(to, value);
    }

    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }
}

contract StrategyMarket {
    address public token;
    uint256 public progress = 8000;
    bool public migrated;
    bool public unavailable;
    uint256 public output = 1001;
    uint256 public refund;

    constructor(address t) {
        token = t;
    }

    function setProgress(uint256 value) external {
        progress = value;
    }

    function setMigrated(bool value) external {
        migrated = value;
    }

    function setUnavailable(bool value) external {
        unavailable = value;
    }

    function setOutput(uint256 value) external {
        output = value;
    }

    function setRefund(uint256 value) external {
        refund = value;
    }

    function getTokenLifecycle(address) external view returns (TokenLifecycle) {
        return migrated ? TokenLifecycle.MIGRATED : TokenLifecycle.BONDING;
    }

    function canBuy(address) external pure returns (bool) {
        return true;
    }

    function getBondingMarket(address) external view returns (address) {
        return address(this);
    }

    function pairToken() external pure returns (address) {
        return address(0);
    }

    function graduationThreshold() external pure returns (uint256) {
        return 10000;
    }

    function realQuoteReserve() external view returns (uint256) {
        return progress;
    }

    function quoteBuy(address, uint256) external view returns (uint256) {
        return unavailable ? 0 : 1000;
    }

    function buy(address, uint256, address recipient) external payable returns (uint256) {
        StrategyToken(token).mint(recipient, output);
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok);
        }
        return output;
    }
    function recordBuyback(address, uint256, uint256) external {}
}

contract StrategyPrice is IForgeStrategyPrice {
    uint256 public value = 10000;
    uint256 public timestamp;
    uint256 public window = 120;

    constructor() {
        timestamp = block.timestamp;
    }

    function set(uint256 p, uint256 t, uint256 w) external {
        value = p;
        timestamp = t;
        window = w;
    }

    function bounds(address) external view returns (uint256, uint256, uint256, uint256, bool) {
        return (value, value, timestamp, window, true);
    }

    function price(address) external view returns (uint256, uint256, uint256, bool) {
        return (value, timestamp, window, true);
    }
}

contract ForgeStrategiesTest is Test {
    Router r;
    StrategyToken t;
    StrategyMarket m;
    StrategyPrice oracle;
    address a = address(0xA);
    address b = address(0xB);

    function config() internal view returns (Router.StrategyConfig memory c) {
        c.triggerProgressBps = 7500;
        c.grad = Router.Limits(0.02 ether, 0.25 ether, 200, 60);
        c.dca = Router.Limits(c.grad.minExecutionNative, c.grad.maxExecutionNative, c.grad.slippageBps, 300);
        c.levels = new Router.Level[](3);
        c.levels[0] = Router.Level(1000, 2000);
        c.levels[1] = Router.Level(2000, 3000);
        c.levels[2] = Router.Level(3000, 5000);
    }

    function deploy(Router.StrategyConfig memory c, uint8 kind) internal returns (Router) {
        Router.Destination[] memory f = new Router.Destination[](1);
        f[0] = Router.Destination(address(0), 10000, kind);
        return new Router(
            address(this), address(m), address(m), address(m), address(m), f, "ipfs://test", c, address(oracle)
        );
    }

    function setUp() public {
        vm.warp(1000);
        t = new StrategyToken();
        m = new StrategyMarket(address(t));
        oracle = new StrategyPrice();
        r = deploy(config(), 7);
        r.bindToken(address(t));
        vm.deal(address(this), 100 ether);
        fund(r, 1 ether);
    }

    function fund(Router router, uint256 amount) internal {
        (bool ok,) = address(router).call{value: amount}("");
        require(ok);
        router.processFees();
    }

    function dca() internal {
        r = deploy(config(), 8);
        r.bindToken(address(t));
        fund(r, 1 ether);
        r.checkDca(0, block.timestamp);
    }

    function testAllocationAndIsolation() public {
        assertEq(r.gradBoostBalance(), 1 ether);
        assertEq(r.dcaBuybackBalance(), 0);
        vm.expectRevert();
        r.processFees();
    }

    function testGradBelowThreshold() public {
        m.setProgress(7400);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
        assertEq(r.gradBoostBalance(), 1 ether);
    }

    function testGradThresholdAndCooldown() public {
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
        assertEq(r.gradBoostBalance(), 0.8 ether);
        assertEq(t.balanceOf(address(m)), 1001);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
        vm.warp(1060);
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
        assertEq(r.gradBoostBalance(), 0.6 ether);
    }

    function testGradLimitsAndReserve() public {
        vm.expectRevert();
        r.executeGradBoost(0.01 ether, 980, block.timestamp);
        vm.expectRevert();
        r.executeGradBoost(0.26 ether, 980, block.timestamp);
        vm.expectRevert();
        r.executeGradBoost(2 ether, 980, block.timestamp);
    }

    function testGradMigratedBlocked() public {
        m.setMigrated(true);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
    }

    function testSlippageZeroAndDeadline() public {
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 0, block.timestamp);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 979, block.timestamp);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 980, block.timestamp - 1);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 980, block.timestamp + 301);
    }

    function testActualOutputEnforced() public {
        m.setOutput(900);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
        assertEq(r.gradBoostBalance(), 1 ether);
        assertEq(r.lastGradExecution(), 0);
    }

    function testRefundStaysInStrategyReserve() public {
        m.setRefund(0.1 ether);
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
        assertEq(r.gradBoostBalance(), 0.9 ether);
        assertEq(r.totalReceived(), 1 ether);
        vm.expectRevert();
        r.processFees();
    }

    function testPauseDoesNotBlockFeeAccounting() public {
        r.setPaused(true);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
        fund(r, 1 ether);
        assertEq(r.gradBoostBalance(), 2 ether);
        vm.prank(a);
        vm.expectRevert();
        r.setPaused(false);
    }

    function testUnavailableQuoteKeepsReserve() public {
        m.setUnavailable(true);
        vm.expectRevert();
        r.executeGradBoost(0.2 ether, 980, block.timestamp);
        assertEq(r.gradBoostBalance(), 1 ether);
    }

    function nextPrice(uint256 p) internal {
        vm.warp(block.timestamp + 300);
        oracle.set(p, block.timestamp, 120);
    }

    function testDcaBaselineAndNoTriggerAboveThreshold() public {
        dca();
        assertEq(r.anchorPrice(), 10000);
        nextPrice(9100);
        r.checkDca(0, block.timestamp);
        assertEq(r.anchorPrice(), 9100);
        assertEq(r.dcaBuybackBalance(), 1 ether);
    }

    function testDcaRepeatedDropsEveryFiveMinutes() public {
        dca();
        nextPrice(9000);
        r.checkDca(980, block.timestamp);
        assertTrue(r.levelExecuted(2, 0));
        assertEq(r.dcaBuybackBalance(), 0);
        fund(r, 0.4 ether);
        vm.expectRevert();
        r.checkDca(980, block.timestamp);
        nextPrice(8100);
        r.checkDca(980, block.timestamp);
        assertEq(r.dcaBuybackBalance(), 0);
        assertTrue(r.levelExecuted(3, 0));
    }

    function testDcaFlatAndRisingPricesDoNotBuy() public {
        dca();
        nextPrice(9000);
        r.checkDca(980, block.timestamp);
        fund(r, 0.8 ether);
        nextPrice(9000);
        r.checkDca(0, block.timestamp);
        nextPrice(9500);
        r.checkDca(0, block.timestamp);
        assertEq(r.dcaBuybackBalance(), 0.8 ether);
        assertEq(r.anchorPrice(), 9500);
    }

    function testDcaDeepestTierFlushesCompleteBatch() public {
        dca();
        nextPrice(7000);
        r.checkDca(980, block.timestamp);
        assertEq(r.dcaBuybackBalance(), 0);
        assertTrue(r.levelExecuted(2, 2));
        assertFalse(r.levelExecuted(2, 0));
    }

    function testDcaFreshnessAndWindow() public {
        dca();
        nextPrice(7000);
        oracle.set(7000, block.timestamp - 121, 120);
        vm.expectRevert();
        r.checkDca(980, block.timestamp);
        oracle.set(7000, block.timestamp, 119);
        vm.expectRevert();
        r.checkDca(980, block.timestamp);
        oracle.set(7000, block.timestamp + 1, 120);
        vm.expectRevert();
        r.checkDca(980, block.timestamp);
    }

    function testDcaMissedIntervalsResetWithoutCatchupSpend() public {
        dca();
        vm.warp(block.timestamp + 601);
        oracle.set(7000, block.timestamp, 120);
        r.checkDca(0, block.timestamp);
        assertEq(r.dcaBuybackBalance(), 1 ether);
        assertEq(r.anchorPrice(), 7000);
    }

    function testDcaTopupsJoinCompleteFiveMinuteBatch() public {
        dca();
        fund(r, 2 ether);
        nextPrice(9000);
        r.checkDca(980, block.timestamp);
        assertEq(r.dcaBuybackBalance(), 0);
        assertEq(r.dcaPlanSpent(), 3 ether);
    }

    function testDcaMissingResolverAndCancellation() public {
        oracle = StrategyPrice(address(0));
        r = deploy(config(), 8);
        r.bindToken(address(t));
        fund(r, 1 ether);
        vm.expectRevert();
        r.checkDca(0, block.timestamp);
        r.cancelDca();
        assertEq(r.dcaBuybackBalance(), 0);
        assertEq(r.claimable(address(this)), 1 ether);
        fund(r, 1 ether);
        assertEq(r.claimable(address(this)), 2 ether);
        assertEq(address(r).balance, r.outstanding());
    }

    function testDcaCancelRestrictedAndPermanent() public {
        dca();
        vm.prank(a);
        vm.expectRevert();
        r.cancelDca();
        r.cancelDca();
        nextPrice(9000);
        vm.expectRevert();
        r.checkDca(980, block.timestamp);
        vm.expectRevert();
        r.cancelDca();
    }

    function testDcaCannotSkipEligibleBuyWithZeroOutput() public {
        dca();
        nextPrice(9000);
        vm.expectRevert();
        r.checkDca(0, block.timestamp);
        assertEq(r.anchorPrice(), 10000);
        assertEq(r.dcaEpoch(), 1);
    }

    function testDcaPauseAndDeadline() public {
        dca();
        nextPrice(9000);
        r.setPaused(true);
        vm.expectRevert();
        r.checkDca(980, block.timestamp);
        r.setPaused(false);
        vm.expectRevert();
        r.checkDca(980, block.timestamp - 1);
        vm.expectRevert();
        r.checkDca(980, block.timestamp + 301);
    }

    function testDcaRefundReturnsToNextBatch() public {
        dca();
        m.setRefund(0.1 ether);
        nextPrice(9000);
        r.checkDca(980, block.timestamp);
        assertEq(r.dcaBuybackBalance(), 0.1 ether);
        assertEq(r.dcaPlanSpent(), 0.9 ether);
        assertEq(r.totalReceived(), 1 ether);
        vm.expectRevert();
        r.processFees();
    }

    function testBuybackFlushesCompleteBatchEveryFiveMinutes() public {
        r = deploy(config(), 3);
        r.bindToken(address(t));
        fund(r, 1 ether);
        vm.expectRevert();
        r.executeBuyback(0.5 ether, 980);
        vm.expectRevert();
        r.executeBuyback(1 ether, 980);
        vm.warp(1300);
        r.executeBuyback(1 ether, 980);
        assertEq(r.buybackReserve(), 0);
        assertEq(r.totalETHUsedForBuyback(), 1 ether);
        fund(r, 0.4 ether);
        vm.expectRevert();
        r.executeBuyback(0.4 ether, 980);
        vm.warp(1600);
        r.executeBuyback(0.4 ether, 980);
        assertEq(r.buybackReserve(), 0);
    }

    function testBurnFlushesCompleteBatchEveryFiveMinutes() public {
        r = deploy(config(), 4);
        r.bindToken(address(t));
        fund(r, 0.7 ether);
        vm.expectRevert();
        r.executeBurn(0.6 ether, 980);
        vm.warp(block.timestamp + 300);
        r.executeBurn(0.7 ether, 980);
        assertEq(r.burnReserve(), 0);
        assertEq(r.totalETHUsedForBurn(), 0.7 ether);
        assertEq(r.totalTokensBurned(), 1001);
    }

    function testRemovedKindsRejected() public {
        vm.expectRevert();
        deploy(config(), 2);
        vm.expectRevert();
        deploy(config(), 5);
        vm.expectRevert();
        deploy(config(), 9);
    }

    function testInvalidDcaLevelsRejected() public {
        Router.StrategyConfig memory c = config();
        c.levels[1].dropBps = 1000;
        vm.expectRevert();
        deploy(c, 8);
        c = config();
        c.dca.cooldownSeconds = 301;
        vm.expectRevert();
        deploy(c, 8);
    }

    function testTokenFeesCannotCorruptNativeAccounting() public {
        vm.expectRevert();
        r.processToken(address(t));
        assertEq(r.gradBoostBalance(), 1 ether);
    }

    function testDcaSlippageRollsBackReferenceAndSpend() public {
        dca();
        nextPrice(9000);
        m.setOutput(900);
        vm.expectRevert();
        r.checkDca(980, block.timestamp);
        assertEq(r.dcaEpoch(), 1);
        assertEq(r.anchorPrice(), 10000);
        assertEq(r.dcaBuybackBalance(), 1 ether);
    }
}
