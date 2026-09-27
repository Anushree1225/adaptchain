// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AdaptiveRiskContract
 * @notice Risk-aware decentralized transaction escrow and execution contract.
 * Integrates an off-chain AI/ML risk scoring engine with automated execution policy,
 * reentrancy protection, role-based access control, and sender timelock refunds.
 */
contract AdaptiveRiskContract {
    // --------------------------------------------------
    // 1. Roles & State Variables
    // --------------------------------------------------

    address public owner;
    address public riskOracle;
    address public reviewer;

    // Minimum timelock window after which a sender can reclaim funds stuck in review
    uint256 public constant REVIEW_TIMEOUT = 1 days;

    // Mutex flag for native gas-efficient Reentrancy Protection
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // --------------------------------------------------
    // 2. Risk levels and transaction states
    // --------------------------------------------------

    enum RiskLevel {
        NOT_EVALUATED,
        LOW,
        MEDIUM,
        HIGH
    }

    enum TransactionStatus {
        PENDING,
        AUTO_EXECUTED,
        PENDING_REVIEW,
        APPROVED,
        REJECTED,
        EXECUTED,
        REFUNDED
    }

    // --------------------------------------------------
    // 3. Transaction structure
    // --------------------------------------------------

    struct Transaction {
        uint256 id;
        address payable sender;
        address payable recipient;
        uint256 amount;
        uint256 timestamp;

        uint256 riskScore;
        RiskLevel riskLevel;
        TransactionStatus status;

        string riskReason;
        bool riskSubmitted;
    }

    // --------------------------------------------------
    // 4. Storage
    // --------------------------------------------------

    uint256 private nextTransactionId = 1;
    mapping(uint256 => Transaction) public transactions;

    // --------------------------------------------------
    // 5. Events
    // --------------------------------------------------

    event TransactionSubmitted(
        uint256 indexed transactionId,
        address indexed sender,
        address indexed recipient,
        uint256 amount
    );

    event RiskScoreSubmitted(
        uint256 indexed transactionId,
        uint256 riskScore,
        RiskLevel riskLevel,
        TransactionStatus status,
        string riskReason
    );

    event TransactionApproved(
        uint256 indexed transactionId,
        address indexed reviewer
    );

    event TransactionRejected(
        uint256 indexed transactionId,
        address indexed reviewer
    );

    event TransactionExecuted(
        uint256 indexed transactionId,
        address indexed recipient,
        uint256 amount
    );

    event TransactionRefunded(
        uint256 indexed transactionId,
        address indexed sender,
        uint256 amount
    );

    event RoleUpdated(
        string indexed role,
        address indexed oldAddress,
        address indexed newAddress
    );

    // --------------------------------------------------
    // 6. Modifiers
    // --------------------------------------------------

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }

    modifier onlyRiskOracle() {
        require(
            msg.sender == riskOracle,
            "Only risk oracle can perform this action"
        );
        _;
    }

    modifier onlyReviewer() {
        require(
            msg.sender == reviewer,
            "Only reviewer can perform this action"
        );
        _;
    }

    // --------------------------------------------------
    // 7. Constructor
    // --------------------------------------------------

    constructor() {
        owner = msg.sender;
        riskOracle = msg.sender;
        reviewer = msg.sender;
        _status = _NOT_ENTERED;
    }

    // --------------------------------------------------
    // 8. Role management
    // --------------------------------------------------

    function updateRiskOracle(address _riskOracle) external onlyOwner {
        require(_riskOracle != address(0), "Invalid oracle address");
        address old = riskOracle;
        riskOracle = _riskOracle;
        emit RoleUpdated("ORACLE", old, _riskOracle);
    }

    function updateReviewer(address _reviewer) external onlyOwner {
        require(_reviewer != address(0), "Invalid reviewer address");
        address old = reviewer;
        reviewer = _reviewer;
        emit RoleUpdated("REVIEWER", old, _reviewer);
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Invalid new owner");
        address old = owner;
        owner = _newOwner;
        emit RoleUpdated("OWNER", old, _newOwner);
    }

    // --------------------------------------------------
    // 9. Submit a transaction into Escrow
    // --------------------------------------------------

    function submitTransaction(
        address payable _recipient
    ) external payable returns (uint256) {
        require(_recipient != address(0), "Invalid recipient");
        require(msg.value > 0, "Transaction amount must be greater than zero");

        uint256 transactionId = nextTransactionId;

        transactions[transactionId] = Transaction({
            id: transactionId,
            sender: payable(msg.sender),
            recipient: _recipient,
            amount: msg.value,
            timestamp: block.timestamp,
            riskScore: 0,
            riskLevel: RiskLevel.NOT_EVALUATED,
            status: TransactionStatus.PENDING,
            riskReason: "",
            riskSubmitted: false
        });

        nextTransactionId++;

        emit TransactionSubmitted(
            transactionId,
            msg.sender,
            _recipient,
            msg.value
        );

        return transactionId;
    }

    // --------------------------------------------------
    // 10. Submit ML risk score (Oracle Only)
    // --------------------------------------------------

    function submitRiskScore(
        uint256 _transactionId,
        uint256 _riskScore,
        string calldata _riskReason
    ) external onlyRiskOracle nonReentrant {
        Transaction storage txn = transactions[_transactionId];

        require(txn.id != 0, "Transaction does not exist");
        require(!txn.riskSubmitted, "Risk score already submitted");
        require(
            txn.status == TransactionStatus.PENDING,
            "Transaction is not pending"
        );
        require(_riskScore <= 100, "Risk score must be between 0 and 100");

        txn.riskScore = _riskScore;
        txn.riskReason = _riskReason;
        txn.riskSubmitted = true;

        if (_riskScore <= 30) {
            txn.riskLevel = RiskLevel.LOW;
            txn.status = TransactionStatus.AUTO_EXECUTED;

            _executeTransaction(_transactionId);
        } else if (_riskScore <= 70) {
            txn.riskLevel = RiskLevel.MEDIUM;
            txn.status = TransactionStatus.PENDING_REVIEW;
        } else {
            txn.riskLevel = RiskLevel.HIGH;
            txn.status = TransactionStatus.PENDING_REVIEW;
        }

        emit RiskScoreSubmitted(
            _transactionId,
            _riskScore,
            txn.riskLevel,
            txn.status,
            _riskReason
        );
    }

    // --------------------------------------------------
    // 11. Reviewer approves a transaction
    // --------------------------------------------------

    function approveTransaction(
        uint256 _transactionId
    ) external onlyReviewer nonReentrant {
        Transaction storage txn = transactions[_transactionId];

        require(txn.id != 0, "Transaction does not exist");
        require(txn.riskSubmitted, "Risk score not submitted");
        require(
            txn.status == TransactionStatus.PENDING_REVIEW,
            "Transaction is not awaiting review"
        );

        txn.status = TransactionStatus.APPROVED;

        emit TransactionApproved(_transactionId, msg.sender);

        _executeTransaction(_transactionId);
    }

    // --------------------------------------------------
    // 12. Reviewer rejects a transaction (Refunds Sender)
    // --------------------------------------------------

    function rejectTransaction(
        uint256 _transactionId
    ) external onlyReviewer nonReentrant {
        Transaction storage txn = transactions[_transactionId];

        require(txn.id != 0, "Transaction does not exist");
        require(txn.riskSubmitted, "Risk score not submitted");
        require(
            txn.status == TransactionStatus.PENDING_REVIEW,
            "Transaction is not awaiting review"
        );

        // State update before transfer (Checks-Effects-Interactions)
        txn.status = TransactionStatus.REJECTED;

        emit TransactionRejected(_transactionId, msg.sender);

        (bool success, ) = txn.sender.call{value: txn.amount}("");
        require(success, "Refund to sender failed");
    }

    // --------------------------------------------------
    // 13. Sender Timelock Escape Hatch (Reclaim Stuck Funds)
    // --------------------------------------------------

    function reclaimTimedOutTransaction(
        uint256 _transactionId
    ) external nonReentrant {
        Transaction storage txn = transactions[_transactionId];

        require(txn.id != 0, "Transaction does not exist");
        require(msg.sender == txn.sender, "Only sender can reclaim");
        require(
            txn.status == TransactionStatus.PENDING_REVIEW,
            "Transaction not in review"
        );
        require(
            block.timestamp >= txn.timestamp + REVIEW_TIMEOUT,
            "Review timelock has not expired"
        );

        txn.status = TransactionStatus.REFUNDED;

        emit TransactionRefunded(_transactionId, txn.sender, txn.amount);

        (bool success, ) = txn.sender.call{value: txn.amount}("");
        require(success, "Reclaim transfer failed");
    }

    // --------------------------------------------------
    // 14. Internal execution function (Checks-Effects-Interactions)
    // --------------------------------------------------

    function _executeTransaction(uint256 _transactionId) internal {
        Transaction storage txn = transactions[_transactionId];

        require(txn.id != 0, "Transaction does not exist");
        require(
            txn.status == TransactionStatus.AUTO_EXECUTED ||
                txn.status == TransactionStatus.APPROVED,
            "Transaction is not approved for execution"
        );

        // State update BEFORE external call
        txn.status = TransactionStatus.EXECUTED;

        emit TransactionExecuted(
            _transactionId,
            txn.recipient,
            txn.amount
        );

        (bool success, ) = txn.recipient.call{value: txn.amount}("");
        require(success, "ETH transfer to recipient failed");
    }

    // --------------------------------------------------
    // 15. View transaction details
    // --------------------------------------------------

    function getTransaction(
        uint256 _transactionId
    ) external view returns (Transaction memory) {
        require(
            transactions[_transactionId].id != 0,
            "Transaction does not exist"
        );

        return transactions[_transactionId];
    }

    function getNextTransactionId() external view returns (uint256) {
        return nextTransactionId;
    }

    // --------------------------------------------------
    // 16. Emergency withdrawal (Owner Only)
    // --------------------------------------------------

    function emergencyWithdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Emergency withdraw failed");
    }

    receive() external payable {}
}