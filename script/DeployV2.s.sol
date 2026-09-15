// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Script} from "forge-std/Script.sol";
import {ForgeRouterFactoryV2} from "../contracts/ForgeRouterFactoryV2.sol";
import {PonsMarketAdapterV2} from "../contracts/PonsMarketAdapterV2.sol";
import {ForgeBuybackVault} from "../contracts/ForgeBuybackVault.sol";
import {ForgeHolderRewards} from "../contracts/ForgeHolderRewards.sol";
import {IPonsV2} from "../contracts/interfaces/IPonsV2.sol";
import {PonsStrategyPrice} from "../contracts/PonsStrategyPrice.sol";
import {ForgeAutomationExecutor} from "../contracts/ForgeAutomationExecutor.sol";
/// @notice Separate V2 deployment. Use a locally managed Foundry keystore signer.
contract DeployV2 is Script {
    function run() external returns (ForgeRouterFactoryV2 factory) {
        require(block.chainid == 4663, "Wrong network");
        address pons = vm.envAddress("NEXT_PUBLIC_PONS_LAUNCH_CONTRACT");
        address sender = vm.envAddress("FORGE_V2_DEPLOYER");
        address keeper = vm.envAddress("FORGE_AUTOMATION_KEEPER_ADDRESS");
        vm.startBroadcast(sender);
        PonsStrategyPrice priceResolver = new PonsStrategyPrice(pons);
        factory = new ForgeRouterFactoryV2(pons, IPonsV2(pons).feeEscrow(), address(priceResolver));
        PonsMarketAdapterV2 adapter = new PonsMarketAdapterV2(pons, IPonsV2(pons).poolManager(), IPonsV2(pons).memeHook());
        ForgeBuybackVault vault = new ForgeBuybackVault(address(factory));
        ForgeHolderRewards rewards = new ForgeHolderRewards(address(factory));
        factory.setAdapters(address(adapter), address(vault), address(rewards));
        new ForgeAutomationExecutor(address(factory), keeper);
        vm.stopBroadcast();
    }
}
