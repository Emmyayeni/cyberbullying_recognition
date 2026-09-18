"""
Cyberbullying AI Detection - Google Colab Standalone Training Script
Can be uploaded and run in Colab or locally:
python colab_train.py --data cyberbullying_tweets.csv
"""

import argparse
import html
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
MENTION_RE = re.compile(r"@\w+")
WHITESPACE_RE = re.compile(r"\s+")


def clean_text(text: str) -> str:
    """Linguistic normalization consistent across training and web inference."""
    if text is None:
        return ""
    text = html.unescape(str(text))
    text = text.lower().strip()
    text = URL_RE.sub(" URL ", text)
    text = MENTION_RE.sub(" USER ", text)
    text = WHITESPACE_RE.sub(" ", text)
    return text.strip()


def main():
    parser = argparse.ArgumentParser(description="Train cyberbullying model.")
    parser.add_argument("--data", type=str, default="cyberbullying_tweets.csv", help="Path to cyberbullying_tweets.csv")
    parser.add_argument("--output-dir", type=str, default="model", help="Directory to save model artifacts")
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        # Check alternative common paths
        alt = Path("data") / "cyberbullying_tweets.csv"
        if alt.exists():
            data_path = alt
        else:
            raise FileNotFoundError(f"Could not find dataset at '{args.data}'. Please place cyberbullying_tweets.csv in working directory.")

    print(f"Loading dataset from: {data_path}")
    df = pd.read_csv(data_path)
    df = df[["tweet_text", "cyberbullying_type"]].dropna().copy()
    df["tweet_text"] = df["tweet_text"].astype(str).str.strip()
    df = df[df["tweet_text"].str.len() > 0]
    df = df.drop_duplicates(subset=["tweet_text", "cyberbullying_type"])

    # Binary label mapping: not_cyberbullying -> 0, others -> 1
    df["label"] = (df["cyberbullying_type"] != "not_cyberbullying").astype(int)
    print(f"Cleaned dataset rows: {len(df):,}")
    print("Class counts:", dict(df["label"].value_counts()))

    X_train, X_test, y_train, y_test = train_test_split(
        df["tweet_text"],
        df["label"],
        test_size=0.20,
        random_state=42,
        stratify=df["label"],
    )

    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            preprocessor=clean_text,
            lowercase=False,
            ngram_range=(1, 2),
            min_df=2,
            max_df=0.98,
            max_features=100_000,
            sublinear_tf=True,
            strip_accents="unicode",
        )),
        ("classifier", CalibratedClassifierCV(
            estimator=LinearSVC(C=1.0, class_weight="balanced", random_state=42),
            method="sigmoid",
            cv=5,
            n_jobs=-1,
        )),
    ])

    print("Training TF-IDF + Calibrated Linear SVM...")
    pipeline.fit(X_train, y_train)

    predictions = pipeline.predict(X_test)
    probabilities = pipeline.predict_proba(X_test)[:, 1]

    accuracy = accuracy_score(y_test, predictions)
    precision = precision_score(y_test, predictions, zero_division=0)
    recall = recall_score(y_test, predictions, zero_division=0)
    f1 = f1_score(y_test, predictions, zero_division=0)

    print("\n" + "=" * 40)
    print(f"Accuracy : {accuracy:.4f}")
    print(f"Precision: {precision:.4f}")
    print(f"Recall   : {recall:.4f}")
    print(f"F1-Score : {f1:.4f}")
    print("=" * 40 + "\n")

    report = classification_report(y_test, predictions, target_names=["SAFE", "CYBERBULLYING"], digits=4)
    print(report)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report_dir = Path("reports")
    report_dir.mkdir(parents=True, exist_ok=True)

    model_path = output_dir / "cyberbullying_pipeline.pkl"
    metadata_path = output_dir / "model_metadata.json"

    joblib.dump(pipeline, model_path)

    metadata = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_file": data_path.name,
        "task": "Binary Cyberbullying Detection",
        "model": "TF-IDF (1-2 n-grams) + Calibrated LinearSVC (Sigmoid)",
        "default_block_threshold": 0.50,
        "accuracy": round(float(accuracy), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(f1), 4),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "average_test_bullying_probability": round(float(probabilities.mean()), 4),
    }

    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    with open(report_dir / "classification_report.txt", "w", encoding="utf-8") as f:
        f.write(report)

    cm = confusion_matrix(y_test, predictions, labels=[0, 1])
    disp = ConfusionMatrixDisplay(cm, display_labels=["SAFE", "CYBERBULLYING"])
    disp.plot(cmap=plt.cm.Blues, values_format="d")
    plt.title("Cyberbullying Detection Confusion Matrix")
    plt.tight_layout()
    plt.savefig(report_dir / "confusion_matrix.png", dpi=180)
    plt.close()

    print(f"\nModel artifacts saved successfully:")
    print(f"- {model_path}")
    print(f"- {metadata_path}")
    print(f"- {report_dir / 'classification_report.txt'}")


if __name__ == "__main__":
    main()
