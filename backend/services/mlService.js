const { spawn } = require('child_process');
const path = require('path');

exports.getRiskScore = (transactionData) => {
  return new Promise((resolve, reject) => {
    // Path to predict.py
    const scriptPath = path.join(__dirname, '../../ml/src/predict.py');
    const inputJson = JSON.stringify([transactionData]); // Wrap in array for pandas

    // Spawn Python process
    const pythonProcess = spawn('python', [scriptPath, inputJson]);

    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(outputData.trim());
          resolve(result); // { risk_score, risk_level, top_reasons }
        } catch (err) {
          reject(`JSON Parse Error: ${err.message}`);
        }
      } else {
        reject(`Python script failed with code ${code}: ${errorData}`);
      }
    });
  });
};