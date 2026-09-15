// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {ForgeRouterV2 as Router} from "../contracts/ForgeRouterV2.sol";
import {ForgeRouterFactoryV2} from "../contracts/ForgeRouterFactoryV2.sol";
import {PonsMarketAdapterV2} from "../contracts/PonsMarketAdapterV2.sol";
import {ForgeBuybackVault} from "../contracts/ForgeBuybackVault.sol";
import {ForgeHolderRewards} from "../contracts/ForgeHolderRewards.sol";
import {IPonsV2} from "../contracts/interfaces/IPonsV2.sol";
import {IPonsV2BondingCurve, IPoolManager, IUnlockCallback} from "../contracts/interfaces/IPonsV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PonsStrategyPrice} from "../contracts/PonsStrategyPrice.sol";
import {IPonsLaunch, IPonsAtomic, ICurveFees} from "./PonsFork.t.sol";

interface IPonsGraduation {
    function createGraduatedPool(address token) external returns (uint256);
}

interface IPoolManagerSync {
    function sync(address currency) external;
}

contract ForkV4Seller is IUnlockCallback {
    IPoolManager immutable manager;
    bytes32 active;

    constructor(address manager_) {
        manager = IPoolManager(manager_);
    }
    receive() external payable {}

    function sell(IPoolManager.PoolKey memory key, address token, uint256 amount, address recipient)
        external
        returns (uint256 ethOut)
    {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        bytes memory data = abi.encode(key, token, amount, recipient);
        active = keccak256(data);
        ethOut = abi.decode(manager.unlock(data), (uint256));
        active = bytes32(0);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager) && active == keccak256(data));
        active = bytes32(0);
        (IPoolManager.PoolKey memory key, address token, uint256 amount, address recipient) =
            abi.decode(data, (IPoolManager.PoolKey, address, uint256, address));
        int256 delta = manager.swap(
            key, IPoolManager.SwapParams(false, -int256(amount), 1461446703485210103287273052203988822378723970341), ""
        );
        uint256 tokenOwed = uint256(-int256(int128(delta)));
        uint256 ethOut = uint256(int256(int128(delta >> 128)));
        IPoolManagerSync(address(manager)).sync(token);
        IERC20(token).transfer(address(manager), tokenOwed);
        manager.settle();
        manager.take(address(0), recipient, ethOut);
        return abi.encode(ethOut);
    }
}

contract ForgeStrategiesForkTest is Test {
    address constant PONS = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant ATOMIC = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    ForgeRouterFactoryV2 factory;
    PonsMarketAdapterV2 adapter;
    Router router;
    address token;
    address curve;
    address creator;

    function setUp() public {
        string memory rpc = vm.envOr("PONS_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        creator = makeAddr("strategy creator");
        vm.deal(creator, 10 ether);
        vm.deal(address(this), 10 ether);
        PonsStrategyPrice priceResolver = new PonsStrategyPrice(PONS);
        factory = new ForgeRouterFactoryV2(PONS, IPonsV2(PONS).feeEscrow(), address(priceResolver));
        adapter = new PonsMarketAdapterV2(PONS, IPonsV2(PONS).poolManager(), IPonsV2(PONS).memeHook());
        factory.setAdapters(
            address(adapter),
            address(new ForgeBuybackVault(address(factory))),
            address(new ForgeHolderRewards(address(factory)))
        );
        Router.StrategyConfig memory c;
        c.triggerProgressBps = 0;
        c.grad = Router.Limits(0.00001 ether, 0.25 ether, 200, 60);
        c.dca = Router.Limits(c.grad.minExecutionNative, c.grad.maxExecutionNative, c.grad.slippageBps, 300);
        c.levels = new Router.Level[](1);
        c.levels[0] = Router.Level(100, 10000);
        Router.Destination[] memory f = new Router.Destination[](2);
        f[0] = Router.Destination(address(0), 8000, 7);
        f[1] = Router.Destination(address(0), 2000, 8);
        vm.prank(creator);
        router = Router(payable(factory.createRouter(f, "ipfs://v2-fork", c)));
        IPonsLaunch.Params memory p;
        p.name = "FORGE V2 fork";
        p.symbol = "FV2";
        p.creatorFeeRecipient = address(router);
        p.expectedEconomics = IPonsLaunch(PONS).previewLaunchEconomics(0, address(0));
        p.salt = keccak256("v2-fork");
        uint256 fee = IPonsLaunch(PONS).launchFee();
        vm.prank(creator);
        (token, curve,) = IPonsAtomic(ATOMIC).launchAndBuy{value: fee + 0.05 ether}(
            p, 0, address(0), 0.05 ether, 1, creator, new address[](0)
        );
        vm.prank(creator);
        factory.bindToken(address(router), token);
    }

    function testForkRealFeeCollectionAndV2GradBuy() public {
        vm.prank(0x49BbF2b70955Fb3a106e084D4BFDa92d334573d2);
        ICurveFees(curve).sweepFees(0);
        router.collectFees();
        router.processFees();
        uint256 amount = router.gradBoostBalance();
        assertGt(amount, 0);
        uint256 quote = adapter.quoteBuyForRecipient(token, amount, address(router));
        assertGt(quote, 0);
        router.executeGradBoost(amount, quote * 9800 / 10000, block.timestamp + 60);
        assertEq(router.gradBoostBalance(), 0);
    }

    function testForkDcaFailClosed() public {
        (bool ok,) = address(router).call{value: 0.1 ether}("");
        require(ok);
        router.processFees();
        vm.prank(creator);
        vm.expectRevert();
        router.checkDca(0, block.timestamp);
        assertEq(router.dcaBuybackBalance(), 0.02 ether);
    }

    function observations() internal {
        PonsStrategyPrice p = PonsStrategyPrice(factory.priceResolver());
        for (uint256 i; i < 3; ++i) {
            vm.warp(vm.getBlockTimestamp() + 60);
            vm.roll(vm.getBlockNumber() + 1);
            p.observe(token);
        }
        vm.roll(vm.getBlockNumber() + 1);
    }

    function testForkRealPonsDipDcaBuy() public {
        (bool ok,) = address(router).call{value: 0.1 ether}("");
        require(ok);
        router.processFees();
        vm.warp(vm.getBlockTimestamp() + 3600);
        observations();
        router.checkDca(0, block.timestamp);
        uint256 initial = router.anchorPrice();
        vm.startPrank(creator);
        IERC20(token).approve(curve, type(uint256).max);
        IPonsV2BondingCurve(curve).sell(IERC20(token).balanceOf(creator) * 9 / 10, 1, creator);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 120);
        observations();
        (bool due,, uint256 amount,, uint256 high) = router.previewDca();
        assertTrue(due);
        assertLt(high, initial * 9900 / 10000);
        assertGt(amount, 0);
        uint256 quote = adapter.quoteBuyForRecipient(token, amount, address(router));
        router.checkDca(quote * 9800 / 10000, block.timestamp + 60);
        assertGt(router.lastDcaExecution(), 0);
        assertEq(router.dcaBuybackBalance(), 0);
        assertGt(IERC20(token).balanceOf(router.buybackVault()), 0);
    }

    function testForkMigratedDipDcaBuy() public {
        vm.startPrank(creator);
        IPonsV2BondingCurve(curve).buy{value: 5 ether}(5 ether, 1, creator);
        vm.stopPrank();
        IPonsGraduation(PONS).createGraduatedPool(token);
        assertEq(IPonsV2(PONS).getLaunchedToken(token).phase, 2);
        (bool ok,) = address(router).call{value: 0.1 ether}("");
        require(ok);
        router.processFees();
        vm.warp(vm.getBlockTimestamp() + 120);
        observations();
        router.checkDca(0, block.timestamp);
        uint256 initial = router.anchorPrice();
        IPonsV2.LaunchedToken memory launch = IPonsV2(PONS).getLaunchedToken(token);
        IPoolManager.PoolKey memory key =
            IPoolManager.PoolKey(address(0), token, launch.poolFee, launch.tickSpacing, IPonsV2(PONS).memeHook());
        ForkV4Seller seller = new ForkV4Seller(IPonsV2(PONS).poolManager());
        uint256 sellAmount = IERC20(token).balanceOf(creator) / 4;
        vm.startPrank(creator);
        IERC20(token).approve(address(seller), sellAmount);
        seller.sell(key, token, sellAmount, creator);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 120);
        observations();
        (bool due,, uint256 amount,, uint256 high) = router.previewDca();
        assertTrue(due);
        assertLt(high, initial * 9900 / 10000);
        assertGt(amount, 0);
        uint256 quote = adapter.quoteBuyForRecipient(token, amount, address(router));
        router.checkDca(quote * 9800 / 10000, block.timestamp + 60);
        assertGt(router.lastDcaExecution(), 0);
        assertGt(IERC20(token).balanceOf(router.buybackVault()), 0);
    }
}
