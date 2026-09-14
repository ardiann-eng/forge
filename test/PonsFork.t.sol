// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {ForgeRouter} from "../contracts/ForgeRouter.sol";
import {ForgeRouterFactory} from "../contracts/ForgeRouterFactory.sol";
import {PonsMarketAdapter} from "../contracts/PonsMarketAdapter.sol";
import {ForgeBuybackVault} from "../contracts/ForgeBuybackVault.sol";
import {ForgeHolderRewards} from "../contracts/ForgeHolderRewards.sol";
import {IPonsV2} from "../contracts/interfaces/IPonsV2.sol";

// ABI shapes verified by Blockscout. These are interfaces, never replacement launch contracts.
interface IPonsLaunch {
    struct Socials {string twitter;string telegram;string discord;string website;string farcaster;}
    struct Params {string name;string symbol;string logo;string description;Socials socials;address creatorFeeRecipient;uint16 creatorTaxBps;bool buybackEnabled;bytes32 expectedEconomics;bytes32 salt;}
    function launchFee() external view returns(uint256);
    function previewLaunchEconomics(uint256,address) external view returns(bytes32);
    function launchToken(Params calldata,uint256,address,address[] calldata) external payable returns(address,address);
}
interface IPonsAtomic {
    function launchAndBuy(IPonsLaunch.Params calldata,uint256,address,uint256,uint256,address,address[] calldata) external payable returns(address,address,uint256);
}
interface ICurveFees {function sweepFees(uint256 minBuybackTokensOut) external;}

/// @notice Optional genuine PONS contract integration on a local RPC fork. Never broadcasts.
contract PonsForkTest is Test {
    address constant PONS=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant ATOMIC=0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address creator; ForgeRouterFactory factory; ForgeRouter router;
    function setUp() public {
        string memory rpc=vm.envOr("PONS_FORK_RPC",string(""));
        if(bytes(rpc).length==0){vm.skip(true);return;}
        vm.createSelectFork(rpc);
        creator=makeAddr("forge-fork-creator");vm.deal(creator,10 ether);
        factory=new ForgeRouterFactory(PONS,IPonsV2(PONS).feeEscrow());
        ForgeRouter.Destination[] memory flow=new ForgeRouter.Destination[](1);
        flow[0]=ForgeRouter.Destination(creator,10000,0);
        vm.prank(creator);router=ForgeRouter(payable(factory.createRouter(flow,"ipfs://fork-test-fixture")));
    }
    function params() internal view returns(IPonsLaunch.Params memory p){p.name="FORGE integration test";p.symbol="FORGETEST";p.creatorFeeRecipient=address(router);p.expectedEconomics=IPonsLaunch(PONS).previewLaunchEconomics(0,address(0));p.salt=keccak256("forge-integration-test");}
    function testForkRealPonsDirectLaunchAndBinding() public {
        IPonsLaunch.Params memory p=params();uint256 fee=IPonsLaunch(PONS).launchFee();
        vm.prank(creator);(address token,)=IPonsLaunch(PONS).launchToken{value:fee}(p,0,address(0),new address[](0));
        IPonsV2.LaunchedToken memory launch=IPonsV2(PONS).getLaunchedToken(token);
        assertTrue(launch.exists);assertEq(launch.creatorFeeRecipient,address(router));assertEq(launch.deployer,creator);
        vm.prank(creator);factory.bindToken(address(router),token);assertEq(router.token(),token);
    }
    function testForkRealAtomicBuyAndCreatorFeeRouting() public {
        IPonsLaunch.Params memory p=params();uint256 fee=IPonsLaunch(PONS).launchFee();
        vm.prank(creator);(address token,address curve,uint256 bought)=IPonsAtomic(ATOMIC).launchAndBuy{value:fee+0.01 ether}(p,0,address(0),0.01 ether,1,creator,new address[](0));
        assertGt(bought,0);vm.prank(creator);factory.bindToken(address(router),token);
        vm.prank(0x49BbF2b70955Fb3a106e084D4BFDa92d334573d2);ICurveFees(curve).sweepFees(0);
        router.collectFees();assertGt(router.totalReceived(),0);
        router.process();uint256 claim=router.claimable(creator);assertGt(claim,0);
        uint256 beforeBalance=creator.balance;vm.prank(creator);router.claim();assertEq(creator.balance,beforeBalance+claim);
    }

    function testForkRealAdaptersWithPons() public {
        IPonsLaunch.Params memory p=params();uint256 fee=IPonsLaunch(PONS).launchFee();
        // Setup adapters
        address pm = IPonsV2(PONS).poolManager();
        address hook = IPonsV2(PONS).memeHook();
        PonsMarketAdapter adapter = new PonsMarketAdapter(PONS, pm, hook);
        ForgeBuybackVault vault = new ForgeBuybackVault(address(factory));
        ForgeHolderRewards hr = new ForgeHolderRewards(address(factory));
        factory.setAdapters(address(adapter), address(vault), address(hr));

        // Flow: 25% Creator, 25% Buyback, 25% Burn, 25% Liquidity
        ForgeRouter.Destination[] memory flow = new ForgeRouter.Destination[](4);
        flow[0] = ForgeRouter.Destination(creator, 2500, 0);
        flow[1] = ForgeRouter.Destination(address(0), 2500, 3); // Buyback
        flow[2] = ForgeRouter.Destination(address(0), 2500, 4); // Buy+Burn
        flow[3] = ForgeRouter.Destination(address(0), 2500, 5); // Liquidity

        vm.prank(creator);
        ForgeRouter customRouter = ForgeRouter(payable(factory.createRouter(flow, "ipfs://fork-adapters")));

        p.creatorFeeRecipient = address(customRouter);
        p.salt = keccak256("forge-adapters-fork-test");

        vm.prank(creator);
        (address token, address curve, uint256 bought) = IPonsAtomic(ATOMIC).launchAndBuy{value: fee + 0.05 ether}(p, 0, address(0), 0.05 ether, 1, creator, new address[](0));
        assertGt(bought, 0);

        vm.prank(creator);
        factory.bindToken(address(customRouter), token);

        // Sweep fees
        vm.prank(0x49BbF2b70955Fb3a106e084D4BFDa92d334573d2);
        ICurveFees(curve).sweepFees(0);

        customRouter.collectFees();
        assertGt(customRouter.totalReceived(), 0);

        customRouter.process();
        assertGt(customRouter.claimable(creator), 0);
        assertGt(customRouter.buybackReserve(), 0);
        assertGt(customRouter.burnReserve(), 0);
        assertGt(customRouter.liquidityReserve(), 0);

        // Execute real buyback against live PONS curve
        uint256 bbAmount = customRouter.buybackReserve();
        uint256 boughtTokens = customRouter.executeBuyback(bbAmount, 1);
        assertGt(boughtTokens, 0);
        assertEq(customRouter.buybackReserve(), 0);
        assertEq(vault.totalETHUsed(token), bbAmount);
        assertEq(vault.totalTokensBought(token), boughtTokens);

        // Execute real buy+burn against live PONS curve
        uint256 burnAmount = customRouter.burnReserve();
        uint256 burnedTokens = customRouter.executeBurn(burnAmount, 1);
        assertGt(burnedTokens, 0);
        assertEq(customRouter.burnReserve(), 0);
    }
}
