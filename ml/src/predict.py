"""
predict.py — AdaptChain Risk Scoring Module

Loads the trained Random Forest model and applies the exact same
preprocessing used during training, so raw transaction data can be
turned into a 0-100 risk score, a risk level, and top contributing reasons.
"""

import joblib
import json
import pandas as pd
import numpy as np

MODEL_PATH = 'risk_model.pkl'
FEATURE_COLUMNS_PATH = 'feature_columns.json'
TOKEN_CONFIG_PATH = 'token_config.json'

# Load model and config once, when this module is imported —
# not on every prediction, since loading is slow but predicting is fast.
model = joblib.load(MODEL_PATH)

with open(FEATURE_COLUMNS_PATH, 'r') as f:
    FEATURE_COLUMNS = json.load(f)

with open(TOKEN_CONFIG_PATH, 'r') as f:
    token_config = json.load(f)

SENT_COL = token_config['sent_col']
REC_COL = token_config['rec_col']
TOP_SENT_TOKENS = set(token_config['top_sent_tokens'])
TOP_REC_TOKENS = set(token_config['top_rec_tokens'])

# Pre-compute overall feature importances once (used to pick which
# features are even worth mentioning as "reasons")
FEATURE_IMPORTANCES = dict(zip(FEATURE_COLUMNS, model.feature_importances_))
TOP_GLOBAL_FEATURES = [
    f for f, _ in sorted(FEATURE_IMPORTANCES.items(), key=lambda x: -x[1])
][:15]  # only ever consider the 15 most globally important features as "reasons"


def risk_level(score: int) -> str:
    """Bucket a 0-100 score into AdaptChain's risk tiers."""
    if score <= 30:
        return "LOW"
    elif score <= 70:
        return "MEDIUM"
    else:
        return "HIGH"


def preprocess(raw_df: pd.DataFrame) -> pd.DataFrame:
    """
    Take a raw transaction DataFrame (same columns as the original
    Kaggle dataset, minus the label) and turn it into the exact
    feature format the model expects.
    """
    df = raw_df.copy()

    for col in ['Unnamed: 0', 'Index', 'Address', 'FLAG']:
        if col in df.columns:
            df = df.drop(columns=[col])

    for col in df.columns:
        if df[col].isnull().sum() > 0:
            if df[col].dtype == 'object':
                df[col] = df[col].fillna('None')
            else:
                df[col] = df[col].fillna(0)

    if SENT_COL in df.columns:
        df[SENT_COL] = df[SENT_COL].apply(
            lambda x: x if x in TOP_SENT_TOKENS else 'Other'
        )
    if REC_COL in df.columns:
        df[REC_COL] = df[REC_COL].apply(
            lambda x: x if x in TOP_REC_TOKENS else 'Other'
        )

    df_encoded = pd.get_dummies(df, columns=[SENT_COL, REC_COL], drop_first=True)
    df_encoded = df_encoded.reindex(columns=FEATURE_COLUMNS, fill_value=0)

    return df_encoded


def get_reasons(row: pd.Series, top_n: int = 3) -> list:
    """
    For one transaction's processed feature row, return the top_n
    globally-important features with the highest values — a simple,
    fast approximation of "why this score", without needing SHAP.
    """
    # Look only among features that matter globally, then rank THIS
    # row's values among them (higher value = more likely a driver)
    candidate_values = {f: row[f] for f in TOP_GLOBAL_FEATURES}
    ranked = sorted(candidate_values.items(), key=lambda x: -x[1])
    top_features = [f for f, v in ranked[:top_n] if v > 0]
    return top_features


def predict_risk(raw_df: pd.DataFrame) -> pd.DataFrame:
    """
    Main entry point. Takes raw transaction data, returns a DataFrame
    with risk_score, risk_level, and top_reasons added.
    """
    X = preprocess(raw_df)

    probabilities = model.predict_proba(X)[:, 1]
    scores = (probabilities * 100).round().astype(int)
    levels = [risk_level(s) for s in scores]
    reasons = [get_reasons(X.iloc[i]) for i in range(len(X))]

    result = raw_df.copy()
    result['risk_score'] = scores
    result['risk_level'] = levels
    result['top_reasons'] = reasons

    return result


if __name__ == '__main__':
    sample = pd.read_csv('transaction_dataset.csv').drop(columns=['FLAG']).head(3)
    output = predict_risk(sample)
    print(output[['risk_score', 'risk_level', 'top_reasons']])
