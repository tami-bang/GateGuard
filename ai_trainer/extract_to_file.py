# ~/GateGuard/ai_trainer/extract_to_file.py
"""
모델/메타/평가 결과 저장
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict

import joblib


def ensure_output_dir(output_dir: str) -> None:
    os.makedirs(output_dir, exist_ok=True)


def save_model(model: Any, output_dir: str) -> str:
    ensure_output_dir(output_dir)
    model_path = os.path.join(output_dir, "model.pkl")
    joblib.dump(model, model_path)
    return model_path


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
    feature_columns: list[str],
    training_row_count: int,
) -> Dict[str, Any]:
    return {
        "model_version": datetime.now().strftime("%Y%m%d%H%M%S"),
        "algorithm": config["training"]["algorithm"],
        "feature_columns": feature_columns,
        "training_row_count": training_row_count,
        "days": config["training"]["days"],
        "positive_source": config["training"]["positive_source"],
    }
