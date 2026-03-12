from __future__ import annotations

import json
import os
from typing import Any, Dict, List

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import LabelEncoder


def ensure_output_dir(output_dir: str) -> None:
    os.makedirs(output_dir, exist_ok=True)


def save_model(model: Any, output_dir: str) -> str:
    ensure_output_dir(output_dir)
    model_path = os.path.join(output_dir, "model.pkl")
    joblib.dump(model, model_path)
    return model_path


def save_vectorizer(vectorizer: TfidfVectorizer, output_dir: str) -> str:
    ensure_output_dir(output_dir)
    vectorizer_path = os.path.join(output_dir, "vectorizer.pkl")
    joblib.dump(vectorizer, vectorizer_path)
    return vectorizer_path


def save_label_encoder(label_encoder: LabelEncoder, output_dir: str) -> str:
    ensure_output_dir(output_dir)
    label_encoder_path = os.path.join(output_dir, "label_encoder.pkl")
    joblib.dump(label_encoder, label_encoder_path)
    return label_encoder_path


def save_meta(meta: Dict[str, Any], output_dir: str) -> str:
    ensure_output_dir(output_dir)
    meta_path = os.path.join(output_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, indent=2, ensure_ascii=False)
    return meta_path


def save_metrics(metrics: Dict[str, Any], output_dir: str) -> str:
    ensure_output_dir(output_dir)
    metrics_path = os.path.join(output_dir, "metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as fp:
        json.dump(metrics, fp, indent=2, ensure_ascii=False)
    return metrics_path


def build_meta(
    config: Dict[str, Any],
    feature_columns: List[str],
    label_classes: List[str],
) -> Dict[str, Any]:
    tfidf_config = config.get("tfidf", {})
    numeric_feature_columns = [col for col in feature_columns if col != "url"]

    return {
        "model_version": config.get("model_version", "url-threat-v1"),
        "task": "url_classification",
        "algorithm": config["training"]["algorithm"],
        "feature_mode": "tfidf_plus_numeric",
        "text_feature_source": "url",
        "feature_columns": feature_columns,
        "numeric_feature_columns": numeric_feature_columns,
        "labels": label_classes,
        "combination_method": "scipy_hstack_sparse",
        "tfidf": {
            "analyzer": tfidf_config.get("analyzer", "char"),
            "ngram_range": list(tfidf_config.get("ngram_range", [3, 5])),
            "min_df": tfidf_config.get("min_df", 1),
            "max_features": tfidf_config.get("max_features", 5000),
        },
    }


def save_all_artifacts(
    model: Any,
    vectorizer: TfidfVectorizer,
    label_encoder: LabelEncoder,
    config: Dict[str, Any],
    metrics: Dict[str, Any],
    feature_columns: List[str],
    output_dir: str,
) -> Dict[str, str]:
    meta = build_meta(
        config=config,
        feature_columns=feature_columns,
        label_classes=list(label_encoder.classes_),
    )

    model_path = save_model(model, output_dir)
    vectorizer_path = save_vectorizer(vectorizer, output_dir)
    label_encoder_path = save_label_encoder(label_encoder, output_dir)
    meta_path = save_meta(meta, output_dir)
    metrics_path = save_metrics(metrics, output_dir)

    return {
        "model_path": model_path,
        "vectorizer_path": vectorizer_path,
        "label_encoder_path": label_encoder_path,
        "meta_path": meta_path,
        "metrics_path": metrics_path,
    }
