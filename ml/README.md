# AdaptChain — ML Risk Scoring Module

## Overview
This module analyzes wallet/transaction behavior and outputs a risk score (0–100),
a risk level (LOW/MEDIUM/HIGH), and top contributing reasons — feeding into the
smart contract's risk-aware execution logic.

## Dataset
[Ethereum Fraud Detection Dataset](https://www.kaggle.com/datasets/vagifa/ethereum-frauddetection-dataset)
(Kaggle) — 9,841 wallets, 78% legitimate / 22% flagged as fraud.

## Model
Random Forest Classifier (scikit-learn), `class_weight='balanced'` to handle class imbalance.

**Performance (held-out test set):**
- Accuracy: 99%
- ROC-AUC: 0.999
- Recall on fraud class: 0.94

**Score-to-outcome validation:**
| Risk Level | Actual fraud rate in this bucket |
|---|---|
| LOW | 0.6% |
| MEDIUM | 86.1% |
| HIGH | 100% |

## Files in this folder
- `src/predict.py` — main inference script. Import `predict_risk(df)` to score new transactions.
- `src/risk_model.pkl` — trained model (do not retrain without updating this file).
- `src/feature_columns.json` — exact column order the model expects (65 features).
- `src/token_config.json` — top-10 ERC20 token types used during training; anything else is bucketed as "Other".
- `notebooks/risk_model_training.ipynb` — full training process, from raw data to exported model.

## How to use `predict.py` (for backend integration)

```python
import pandas as pd
from predict import predict_risk

# raw_transaction_df must have the SAME columns as the original
# Kaggle dataset (minus FLAG) — see feature_columns.json for reference
result = predict_risk(raw_transaction_df)

print(result[['risk_score', 'risk_level', 'top_reasons']])
```

**Important:** `predict.py`, `risk_model.pkl`, `feature_columns.json`, and
`token_config.json` must all live in the same folder — the script loads
the other three by relative path.

## Risk level thresholds
- 0–30 → LOW → auto-execute
- 31–70 → MEDIUM → hold for human review
- 71–100 → HIGH → hold/reject, requires review