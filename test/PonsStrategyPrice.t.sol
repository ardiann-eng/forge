// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {PonsStrategyPrice} from "../contracts/PonsStrategyPrice.sol";
import {IPonsV2} from "../contracts/interfaces/IPonsV2.sol";

contract SampleCurve {
    address public token = address(0x123);
    address public pairToken;
    bool public graduated;
    bool public readyToGraduate;
    uint256 public quote = 10000;

    function getReserves() external view returns (uint256, uint256) {
        return (quote, 1e18);
    }

    function setQuote(uint256 q) external {
        quote = q;
    }

    function migrate() external {
        graduated = true;
    }
}

contract SamplePoolManager {
    bytes32 public slot0 = bytes32(uint256(uint160(1 << 96)));

    function extsload(bytes32) external view returns (bytes32) {
        return slot0;
    }

    function setSqrtPrice(uint160 value) external {
        slot0 = bytes32(uint256(value));
    }
}

contract SampleFactory {
    address public curve;
    address public poolManager;
    address public memeHook = address(0x456);
    uint8 public phase;

    constructor(address c, address manager) {
        curve = c;
        poolManager = manager;
    }

    function setPhase(uint8 value) external {
        phase = value;
    }

    function getLaunchedToken(address t) external view returns (IPonsV2.LaunchedToken memory l) {
        l.token = t;
        l.curve = curve;
        l.exists = t == address(0x123);
        l.phase = phase;
        l.poolFee = 3000;
        l.tickSpacing = 60;
    }
}

contract PonsStrategyPriceTest is Test {
    PonsStrategyPrice p;
    SampleCurve c;
    SampleFactory f;
    SamplePoolManager manager;
    address t = address(0x123);

    function setUp() public {
        vm.warp(1000);
        vm.roll(100);
        c = new SampleCurve();
        manager = new SamplePoolManager();
        f = new SampleFactory(address(c), address(manager));
        p = new PonsStrategyPrice(address(f));
    }

    function tick() internal {
        vm.warp(vm.getBlockTimestamp() + 60);
        vm.roll(vm.getBlockNumber() + 1);
    }

    function ready() internal {
        p.observe(t);
        tick();
        p.observe(t);
        tick();
        p.observe(t);
        vm.roll(vm.getBlockNumber() + 1);
    }

    function testWarmupAndSameBlockCannotExecute() public {
        p.observe(t);
        (,,,, bool ok) = p.bounds(t);
        assertFalse(ok);
        tick();
        p.observe(t);
        tick();
        p.observe(t);
        (,,,, ok) = p.bounds(t);
        assertFalse(ok);
        vm.roll(vm.getBlockNumber() + 1);
        (uint256 low, uint256 high,, uint256 window, bool supported) = p.bounds(t);
        assertTrue(supported);
        assertEq(low, 10000);
        assertEq(high, 10000);
        assertEq(window, 120);
    }

    function testOneLowObservationCannotTriggerDip() public {
        ready();
        c.setQuote(5000);
        tick();
        p.observe(t);
        vm.roll(vm.getBlockNumber() + 1);
        (uint256 low, uint256 high,,,) = p.bounds(t);
        assertEq(low, 5000);
        assertEq(high, 10000);
    }

    function testCurrentRecoveryIncludedInUpperBound() public {
        ready();
        c.setQuote(12000);
        (, uint256 high,,,) = p.bounds(t);
        assertEq(high, 12000);
    }

    function testSpacingAndGaps() public {
        p.observe(t);
        vm.expectRevert();
        p.observe(t);
        vm.warp(vm.getBlockTimestamp() + 91);
        vm.roll(vm.getBlockNumber() + 1);
        p.observe(t);
        (,,,, bool ok) = p.bounds(t);
        assertFalse(ok);
        tick();
        p.observe(t);
        tick();
        p.observe(t);
        vm.roll(vm.getBlockNumber() + 1);
        (,,,, ok) = p.bounds(t);
        assertTrue(ok);
    }

    function testStaleAndSweptFailClosed() public {
        ready();
        vm.warp(vm.getBlockTimestamp() + 121);
        (,,,, bool ok) = p.bounds(t);
        assertFalse(ok);
        ready();
        f.setPhase(1);
        (,,,, ok) = p.bounds(t);
        assertFalse(ok);
        vm.expectRevert();
        p.observe(t);
    }

    function testMigrationRequiresFreshWindowAndThenWorks() public {
        ready();
        f.setPhase(2);
        (,,,, bool ok) = p.bounds(t);
        assertFalse(ok);
        tick();
        p.observe(t);
        (,,,, ok) = p.bounds(t);
        assertFalse(ok);
        tick();
        p.observe(t);
        tick();
        p.observe(t);
        vm.roll(vm.getBlockNumber() + 1);
        (uint256 low, uint256 high,, uint256 window, bool supported) = p.bounds(t);
        assertTrue(supported);
        assertEq(low, 1e18);
        assertEq(high, 1e18);
        assertEq(window, 120);
    }

    function testUnknownTokenRejected() public {
        vm.expectRevert();
        p.observe(address(0x456));
    }
}
