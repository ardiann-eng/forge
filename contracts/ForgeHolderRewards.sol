// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IForgeHolderRewards} from "./interfaces/IForgeMarketAdapter.sol";

/// @notice Scalable claim-based holder reward distribution using Merkle trees.
contract ForgeHolderRewards is IForgeHolderRewards, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable factory;

    struct Epoch {
        address token;
        address rewardAsset; // address(0) for native ETH
        uint256 totalRewards;
        uint256 snapshotBlock;
        bytes32 merkleRoot;
        uint256 totalClaimed;
    }

    uint256 public nextEpochId;
    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(address => bool)) public override hasClaimed;
    mapping(address => uint256[]) private _tokenEpochs;

    error InvalidEpoch();
    error InvalidAmount();
    error AlreadyClaimed();
    error InvalidProof();
    error TransferFailed();
    error Unauthorized();

    event EpochCreated(
        uint256 indexed epochId,
        address indexed token,
        address indexed rewardAsset,
        uint256 totalRewards,
        bytes32 merkleRoot,
        uint256 snapshotBlock
    );
    event RewardClaimed(
        uint256 indexed epochId,
        address indexed token,
        address indexed account,
        uint256 amount
    );

    receive() external payable {}

    constructor(address factory_) {
        if (factory_.code.length == 0) revert Unauthorized();
        factory = factory_;
    }

    function createEpoch(
        address token,
        bytes32 merkleRoot,
        uint256 snapshotBlock
    ) external payable override returns (uint256 epochId) {
        if (!IForgeRouterRegistry(factory).isRouter(msg.sender)) revert Unauthorized();
        if (msg.value == 0 || merkleRoot == bytes32(0)) revert InvalidAmount();
        epochId = nextEpochId++;
        epochs[epochId] = Epoch({
            token: token,
            rewardAsset: address(0),
            totalRewards: msg.value,
            snapshotBlock: snapshotBlock,
            merkleRoot: merkleRoot,
            totalClaimed: 0
        });
        _tokenEpochs[token].push(epochId);
        emit EpochCreated(epochId, token, address(0), msg.value, merkleRoot, snapshotBlock);
    }

    function createTokenEpoch(
        address token,
        address rewardAsset,
        uint256 amount,
        bytes32 merkleRoot,
        uint256 snapshotBlock
    ) external returns (uint256 epochId) {
        if (!IForgeRouterRegistry(factory).isRouter(msg.sender)) revert Unauthorized();
        if (amount == 0 || merkleRoot == bytes32(0) || rewardAsset == address(0)) revert InvalidAmount();
        IERC20(rewardAsset).safeTransferFrom(msg.sender, address(this), amount);
        epochId = nextEpochId++;
        epochs[epochId] = Epoch({
            token: token,
            rewardAsset: rewardAsset,
            totalRewards: amount,
            snapshotBlock: snapshotBlock,
            merkleRoot: merkleRoot,
            totalClaimed: 0
        });
        _tokenEpochs[token].push(epochId);
        emit EpochCreated(epochId, token, rewardAsset, amount, merkleRoot, snapshotBlock);
    }

    function claim(
        uint256 epochId,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) external override nonReentrant {
        Epoch storage ep = epochs[epochId];
        if (ep.totalRewards == 0) revert InvalidEpoch();
        if (hasClaimed[epochId][account]) revert AlreadyClaimed();

        // Standard double-hash leaf to prevent second-preimage collision
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verify(proof, ep.merkleRoot, leaf)) revert InvalidProof();

        hasClaimed[epochId][account] = true;
        ep.totalClaimed += amount;

        if (ep.rewardAsset == address(0)) {
            (bool ok,) = payable(account).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(ep.rewardAsset).safeTransfer(account, amount);
        }

        emit RewardClaimed(epochId, ep.token, account, amount);
    }

    function getTokenEpochs(address token) external view returns (uint256[] memory) {
        return _tokenEpochs[token];
    }
}

interface IForgeRouterRegistry {
    function isRouter(address router) external view returns (bool);
}
