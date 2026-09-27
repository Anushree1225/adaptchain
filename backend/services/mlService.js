const { spawn } = require('child_process');
const path = require('path');

const fs = require('fs');

function calculateFallbackRisk(data) {
  let score = 15;
  const reasons = [];

  const amount = parseFloat(data.amount || 0);
  const frequency = parseInt(data.frequency || 0);
  const failedCalls = parseInt(data.failedCalls || 0);

  if (amount > 10) {
    score += 25;
    reasons.push("High transaction value (" + amount + " ETH)");
  }
  if (frequency > 15) {
    score += 30;
    reasons.push("Spike in daily transaction frequency (" + frequency + "/day)");
  }
  if (failedCalls > 3) {
    score += 35;
    reasons.push("Repeated failed contract calls (" + failedCalls + " failures)");
  }

  score = Math.min(100, Math.max(0, score));

  let level = "LOW";
  if (score > 70) {
    level = "HIGH";
  } else if (score > 30) {
    level = "MEDIUM";
  }

  if (reasons.length === 0) {
    reasons.push("Transaction behavior matches normal historical parameters.");
  }

  return {
    risk_score: score,
    risk_level: level,
    top_reasons: reasons
  };
}

exports.getRiskScore = (transactionData) => {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '../../ml/src/predict.py');

    if (!fs.existsSync(scriptPath)) {
      console.warn("predict.py not found at " + scriptPath + ". Using adaptive ML simulation fallback.");
      return resolve(calculateFallbackRisk(transactionData));
    }

    const inputJson = JSON.stringify([transactionData]);
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
    const pythonProcess = spawn(pythonCmd, [scriptPath, inputJson]);

    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    pythonProcess.on('error', () => {
      console.warn("Python execution unavailable. Falling back to adaptive ML simulation.");
      resolve(calculateFallbackRisk(transactionData));
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(outputData.trim());
          resolve(result);
        } catch (err) {
          resolve(calculateFallbackRisk(transactionData));
        }
      } else {
        console.warn("Python script exited with code " + code + ". Using fallback risk scoring.");
        resolve(calculateFallbackRisk(transactionData));
      }
    });
  });
};