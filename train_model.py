import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
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

from ml_utils import clean_text

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET = BASE_DIR / "data" / "cyberbullying_tweets.csv"
MODEL_DIR = BASE_DIR / "model"
REPORT_DIR = BASE_DIR / "reports"
MODEL_PATH = MODEL_DIR / "cyberbullying_pipeline.pkl"
METADATA_PATH = MODEL_DIR / "model_metadata.json"


def parse_args():
    parser = argparse.ArgumentParser(description="Train the cyberbullying detector.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATASET, help="Path to cyberbullying_tweets.csv")
    parser.add_argument("--test-size", type=float, default=0.20)
    parser.add_argument("--random-state", type=int, default=42)
    return parser.parse_args()


def load_dataset(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found at {path}. Download cyberbullying_tweets.csv from Kaggle "
            "and place it in the data/ folder."
        )

    df = pd.read_csv(path)
    required = {"tweet_text", "cyberbullying_type"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"Dataset is missing required columns: {sorted(missing)}")

    df = df[["tweet_text", "cyberbullying_type"]].dropna().copy()
    df["tweet_text"] = df["tweet_text"].astype(str).str.strip()
    df["cyberbullying_type"] = df["cyberbullying_type"].astype(str).str.strip()
    df = df[df["tweet_text"].str.len() > 0]
    df = df.drop_duplicates(subset=["tweet_text", "cyberbullying_type"])

    # Binary target required by this project:
    # not_cyberbullying -> 0, every bullying subtype -> 1.
    df["label"] = (df["cyberbullying_type"] != "not_cyberbullying").astype(int)
    return df


def build_pipeline() -> Pipeline:
    vectorizer = TfidfVectorizer(
        preprocessor=clean_text,
        lowercase=False,
        ngram_range=(1, 2),
        min_df=2,
        max_df=0.98,
        max_features=100_000,
        sublinear_tf=True,
        strip_accents="unicode",
    )

    # Linear SVM is the requested base classifier. Calibration converts the SVM
    # decision function into an estimated probability for dashboard/demo use.
    base_svm = LinearSVC(C=1.0, class_weight="balanced")
    calibrated_svm = CalibratedClassifierCV(
        estimator=base_svm,
        method="sigmoid",
        cv=5,
        n_jobs=-1,
    )

    return Pipeline([
        ("tfidf", vectorizer),
        ("classifier", calibrated_svm),
    ])


def main():
    args = parse_args()
    MODEL_DIR.mkdir(exist_ok=True)
    REPORT_DIR.mkdir(exist_ok=True)

    df = load_dataset(args.data)
    print("Rows after cleaning:", len(df))
    print("Original class counts:\n", df["cyberbullying_type"].value_counts())
    print("Binary class counts:\n", df["label"].value_counts().rename(index={0: "SAFE", 1: "CYBERBULLYING"}))

    X_train, X_test, y_train, y_test = train_test_split(
        df["tweet_text"],
        df["label"],
        test_size=args.test_size,
        random_state=args.random_state,
        stratify=df["label"],
    )

    pipeline = build_pipeline()
    print("Training TF-IDF + calibrated Linear SVM...")
    pipeline.fit(X_train, y_train)

    predictions = pipeline.predict(X_test)
    probabilities = pipeline.predict_proba(X_test)[:, 1]

    metrics = {
        "accuracy": accuracy_score(y_test, predictions),
        "precision": precision_score(y_test, predictions, zero_division=0),
        "recall": recall_score(y_test, predictions, zero_division=0),
        "f1": f1_score(y_test, predictions, zero_division=0),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "safe_rows": int((df["label"] == 0).sum()),
        "cyberbullying_rows": int((df["label"] == 1).sum()),
        "average_test_bullying_probability": float(probabilities.mean()),
    }

    report = classification_report(
        y_test,
        predictions,
        target_names=["SAFE", "CYBERBULLYING"],
        digits=4,
        zero_division=0,
    )

    print("\nEvaluation")
    for name in ["accuracy", "precision", "recall", "f1"]:
        print(f"{name.title():10s}: {metrics[name]:.4f}")
    print("\n", report)

    joblib.dump(pipeline, MODEL_PATH)

    metadata = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_file": str(args.data.name),
        "task": "binary cyberbullying detection",
        "negative_label": "not_cyberbullying",
        "positive_rule": "all cyberbullying_type values except not_cyberbullying",
        "model": "TF-IDF (1-2 grams) + class-balanced LinearSVC + sigmoid probability calibration",
        "default_block_threshold": 0.50,
        **metrics,
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (REPORT_DIR / "classification_report.txt").write_text(report, encoding="utf-8")
    (REPORT_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    cm = confusion_matrix(y_test, predictions, labels=[0, 1])
    disp = ConfusionMatrixDisplay(cm, display_labels=["SAFE", "CYBERBULLYING"])
    disp.plot(values_format="d")
    plt.title("Cyberbullying Detection Confusion Matrix")
    plt.tight_layout()
    plt.savefig(REPORT_DIR / "confusion_matrix.png", dpi=180)
    plt.close()

    print(f"\nSaved model: {MODEL_PATH}")
    print(f"Saved reports: {REPORT_DIR}")


if __name__ == "__main__":
    main()
