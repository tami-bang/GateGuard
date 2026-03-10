# ~/GateGuard/ai_trainer/ai_train_manager.py
"""
학습 전체 orchestration
"""

from __future__ import annotations

from typing import Any, Dict

from sklearn.model_selection import train_test_split

from ai_train_program import build_model, predict, predict_proba, train_model
from data_preprocessor import build_feature_dataframe
from db_connector import close_connection, fetch_training_rows, get_connection
from evaluator import evaluate_classification
from extract_to_file import build_meta, save_meta, save_metrics, save_model


def run_training_pipeline(config: Dict[str, Any]) -> Dict[str, Any]:
    conn = None

    try:
        conn = get_connection(config["db"])

        rows = fetch_training_rows(
            conn=conn,
            days=config["training"]["days"],
            limit=config["training"]["limit"],
            positive_source=config["training"]["positive_source"],
        )

        if not rows:
            raise ValueError("No training rows fetched from database")

        dataset = build_feature_dataframe(rows)

        x_train, x_valid, y_train, y_valid = train_test_split(
            dataset.dataframe,
            dataset.labels,
            test_size=config["training"]["test_size"],
            random_state=config["training"]["random_state"],
            stratify=dataset.labels,
        )

        model = build_model(config)
        trained_model = train_model(model, x_train, y_train)

        y_pred = predict(trained_model, x_valid)
        y_score = predict_proba(trained_model, x_valid)

        metrics = evaluate_classification(y_valid, y_pred, y_score)

        output_dir = config["output"]["output_dir"]
        model_path = save_model(trained_model, output_dir)

        meta = build_meta(
            config=config,
            feature_columns=dataset.feature_columns,
            training_row_count=len(rows),
        )
        meta_path = save_meta(meta, output_dir)
        metrics_path = save_metrics(metrics, output_dir)

        return {
            "status": "success",
            "row_count": len(rows),
            "feature_count": len(dataset.feature_columns),
            "artifacts": {
                "model_path": model_path,
                "meta_path": meta_path,
                "metrics_path": metrics_path,
            },
            "metrics": metrics,
        }

    finally:
        close_connection(conn)
