const express = require('express');
const cors = require('cors');
const { getRiskScore } = require('./services/mlService');
const contractService = require('./services/contractService');

const app = express();
app.use(cors());
app.use(express.json());

// Main Transaction Endpoint
app.post('/api/transaction/submit', async (req, res) => {
  try {
    const { recipient, amount, ...mlFeatures } = req.body;

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

    res.json({
      success: true,
      transactionId: txId,
      txHash: txScore.txHash,
      riskScore: mlResult.risk_score,
      riskLevel: mlResult.risk_level,
      reasons: mlResult.top_reasons,
      status: finalTx.status // Status code corresponding to contract status
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin / Reviewer Endpoints
app.post('/api/transaction/approve', async (req, res) => {
  try {
    const { transactionId } = req.body;
    const result = await contractService.approveTransaction(transactionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/transaction/reject', async (req, res) => {
  try {
    const { transactionId } = req.body;
    const result = await contractService.rejectTransaction(transactionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`AdaptChain backend running on port ${PORT}`));