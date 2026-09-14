// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ForgeRouter} from "./ForgeRouter.sol";
import {IPonsV2} from "./interfaces/IPonsV2.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Router deployment registry and adapter wiring. PONS remains the sole token launch engine.
contract ForgeRouterFactory is Ownable2Step {
    IPonsV2 public immutable ponsFactory;
    address public immutable feeEscrow;
    address public marketAdapter;
    address public buybackVault;
    address public holderRewards;

    mapping(address => address) public tokenToRouter;
    mapping(address => address) public routerToToken;
    mapping(address => bool) public isRouter;
    mapping(address => address[]) private creatorRouters;
    address[] public allRouters;

    error InvalidAddress();
    error InvalidBinding();

    event RouterCreated(address indexed router, address indexed creator, string metadataURI);
    event TokenBound(address indexed token, address indexed router, address indexed creator);
    event AdaptersConfigured(address adapter, address vault, address rewards);

    constructor(address pons_, address escrow_) Ownable(msg.sender) {
        if (pons_.code.length == 0 || escrow_.code.length == 0 || IPonsV2(pons_).feeEscrow() != escrow_) revert InvalidAddress();
        ponsFactory = IPonsV2(pons_);
        feeEscrow = escrow_;
    }

    function setAdapters(address adapter_, address vault_, address rewards_) external onlyOwner {
        if (
            (adapter_ != address(0) && adapter_.code.length == 0) ||
            (vault_ != address(0) && vault_.code.length == 0) ||
            (rewards_ != address(0) && rewards_.code.length == 0)
        ) revert InvalidAddress();
        marketAdapter = adapter_;
        buybackVault = vault_;
        holderRewards = rewards_;
        emit AdaptersConfigured(adapter_, vault_, rewards_);
    }

    function createRouter(ForgeRouter.Destination[] calldata flow, string calldata metadataURI) external returns (address router) {
        if (bytes(metadataURI).length == 0 || bytes(metadataURI).length > 256) revert InvalidAddress();
        router = address(new ForgeRouter(msg.sender, feeEscrow, marketAdapter, buybackVault, holderRewards, flow, metadataURI));
        isRouter[router] = true;
        allRouters.push(router);
        creatorRouters[msg.sender].push(router);
        emit RouterCreated(router, msg.sender, metadataURI);
    }

    function bindToken(address router, address token) external {
        if (!isRouter[router] || routerToToken[router] != address(0) || tokenToRouter[token] != address(0)) revert InvalidBinding();
        ForgeRouter r = ForgeRouter(payable(router));
        IPonsV2.LaunchedToken memory launched = ponsFactory.getLaunchedToken(token);
        if (msg.sender != r.creator() || !launched.exists || launched.token != token || launched.deployer != msg.sender || launched.creatorFeeRecipient != router || launched.pairToken != address(0)) {
            revert InvalidBinding();
        }
        tokenToRouter[token] = router;
        routerToToken[router] = token;
        r.bindToken(token);
        emit TokenBound(token, router, msg.sender);
    }

    function routerCount() external view returns (uint256) {
        return allRouters.length;
    }

    function getCreatorRouters(address creator) external view returns (address[] memory) {
        return creatorRouters[creator];
    }
}
