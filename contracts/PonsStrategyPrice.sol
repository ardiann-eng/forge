// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPonsV2, IPonsV2BondingCurve} from "./interfaces/IPonsV2.sol";
import {IForgeStrategyPrice} from "./interfaces/IForgeStrategyPrice.sol";

interface IExtsload {
    function extsload(bytes32 slot) external view returns (bytes32 value);
}

/// @notice Three canonical market observations, >=60s apart, all from earlier blocks.
/// This is sampled confirmation, NOT continuous TWAP or proof of price between samples.
contract PonsStrategyPrice is IForgeStrategyPrice {
    IPonsV2 public immutable pons;
    uint256 private constant Q192 = 1 << 192;
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));

    struct Sample {
        uint256 value;
        uint64 timestamp;
        uint64 blockNumber;
        uint8 lifecycle;
    }
    mapping(address => Sample[3]) private samples;
    error Unavailable();
    event PriceObserved(address indexed token, uint256 price, uint256 timestamp);

    constructor(address pons_) {
        pons = IPonsV2(pons_);
    }

    function spot(address token) public view returns (uint256 value) {
        (value,) = _spot(token);
    }

    function _spot(address token) private view returns (uint256 value, uint8 lifecycle) {
        IPonsV2.LaunchedToken memory l = pons.getLaunchedToken(token);
        if (!l.exists || l.token != token || l.pairToken != address(0)) revert Unavailable();
        lifecycle = l.phase;
        if (lifecycle == 0) {
            if (l.curve.code.length == 0) revert Unavailable();
            IPonsV2BondingCurve c = IPonsV2BondingCurve(l.curve);
            if (c.token() != token || c.pairToken() != address(0) || c.graduated() || c.readyToGraduate()) {
                revert Unavailable();
            }
            (uint256 q, uint256 t) = c.getReserves();
            if (q == 0 || t == 0) revert Unavailable();
            value = Math.mulDiv(q, 1e18, t);
        } else if (lifecycle == 2) {
            address manager = pons.poolManager();
            address hook = pons.memeHook();
            if (manager.code.length == 0) revert Unavailable();
            (address c0, address c1) = address(0) < token ? (address(0), token) : (token, address(0));
            bytes32 poolId = keccak256(abi.encode(c0, c1, l.poolFee, l.tickSpacing, hook));
            bytes32 stateSlot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
            uint160 sqrtPriceX96 = uint160(uint256(IExtsload(manager).extsload(stateSlot)));
            if (sqrtPriceX96 == 0 || sqrtPriceX96 > type(uint128).max) revert Unavailable();
            uint256 squared = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
            value = Math.mulDiv(Q192, 1e18, squared);
        } else {
            revert Unavailable();
        }
        if (value == 0) revert Unavailable();
    }

    function lastObservation(address token) external view returns (uint256) {
        return samples[token][2].timestamp;
    }

    function observe(address token) external {
        Sample[3] storage s = samples[token];
        if (s[2].timestamp != 0 && (block.timestamp < s[2].timestamp + 60 || block.number <= s[2].blockNumber)) {
            revert Unavailable();
        }
        (uint256 value, uint8 lifecycle) = _spot(token);
        if (s[2].timestamp != 0 && s[2].lifecycle != lifecycle) {
            delete s[0];
            delete s[1];
            delete s[2];
        }
        // Gaps discard the previous window; an offline keeper cannot reuse stale samples.
        if (s[2].timestamp != 0 && block.timestamp > s[2].timestamp + 90) {
            delete s[0];
            delete s[1];
        } else {
            s[0] = s[1];
            s[1] = s[2];
        }
        s[2] = Sample(value, uint64(block.timestamp), uint64(block.number), lifecycle);
        emit PriceObserved(token, value, block.timestamp);
    }

    function bounds(address token)
        public
        view
        returns (uint256 low, uint256 high, uint256 updatedAt, uint256 windowSeconds, bool supported)
    {
        Sample[3] memory s = samples[token];
        if (s[0].timestamp == 0 || s[2].blockNumber >= block.number || block.timestamp > s[2].timestamp + 120) {
            return (0, 0, 0, 0, false);
        }
        // Recheck the real lifecycle and include current spot in the conservative bounds.
        uint8 lifecycle;
        try this.spotWithLifecycle(token) returns (uint256 current, uint8 currentLifecycle) {
            low = current;
            high = current;
            lifecycle = currentLifecycle;
        } catch {
            return (0, 0, 0, 0, false);
        }
        for (uint256 i; i < 3; ++i) {
            if (s[i].lifecycle != lifecycle) return (0, 0, 0, 0, false);
            low = Math.min(low, s[i].value);
            high = Math.max(high, s[i].value);
        }
        return (low, high, s[2].timestamp, s[2].timestamp - s[0].timestamp, true);
    }

    function spotWithLifecycle(address token) external view returns (uint256, uint8) {
        return _spot(token);
    }

    function price(address token) external view returns (uint256, uint256, uint256, bool) {
        (, uint256 high, uint256 updated, uint256 window, bool supported) = bounds(token);
        return (high, updated, window, supported);
    }
}
