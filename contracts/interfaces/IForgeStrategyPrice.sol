// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
/// @notice Conservative bounds across spaced canonical price observations (not a TWAP).
interface IForgeStrategyPrice {
    function price(address token) external view returns(uint256 nativePerTokenX18,uint256 updatedAt,uint256 windowSeconds,bool supported);
    function bounds(address token) external view returns(uint256 low,uint256 high,uint256 updatedAt,uint256 windowSeconds,bool supported);
}
