// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ForgeAutomationExecutor} from "../contracts/ForgeAutomationExecutor.sol";

contract AutomationFactoryMock {
    mapping(address => bool) public isRouter;
    address public priceResolver;

    function register(address router) external {
        isRouter[router] = true;
    }

    function setPriceResolver(address resolver) external {
        priceResolver = resolver;
    }
}

contract AutomationPriceMock {
    uint256 public observations;

    function observe(address) external {
        ++observations;
    }
}

contract AutomationRouterMock {
    address public immutable creator;
    address public immutable factory;
    address public token = address(0xCAFE);
    address public priceResolver;
    uint256 public calls;
    bool public fail;

    constructor(address creator_, address factory_, address resolver_) {
        creator = creator_;
        factory = factory_;
        priceResolver = resolver_;
    }

    function setFail(bool value) external {
        fail = value;
    }

    function _called() private {
        if (fail) revert("failed action");
        ++calls;
    }

    function collectFees() external returns (uint256) {
        _called();
        return 1;
    }

    function processFees() external {
        _called();
    }

    function executeBuyback(uint256, uint256) external returns (uint256) {
        _called();
        return 1;
    }

    function executeBurn(uint256, uint256) external returns (uint256) {
        _called();
        return 1;
    }

    function executeGradBoost(uint256, uint256, uint256) external {
        _called();
    }

    function checkDca(uint256, uint256) external {
        _called();
    }

}

contract ForgeAutomationExecutorTest is Test {
    address creator = address(0xA11CE);
    address keeper = address(0xBEEF);
    address stranger = address(0xBAD);
    AutomationFactoryMock factory;
    AutomationPriceMock resolver;
    AutomationRouterMock router;
    ForgeAutomationExecutor executor;

    function setUp() external {
        factory = new AutomationFactoryMock();
        resolver = new AutomationPriceMock();
        factory.setPriceResolver(address(resolver));
        router = new AutomationRouterMock(creator, address(factory), address(resolver));
        factory.register(address(router));
        executor = new ForgeAutomationExecutor(address(factory), keeper);
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        executor.fund{value: 0.1 ether}(address(router));
        vm.txGasPrice(1 gwei);
        vm.warp(1_000);
    }

    function testKeeperExecutesAndRouterBalancePaysActualGas() external {
        uint256 keeperBefore = keeper.balance;
        uint256 balanceBefore = executor.automationBalance(address(router));

        vm.prank(keeper);
        executor.executeBuyback(address(router), 1, 1);

        assertEq(router.calls(), 1);
        assertGt(keeper.balance, keeperBefore);
        assertLt(executor.automationBalance(address(router)), balanceBefore);
    }

    function testEachActionHasIndependentFiveMinuteCadence() external {
        vm.startPrank(keeper);
        executor.executeCollect(address(router));
        executor.executeProcess(address(router));
        vm.expectRevert(ForgeAutomationExecutor.TooSoon.selector);
        executor.executeCollect(address(router));
        vm.warp(block.timestamp + 5 minutes);
        executor.executeCollect(address(router));
        vm.stopPrank();
        assertEq(router.calls(), 3);
    }

    function testRevertingActionCannotTakeReimbursement() external {
        router.setFail(true);
        uint256 balanceBefore = executor.automationBalance(address(router));
        uint256 keeperBefore = keeper.balance;
        vm.prank(keeper);
        vm.expectRevert("failed action");
        executor.executeBurn(address(router), 1, 1);
        assertEq(executor.automationBalance(address(router)), balanceBefore);
        assertEq(keeper.balance, keeperBefore);
    }

    function testOnlyCreatorCanPauseAndWithdraw() external {
        vm.startPrank(stranger);
        vm.expectRevert(ForgeAutomationExecutor.Unauthorized.selector);
        executor.setPaused(address(router), true);
        vm.expectRevert(ForgeAutomationExecutor.Unauthorized.selector);
        executor.withdraw(address(router), 1, payable(stranger));
        vm.stopPrank();

        vm.prank(creator);
        executor.setPaused(address(router), true);
        vm.prank(keeper);
        vm.expectRevert(ForgeAutomationExecutor.AutomationUnavailable.selector);
        executor.executeProcess(address(router));

        uint256 creatorBefore = creator.balance;
        vm.prank(creator);
        executor.withdraw(address(router), 0.1 ether, payable(creator));
        assertEq(creator.balance, creatorBefore + 0.1 ether);
        assertEq(executor.automationBalance(address(router)), 0);
    }

    function testKeeperCanUpdateOnlyThroughOwner() external {
        vm.prank(stranger);
        vm.expectRevert();
        executor.setKeeper(stranger);
        executor.setKeeper(stranger);
        assertEq(executor.keeper(), stranger);
    }

    function testObservationUsesFactoryResolverAndRouterToken() external {
        vm.prank(keeper);
        executor.executeObservation(address(router));
        assertEq(resolver.observations(), 1);
    }
}
