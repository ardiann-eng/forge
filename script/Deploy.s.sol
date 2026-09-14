// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Script} from "forge-std/Script.sol";
import {ForgeRouterFactory} from "../contracts/ForgeRouterFactory.sol";
import {PonsMarketAdapter} from "../contracts/PonsMarketAdapter.sol";
import {ForgeBuybackVault} from "../contracts/ForgeBuybackVault.sol";
import {ForgeHolderRewards} from "../contracts/ForgeHolderRewards.sol";
import {IPonsV2} from "../contracts/interfaces/IPonsV2.sol";
contract Deploy is Script {
    function run() external returns(ForgeRouterFactory factory){
        require(block.chainid==4663,"Wrong network");
        require(vm.envBool("DEPLOY_FORGE_MAINNET"),"Deployment not authorized");
        address pons=vm.envAddress("NEXT_PUBLIC_PONS_LAUNCH_CONTRACT");
        address escrow=IPonsV2(pons).feeEscrow();
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        factory=new ForgeRouterFactory(pons,escrow);
        PonsMarketAdapter adapter=new PonsMarketAdapter(pons,IPonsV2(pons).poolManager(),IPonsV2(pons).memeHook());
        ForgeBuybackVault vault=new ForgeBuybackVault(address(factory));
        ForgeHolderRewards rewards=new ForgeHolderRewards(address(factory));
        factory.setAdapters(address(adapter),address(vault),address(rewards));
        vm.stopBroadcast();
    }
}
