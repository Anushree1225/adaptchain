const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { getRiskScore } = require('./services/mlService');
const contractService = require('./services/contractService');

const app = express();
app.use(cors());
app.use(express.json());

const { ethers } = require('ethers');

// In-memory queue to serialize contract-modifying transactions and prevent nonce collisions
let txQueue = Promise.resolve();
function queueTx(fn) {
  const result = txQueue.then(fn, fn);
  txQueue = result.catch(() => {});
  return result;
}

// In-memory transaction history store (latest 30 txs)
const transactionHistory = [];

// Main Transaction Endpoint
app.post('/api/transaction/submit', async (req, res) => {
  try {
    const rawRecipient = req.body.recipient || req.body.wallet;
    const rawAmount = req.body.amount;

    if (!rawRecipient || typeof rawRecipient !== 'string') {
      return res.status(400).json({ success: false, error: 'Recipient/wallet address is required' });
    }

    let recipient;
    try {
      recipient = ethers.getAddress(rawRecipient.trim().toLowerCase());
    } catch (e) {
      return res.status(400).json({ success: false, error: `Invalid Ethereum address: "${rawRecipient}"` });
    }

    const amount = parseFloat(rawAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Transaction amount must be a positive number' });
    }

    const frequency = parseInt(req.body.frequency || 0, 10);
    const failedCalls = parseInt(req.body.failedCalls || 0, 10);
    const mlFeatures = {
      amount,
      frequency: isNaN(frequency) ? 0 : Math.max(0, frequency),
      failedCalls: isNaN(failedCalls) ? 0 : Math.max(0, failedCalls)
    };

    // Queue blockchain operations to avoid nonce race conditions
    const submissionResult = await queueTx(async () => {
      // 1. Submit raw transaction to Blockchain -> locks ETH & gets transactionId
      const txInit = await contractService.submitTransaction(recipient, amount);
      const txId = txInit.transactionId;

      // 2. Run ML Model on transaction features
      const mlResult = await getRiskScore(mlFeatures);

      // Format top reasons into a single string for smart contract storage
      const reasonString = Array.isArray(mlResult.top_reasons) 
        ? mlResult.top_reasons.join(', ') 
        : 'Normal execution';

      // 3. Submit Risk Score to Smart Contract -> updates state / auto-executes if LOW risk
      const txScore = await contractService.submitRiskScore(
        txId, 
        mlResult.risk_score, 
        reasonString
      );

      // 4. Fetch final updated status from Smart Contract
      const finalTx = await contractService.getTransaction(txId);

      const record = {
        success: true,
        transactionId: txId,
        txHash: txScore.txHash,
        initTxHash: txInit.txHash,
        recipient,
        amount,
        riskScore: mlResult.risk_score,
        riskLevel: mlResult.risk_level,
        score: mlResult.risk_score,
        level: mlResult.risk_level,
        reasons: mlResult.top_reasons,
        status: finalTx.status, // Enum: 1=AUTO_EXECUTED, 2=PENDING_REVIEW, 3=APPROVED, 4=REJECTED, 5=EXECUTED
        timestamp: new Date().toISOString()
      };

      // Store in history
      transactionHistory.unshift(record);
      if (transactionHistory.length > 50) transactionHistory.pop();

      return record;
    });

    res.json(submissionResult);

  } catch (error) {
    const errorMsg = (error && error.message) ? error.message : String(error);
    console.error("Error in /api/transaction/submit:", errorMsg);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// Transaction History Endpoint
app.get('/api/transactions', (req, res) => {
  res.json({ success: true, transactions: transactionHistory });
});

// Admin / Reviewer Endpoints
app.post('/api/transaction/approve', async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId) {
      return res.status(400).json({ success: false, error: 'transactionId is required' });
    }
    const result = await queueTx(async () => {
      const resData = await contractService.approveTransaction(transactionId);
      const existing = transactionHistory.find(t => t.transactionId === transactionId.toString());
      if (existing) {
        existing.status = 5; // EXECUTED
        existing.approvalTxHash = resData.txHash;
      }
      return resData;
    });
    res.json(result);
  } catch (error) {
    const errorMsg = (error && error.message) ? error.message : String(error);
    console.error("Error in /api/transaction/approve:", errorMsg);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

app.post('/api/transaction/reject', async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId) {
      return res.status(400).json({ success: false, error: 'transactionId is required' });
    }
    const result = await queueTx(async () => {
      const resData = await contractService.rejectTransaction(transactionId);
      const existing = transactionHistory.find(t => t.transactionId === transactionId.toString());
      if (existing) {
        existing.status = 4; // REJECTED
        existing.rejectionTxHash = resData.txHash;
      }
      return resData;
    });
    res.json(result);
  } catch (error) {
    const errorMsg = (error && error.message) ? error.message : String(error);
    console.error("Error in /api/transaction/reject:", errorMsg);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`AdaptChain backend running on port ${PORT}`));