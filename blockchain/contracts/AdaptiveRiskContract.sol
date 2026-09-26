// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AdaptiveRiskContract {
    // --------------------------------------------------
    // 1. Roles
    // --------------------------------------------------

    address public owner;
    address public riskOracle;
    address public reviewer;

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
        EXECUTED
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

    // --------------------------------------------------
    // 6. Modifiers
    // --------------------------------------------------

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
    }

    // --------------------------------------------------
    // 8. Role management
    // --------------------------------------------------

    function updateRiskOracle(address _riskOracle) external onlyOwner {
        require(_riskOracle != address(0), "Invalid oracle address");
        riskOracle = _riskOracle;
    }

    function updateReviewer(address _reviewer) external onlyOwner {
        require(_reviewer != address(0), "Invalid reviewer address");
        reviewer = _reviewer;
    }

    // --------------------------------------------------
    // 9. Submit a transaction
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
    // 10. Submit ML risk score
    // --------------------------------------------------

    function submitRiskScore(
        uint256 _transactionId,
        uint256 _riskScore,
        string calldata _riskReason
    ) external onlyRiskOracle {
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
    ) external onlyReviewer {
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
    // 12. Reviewer rejects a transaction
    // --------------------------------------------------

    function rejectTransaction(
        uint256 _transactionId
    ) external onlyReviewer {
        Transaction storage txn = transactions[_transactionId];

        require(txn.id != 0, "Transaction does not exist");
        require(txn.riskSubmitted, "Risk score not submitted");
        require(
            txn.status == TransactionStatus.PENDING_REVIEW,
            "Transaction is not awaiting review"
        );

        txn.status = TransactionStatus.REJECTED;

        payable(txn.sender).transfer(txn.amount);

        emit TransactionRejected(_transactionId, msg.sender);
    }

    // --------------------------------------------------
    // 13. Internal execution function
    // --------------------------------------------------

    function _executeTransaction(uint256 _transactionId) internal {
        Transaction storage txn = transactions[_transactionId];

        require(txn.id != 0, "Transaction does not exist");
        require(
            txn.status == TransactionStatus.AUTO_EXECUTED ||
                txn.status == TransactionStatus.APPROVED,
            "Transaction is not approved for execution"
        );

        txn.status = TransactionStatus.EXECUTED;

        txn.recipient.transfer(txn.amount);

        emit TransactionExecuted(
            _transactionId,
            txn.recipient,
            txn.amount
        );
    }

    // --------------------------------------------------
    // 14. View transaction details
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
    // 15. Emergency withdrawal
    // --------------------------------------------------

    function emergencyWithdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    receive() external payable {}
}