// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {ForgeRouter} from "../contracts/ForgeRouter.sol";
import {ForgeRouterFactory} from "../contracts/ForgeRouterFactory.sol";
import {IPonsV2} from "../contracts/interfaces/IPonsV2.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Test harnesses only; no launch economics and never deployed by application scripts.
contract EscrowHarness {
    receive() external payable {}
    function claim() external returns (uint256 n) { n=address(this).balance; (bool ok,)=payable(msg.sender).call{value:n}(""); require(ok); }
}
contract PonsRecordHarness {
    address public feeEscrow;
    IPonsV2.LaunchedToken private record;
    constructor(address escrow){feeEscrow=escrow;}
    function setRecord(IPonsV2.LaunchedToken memory r) external {record=r;}
    function getLaunchedToken(address) external view returns(IPonsV2.LaunchedToken memory){return record;}
}
contract AssetHarness is ERC20 {constructor() ERC20("Test fixture","FIX"){_mint(msg.sender,100 ether);}}
contract RejectingRecipient {receive() external payable {revert();} function claim(ForgeRouter r) external {r.claim();}}
contract ReenteringRecipient {
    ForgeRouter public router; bool public reentered;
    function set(ForgeRouter r) external {router=r;}
    function claim() external {router.claim();}
    receive() external payable {(reentered,)=address(router).call(abi.encodeCall(router.claim,()));}
}
contract ForgeRouterTest is Test {
    ForgeRouter router; ForgeRouterFactory factory; EscrowHarness escrow; PonsRecordHarness pons;
    address creator=makeAddr("creator"); address treasury=makeAddr("treasury");
    function flow() internal view returns(ForgeRouter.Destination[] memory d){d=new ForgeRouter.Destination[](2);d[0]=ForgeRouter.Destination(creator,4000,0);d[1]=ForgeRouter.Destination(treasury,6000,1);}
    function setUp() public {escrow=new EscrowHarness();pons=new PonsRecordHarness(address(escrow));factory=new ForgeRouterFactory(address(pons),address(escrow));vm.prank(creator);router=ForgeRouter(payable(factory.createRouter(flow(),"ipfs://test-fixture")));vm.deal(address(this),100 ether);}
    function deposit(uint256 n) internal {(bool ok,)=address(router).call{value:n}("");assertTrue(ok);}
    function testCreationAndRegistry() public view {assertEq(router.creator(),creator);assertEq(factory.routerCount(),1);assertEq(factory.getCreatorRouters(creator)[0],address(router));assertEq(router.getDestinations()[1].bps,6000);}
    function testOnlyOwnerConfiguresAdapters() public {vm.prank(creator);vm.expectRevert();factory.setAdapters(address(pons),address(escrow),address(router));factory.setAdapters(address(pons),address(escrow),address(router));assertEq(factory.marketAdapter(),address(pons));}
    function testAdaptersMustBeContracts() public {vm.expectRevert(ForgeRouterFactory.InvalidAddress.selector);factory.setAdapters(creator,address(0),address(0));}
    function testExactBps() public {ForgeRouter.Destination[] memory d=flow();d[0].bps=3999;vm.expectRevert(ForgeRouter.InvalidConfiguration.selector);factory.createRouter(d,"ipfs://test");}
    function testZeroAddress() public {ForgeRouter.Destination[] memory d=flow();d[1].recipient=address(0);vm.prank(creator);vm.expectRevert(ForgeRouter.InvalidConfiguration.selector);factory.createRouter(d,"ipfs://test");}
    function testDuplicateDestination() public {ForgeRouter.Destination[] memory d=flow();d[1].recipient=creator;vm.prank(creator);vm.expectRevert(ForgeRouter.InvalidConfiguration.selector);factory.createRouter(d,"ipfs://test");}
    function testUnsupportedKind() public {ForgeRouter.Destination[] memory d=flow();d[1].kind=3;vm.prank(creator);vm.expectRevert(ForgeRouter.InvalidConfiguration.selector);factory.createRouter(d,"ipfs://test");}
    function testAccountingMultipleDepositsAndClaims() public {deposit(1 ether);router.process();deposit(2 ether);router.process();assertEq(router.totalReceived(),3 ether);assertEq(router.totalProcessed(),3 ether);assertEq(router.claimable(creator),1.2 ether);vm.prank(creator);router.claim();assertEq(creator.balance,1.2 ether);assertEq(router.outstanding(),1.8 ether);vm.prank(creator);vm.expectRevert(ForgeRouter.NothingToClaim.selector);router.claim();vm.expectRevert(ForgeRouter.NothingToProcess.selector);router.process();}
    function testRounding() public {deposit(1);router.process();assertEq(router.claimable(creator),0);assertEq(router.claimable(treasury),1);}
    function testFuzzConservation(uint96 n) public {vm.assume(n>0);vm.deal(address(this),n);deposit(n);router.process();assertEq(router.claimable(creator)+router.claimable(treasury),n);assertEq(router.outstanding(),address(router).balance);}
    function testCollectEscrow() public {vm.deal(address(escrow),1 ether);router.collectFees();assertEq(router.totalReceived(),1 ether);router.process();assertEq(router.claimable(creator),0.4 ether);}
    function testForcedNativeAccounting() public {vm.deal(address(router),1 ether);router.process();assertEq(router.totalReceived(),1 ether);}
    function testERC20Pull() public {AssetHarness asset=new AssetHarness();asset.transfer(address(router),10 ether);router.processToken(address(asset));assertEq(router.tokenClaimable(address(asset),creator),4 ether);vm.prank(creator);router.claimToken(address(asset));assertEq(asset.balanceOf(creator),4 ether);}
    function testRejectedClaimCannotBlockOtherRecipient() public {RejectingRecipient bad=new RejectingRecipient();ForgeRouter.Destination[] memory d=flow();d[1].recipient=address(bad);vm.prank(creator);ForgeRouter r=ForgeRouter(payable(factory.createRouter(d,"ipfs://test")));vm.deal(address(r),1 ether);r.process();vm.expectRevert(ForgeRouter.TransferFailed.selector);bad.claim(r);assertEq(r.claimable(address(bad)),0.6 ether);vm.prank(creator);r.claim();assertEq(creator.balance,0.4 ether);}
    function testReentrancy() public {ReenteringRecipient bad=new ReenteringRecipient();ForgeRouter.Destination[] memory d=flow();d[1].recipient=address(bad);vm.prank(creator);ForgeRouter r=ForgeRouter(payable(factory.createRouter(d,"ipfs://test")));bad.set(r);vm.deal(address(r),1 ether);r.process();bad.claim();assertFalse(bad.reentered());assertEq(address(bad).balance,0.6 ether);}
    function testUnauthorizedBinding() public {vm.expectRevert(ForgeRouter.Unauthorized.selector);router.bindToken(address(pons));vm.expectRevert(ForgeRouterFactory.InvalidBinding.selector);factory.bindToken(address(router),address(pons));}
    function testBindingChecksProvenanceAndReceiver() public {IPonsV2.LaunchedToken memory r;r.token=address(pons);r.deployer=creator;r.creatorFeeRecipient=address(router);r.exists=true;pons.setRecord(r);vm.prank(creator);factory.bindToken(address(router),address(pons));assertEq(router.token(),address(pons));assertEq(factory.tokenToRouter(address(pons)),address(router));vm.prank(creator);vm.expectRevert(ForgeRouterFactory.InvalidBinding.selector);factory.bindToken(address(router),address(pons));}
    function testRejectUnrelatedToken() public {IPonsV2.LaunchedToken memory r;r.token=address(pons);r.deployer=creator;r.creatorFeeRecipient=treasury;r.exists=true;pons.setRecord(r);vm.prank(creator);vm.expectRevert(ForgeRouterFactory.InvalidBinding.selector);factory.bindToken(address(router),address(pons));}
    function testReceiptAndProcessEvents() public {vm.expectEmit(true,false,false,true,address(router));emit ForgeRouter.FeesReceived(address(this),1 ether);deposit(1 ether);vm.expectEmit(true,true,false,true,address(router));emit ForgeRouter.ClaimableCreated(address(0),creator,0.4 ether);router.process();}
}
