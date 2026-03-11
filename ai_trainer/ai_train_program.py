from __future__ import annotations

import json
import os
import pickle
from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder


def build_model(config: Dict[str, Any]) -> Any:
    algorithm = config["training"]["algorithm"]
    random_state = config["training"]["random_state"]

    if algorithm == "logistic_regression":
        return LogisticRegression(
            max_iter=2000,
            random_state=random_state,
        )

    if algorithm == "random_forest":
        return RandomForestClassifier(
            n_estimators=200,
            max_depth=12,
            min_samples_split=4,
            min_samples_leaf=2,
            random_state=random_state,
        )

    raise ValueError(f"Unsupported algorithm: {algorithm}")


def build_vectorizer(config: Dict[str, Any]) -> TfidfVectorizer:
    tfidf_config = config.get("tfidf", {})

    return TfidfVectorizer(
        analyzer=tfidf_config.get("analyzer", "char"),
        ngram_range=tuple(tfidf_config.get("ngram_range", [3, 5])),
        min_df=tfidf_config.get("min_df", 1),
        max_features=tfidf_config.get("max_features", 5000),
    )


def split_text_and_numeric_features(x_df: pd.DataFrame) -> Tuple[pd.Series, pd.DataFrame]:
    if "url" not in x_df.columns:
        raise ValueError("'url' column is required in feature dataframe")

    text_series = x_df["url"].astype(str)
    numeric_df = x_df.drop(columns=["url"]).astype(float)

    return text_series, numeric_df


def fit_feature_pipeline(
    x_train: pd.DataFrame,
    config: Dict[str, Any],
) -> Tuple[TfidfVectorizer, csr_matrix]:
    text_series, numeric_df = split_text_and_numeric_features(x_train)

    vectorizer = build_vectorizer(config)
    x_text = vectorizer.fit_transform(text_series)
    x_numeric = csr_matrix(numeric_df.values)

    x_combined = hstack([x_text, x_numeric])
    return vectorizer, x_combined


def transform_feature_pipeline(
    x_df: pd.DataFrame,
    vectorizer: TfidfVectorizer,
) -> csr_matrix:
    text_series, numeric_df = split_text_and_numeric_features(x_df)

    x_text = vectorizer.transform(text_series)
    x_numeric = csr_matrix(numeric_df.values)

    return hstack([x_text, x_numeric])


def encode_labels(y_train, y_valid=None):
    encoder = LabelEncoder()
    y_train_enc = encoder.fit_transform(y_train)

    if y_valid is None:
        return encoder, y_train_enc, None

    y_valid_enc = encoder.transform(y_valid)
    return encoder, y_train_enc, y_valid_enc


def train_model(model: Any, x_train, y_train) -> Any:
    model.fit(x_train, y_train)
    return model


def predict(model: Any, x_valid):
    return model.predict(x_valid)


def predict_proba(model: Any, x_valid):
    if hasattr(model, "predict_proba"):
        return model.predict_proba(x_valid)
    return None


def predict_top_score(model: Any, x_valid):
    probabilities = predict_proba(model, x_valid)
    if probabilities is None:
        return None
    return np.max(probabilities, axis=1)


def save_artifacts(
    model: Any,
    vectorizer: TfidfVectorizer,
    label_encoder: LabelEncoder,
    config: Dict[str, Any],
    metrics: Dict[str, Any],
    output_dir: str,
) -> None:
    os.makedirs(output_dir, exist_ok=True)

    with open(os.path.join(output_dir, "model.pkl"), "wb") as f:
        pickle.dump(model, f)

    with open(os.path.join(output_dir, "vectorizer.pkl"), "wb") as f:
        pickle.dump(vectorizer, f)

    with open(os.path.join(output_dir, "label_encoder.pkl"), "wb") as f:
        pickle.dump(label_encoder, f)

    meta = {
        "model_version": config.get("model_version", "url-threat-v1"),
        "task": "url_classification",
        "labels": list(label_encoder.classes_),
        "algorithm": config["training"]["algorithm"],
        "feature_mode": "tfidf_plus_numeric",
    }

    with open(os.path.join(output_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
