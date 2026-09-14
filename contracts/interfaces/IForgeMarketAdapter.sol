// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

enum TokenLifecycle {
    UNKNOWN,
    BONDING,
    GRADUATED,
    MIGRATED
}

interface IForgeMarketAdapter {
    function getTokenLifecycle(address token) external view returns (TokenLifecycle);
    function getBondingMarket(address token) external view returns (address);
    function getMigratedMarket(address token) external view returns (bytes32 poolId, address poolManager, address hook);
    function canBuy(address token) external view returns (bool);
    function quoteBuy(address token, uint256 amountIn) external view returns (uint256 amountOut);
    function buy(address token, uint256 minAmountOut) external payable returns (uint256 amountOut);
    function buy(address token, uint256 minAmountOut, address recipient) external payable returns (uint256 amountOut);
}

interface IForgeBuybackVault {
    function recordBuyback(address token, uint256 ethUsed, uint256 tokensBought) external;
    function totalETHUsed(address token) external view returns (uint256);
    function totalTokensBought(address token) external view returns (uint256);
}

interface IForgeHolderRewards {
    function createEpoch(address token, bytes32 merkleRoot, uint256 snapshotBlock) external payable returns (uint256 epochId);
    function claim(uint256 epochId, address account, uint256 amount, bytes32[] calldata proof) external;
    function hasClaimed(uint256 epochId, address account) external view returns (bool);
}
