// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IForgeAutomationFactory {
    function isRouter(address router) external view returns (bool);
    function priceResolver() external view returns (address);
}

interface IForgeAutomatedRouter {
    function creator() external view returns (address);
    function factory() external view returns (address);
    function token() external view returns (address);
    function priceResolver() external view returns (address);
    function collectFees() external returns (uint256);
    function processFees() external;
    function executeBuyback(uint256 amount, uint256 minTokensOut) external returns (uint256);
    function executeBurn(uint256 amount, uint256 minTokensOut) external returns (uint256);
    function executeGradBoost(uint256 amount, uint256 minOut, uint256 deadline) external;
    function checkDca(uint256 minOut, uint256 deadline) external;
}

interface IForgeAutomationPrice {
    function observe(address token) external;
}

/// @notice Executes constrained FORGE maintenance and reimburses one shared keeper
/// from the creator-funded balance belonging to the affected router.
contract ForgeAutomationExecutor is Ownable2Step, ReentrancyGuard {
    uint256 public constant AUTOMATION_INTERVAL = 5 minutes;
    uint256 public constant MAX_GAS_PRICE = 100 gwei;
    uint256 public constant MAX_REFUND_PER_ACTION = 0.01 ether;
    uint256 private constant REFUND_OVERHEAD_GAS = 45_000;

    uint8 private constant ACTION_COLLECT = 1;
    uint8 private constant ACTION_PROCESS = 2;
    uint8 private constant ACTION_BUYBACK = 3;
    uint8 private constant ACTION_BURN = 4;
    uint8 private constant ACTION_GRAD = 7;
    uint8 private constant ACTION_DCA = 8;
    uint8 private constant ACTION_OBSERVE = 10;

    IForgeAutomationFactory public immutable factory;
    address public keeper;
    mapping(address => uint256) public automationBalance;
    mapping(address => bool) public automationPaused;
    mapping(address => mapping(uint8 => uint256)) public lastExecution;

    error InvalidAddress();
    error InvalidRouter();
    error Unauthorized();
    error InvalidAmount();
    error AutomationUnavailable();
    error TooSoon();
    error TransferFailed();

    event KeeperUpdated(address indexed previousKeeper, address indexed newKeeper);
    event AutomationFunded(address indexed router, address indexed funder, uint256 amount, uint256 balance);
    event AutomationWithdrawn(address indexed router, address indexed recipient, uint256 amount, uint256 balance);
    event AutomationPaused(address indexed router, bool paused);
    event AutomationExecuted(
        address indexed router, uint8 indexed action, address indexed keeper, uint256 reimbursement, uint256 balance
    );

    constructor(address factory_, address keeper_) Ownable(msg.sender) {
        if (factory_.code.length == 0 || keeper_ == address(0)) revert InvalidAddress();
        factory = IForgeAutomationFactory(factory_);
        keeper = keeper_;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert Unauthorized();
        _;
    }

    function setKeeper(address nextKeeper) external onlyOwner {
        if (nextKeeper == address(0)) revert InvalidAddress();
        emit KeeperUpdated(keeper, nextKeeper);
        keeper = nextKeeper;
    }

    function fund(address router) external payable {
        _requireRouter(router);
        if (msg.value == 0) revert InvalidAmount();
        automationBalance[router] += msg.value;
        emit AutomationFunded(router, msg.sender, msg.value, automationBalance[router]);
    }

    function setPaused(address router, bool value) external {
        _requireCreator(router);
        automationPaused[router] = value;
        emit AutomationPaused(router, value);
    }

    function withdraw(address router, uint256 amount, address payable recipient) external nonReentrant {
        _requireCreator(router);
        if (recipient == address(0) || amount == 0 || amount > automationBalance[router]) revert InvalidAmount();
        automationBalance[router] -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit AutomationWithdrawn(router, recipient, amount, automationBalance[router]);
    }

    function executeCollect(address router) external onlyKeeper nonReentrant {
        uint256 gasStart = _start(router, ACTION_COLLECT);
        IForgeAutomatedRouter(router).collectFees();
        _reimburse(router, ACTION_COLLECT, gasStart);
    }

    function executeProcess(address router) external onlyKeeper nonReentrant {
        uint256 gasStart = _start(router, ACTION_PROCESS);
        IForgeAutomatedRouter(router).processFees();
        _reimburse(router, ACTION_PROCESS, gasStart);
    }

    function executeBuyback(address router, uint256 amount, uint256 minOut) external onlyKeeper nonReentrant {
        uint256 gasStart = _start(router, ACTION_BUYBACK);
        IForgeAutomatedRouter(router).executeBuyback(amount, minOut);
        _reimburse(router, ACTION_BUYBACK, gasStart);
    }

    function executeBurn(address router, uint256 amount, uint256 minOut) external onlyKeeper nonReentrant {
        uint256 gasStart = _start(router, ACTION_BURN);
        IForgeAutomatedRouter(router).executeBurn(amount, minOut);
        _reimburse(router, ACTION_BURN, gasStart);
    }

    function executeGradBoost(address router, uint256 amount, uint256 minOut, uint256 deadline)
        external
        onlyKeeper
        nonReentrant
    {
        uint256 gasStart = _start(router, ACTION_GRAD);
        IForgeAutomatedRouter(router).executeGradBoost(amount, minOut, deadline);
        _reimburse(router, ACTION_GRAD, gasStart);
    }

    function executeDca(address router, uint256 minOut, uint256 deadline) external onlyKeeper nonReentrant {
        uint256 gasStart = _start(router, ACTION_DCA);
        IForgeAutomatedRouter(router).checkDca(minOut, deadline);
        _reimburse(router, ACTION_DCA, gasStart);
    }

    function executeObservation(address router) external onlyKeeper nonReentrant {
        uint256 gasStart = _start(router, ACTION_OBSERVE);
        IForgeAutomatedRouter target = IForgeAutomatedRouter(router);
        address resolver = target.priceResolver();
        if (resolver == address(0) || resolver != factory.priceResolver()) revert AutomationUnavailable();
        address token = target.token();
        if (token == address(0)) revert AutomationUnavailable();
        IForgeAutomationPrice(resolver).observe(token);
        _reimburse(router, ACTION_OBSERVE, gasStart);
    }

    function _start(address router, uint8 action) private returns (uint256 gasStart) {
        _requireRouter(router);
        if (automationPaused[router] || automationBalance[router] == 0) revert AutomationUnavailable();
        uint256 last = lastExecution[router][action];
        if (last > 0 && block.timestamp < last + AUTOMATION_INTERVAL) revert TooSoon();
        lastExecution[router][action] = block.timestamp;
        gasStart = gasleft();
    }

    function _reimburse(address router, uint8 action, uint256 gasStart) private {
        uint256 gasPrice = tx.gasprice > MAX_GAS_PRICE ? MAX_GAS_PRICE : tx.gasprice;
        uint256 amount = (gasStart - gasleft() + REFUND_OVERHEAD_GAS) * gasPrice;
        if (amount > MAX_REFUND_PER_ACTION) amount = MAX_REFUND_PER_ACTION;
        uint256 balance = automationBalance[router];
        if (amount > balance) amount = balance;
        automationBalance[router] = balance - amount;
        if (amount > 0) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert TransferFailed();
        }
        emit AutomationExecuted(router, action, msg.sender, amount, automationBalance[router]);
    }

    function _requireRouter(address router) private view {
        if (!factory.isRouter(router) || IForgeAutomatedRouter(router).factory() != address(factory)) {
            revert InvalidRouter();
        }
    }

    function _requireCreator(address router) private view {
        _requireRouter(router);
        if (msg.sender != IForgeAutomatedRouter(router).creator()) revert Unauthorized();
    }
}
