const { ethers } = require('ethers');
require('dotenv').config();

// Load contract ABI from compiled contract artifact
const contractData = require('../../blockchain/build/contracts/AdaptiveRiskContract.json');
const contractAbi = contractData.abi;

const provider = new ethers.JsonRpcProvider(process.env.GANACHE_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, contractAbi, wallet);

/**
 * Step 1: Submit transaction and deposit funds into contract
 */
exports.submitTransaction = async (recipientAddress, amountInEth) => {
  try {
    const amountInWei = ethers.parseEther(amountInEth.toString());

    // Call submitTransaction with ETH attached
    const tx = await contract.submitTransaction(recipientAddress, {
      value: amountInWei
    });
    const receipt = await tx.wait();

    // Find the TransactionSubmitted event to extract transactionId
    const event = receipt.logs
      .map(log => contract.interface.parseLog(log))
      .find(e => e && e.name === 'TransactionSubmitted');

    const transactionId = event.args.transactionId.toString();

    return {
      success: true,
      transactionId,
      txHash: receipt.hash
    };
  } catch (error) {
    console.error("Error in submitTransaction:", error);
    throw error;
  }
};

/**
 * Step 2: Submit ML risk score & reason to trigger execution policy
 */
exports.submitRiskScore = async (transactionId, riskScore, riskReason) => {
  try {
    const tx = await contract.submitRiskScore(transactionId, riskScore, riskReason);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt.hash
    };
  } catch (error) {
    console.error("Error in submitRiskScore:", error);
    throw error;
  }
};

/**
 * Reviewer Actions: Approve or Reject held transactions
 */
exports.approveTransaction = async (transactionId) => {
  const tx = await contract.approveTransaction(transactionId);
  const receipt = await tx.wait();
  return { success: true, txHash: receipt.hash };
};

exports.rejectTransaction = async (transactionId) => {
  const tx = await contract.rejectTransaction(transactionId);
  const receipt = await tx.wait();
  return { success: true, txHash: receipt.hash };
};

/**
 * Query Transaction Details
 */
exports.getTransaction = async (transactionId) => {
  const txn = await contract.getTransaction(transactionId);
  return {
    id: txn.id.toString(),
    sender: txn.sender,
    recipient: txn.recipient,
    amount: ethers.formatEther(txn.amount),
    riskScore: txn.riskScore.toString(),
    riskLevel: Number(txn.riskLevel), // Enum: 1=LOW, 2=MEDIUM, 3=HIGH
    status: Number(txn.status),       // Enum status
    riskReason: txn.riskReason
  };
};