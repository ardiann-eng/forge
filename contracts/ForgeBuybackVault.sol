// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IForgeBuybackVault} from "./interfaces/IForgeMarketAdapter.sol";

/// @notice Dedicated vault holding market-bought tokens for FORGE tokens.
/// Tokens deposited cannot be claimed by arbitrary privileged owners.
contract ForgeBuybackVault is IForgeBuybackVault {
    using SafeERC20 for IERC20;

    address public immutable factory;

    mapping(address => uint256) public override totalETHUsed;
    mapping(address => uint256) public override totalTokensBought;

    event BuybackRecorded(address indexed token, uint256 ethUsed, uint256 tokensBought, uint256 newTotalETH, uint256 newTotalTokens);

    error Unauthorized();

    constructor(address factory_) {
        if (factory_.code.length == 0) revert Unauthorized();
        factory = factory_;
    }

    function recordBuyback(address token, uint256 ethUsed, uint256 tokensBought) external override {
        if (!IForgeRouterRegistry(factory).isRouter(msg.sender)) revert Unauthorized();
        totalETHUsed[token] += ethUsed;
        totalTokensBought[token] += tokensBought;
        emit BuybackRecorded(token, ethUsed, tokensBought, totalETHUsed[token], totalTokensBought[token]);
    }

    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}

interface IForgeRouterRegistry {
    function isRouter(address router) external view returns (bool);
}
