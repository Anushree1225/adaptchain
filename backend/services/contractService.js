const { ethers } = require('ethers');
require('dotenv').config();

// Load contract ABI from compiled contract artifact
const contractData = require('../../blockchain/build/contracts/AdaptiveRiskContract.json');
const contractAbi = contractData.abi;

// Helper function to get an active contract instance dynamically
function getContract() {
  const rpcUrl = process.env.GANACHE_RPC_URL || 'http://127.0.0.1:8545';
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress) {
    throw new Error("CRITICAL: CONTRACT_ADDRESS is missing from your .env file!");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  return new ethers.Contract(contractAddress, contractAbi, wallet);
}

/**
 * Step 1: Submit transaction and deposit funds into contract
 */
exports.submitTransaction = async (recipientAddress, amountInEth) => {
  try {
    const contract = getContract();
    const cleanAddress = ethers.getAddress(recipientAddress.toLowerCase());
    const amountInWei = ethers.parseEther(amountInEth.toString());

    // Call submitTransaction with ETH attached
    const tx = await contract.submitTransaction(cleanAddress, {
      value: amountInWei
    });
    const receipt = await tx.wait();

    // Find the TransactionSubmitted event to extract transactionId
    let transactionId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed && parsed.name === 'TransactionSubmitted') {
          transactionId = parsed.args.transactionId.toString();
          break;
        }
      } catch (e) {
        // ignore logs that don't match contract interface
      }
    }

    if (!transactionId) {
      // Fallback: query getNextTransactionId() - 1
      const nextId = await contract.getNextTransactionId();
      transactionId = (BigInt(nextId) - 1n).toString();
    }

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
    const contract = getContract();
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
  const contract = getContract();
  const tx = await contract.approveTransaction(transactionId);
  const receipt = await tx.wait();
  return { success: true, txHash: receipt.hash };
};

exports.rejectTransaction = async (transactionId) => {
  const contract = getContract();
  const tx = await contract.rejectTransaction(transactionId);
  const receipt = await tx.wait();
  return { success: true, txHash: receipt.hash };
};

/**
 * Query Transaction Details
 */
exports.getTransaction = async (transactionId) => {
  const contract = getContract();
  const txn = await contract.getTransaction(transactionId);
  return {
    id: txn.id.toString(),
    sender: txn.sender,
    recipient: txn.recipient,
    amount: ethers.formatEther(txn.amount),
    riskScore: txn.riskScore.toString(),
    riskLevel: Number(txn.riskLevel), // Enum: 1=LOW, 2=MEDIUM, 3=HIGH
    status: Number(txn.status),      // Enum status
    riskReason: txn.riskReason
  };
};