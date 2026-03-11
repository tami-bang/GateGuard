from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict

from ai_train_manager import run_training_pipeline


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="GateGuard AI Trainer"
    )

    parser.add_argument(
        "--csv-path",
        action="append",
        dest="csv_paths",
        help="Training CSV path(s). Can be specified multiple times.",
    )
    parser.add_argument(
        "--output-dir",
        default=os.getenv(
            "MODEL_OUTPUT_DIR",
            "/home/ktech/GateGuard/ai_trainer/artifacts/latest",
        ),
        help="Directory to save trained model artifacts",
    )
    parser.add_argument(
        "--algorithm",
        default="logistic_regression",
        choices=["logistic_regression", "random_forest"],
        help="Training algorithm",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Validation split ratio",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random state",
    )
    parser.add_argument(
        "--model-version",
        default="url-threat-v1",
        help="Model version string",
    )
    parser.add_argument(
        "--tfidf-max-features",
        type=int,
        default=5000,
        help="TF-IDF max features",
    )

    return parser


def build_config(args: argparse.Namespace) -> Dict[str, Any]:
    csv_paths = args.csv_paths or [
        "/home/ktech/GateGuard/ai_trainer/data/raw/gateguard_dataset.csv"
    ]

    return {
        "model_version": args.model_version,
        "data": {
            "csv_paths": csv_paths,
        },
        "training": {
            "algorithm": args.algorithm,
            "test_size": args.test_size,
            "random_state": args.random_state,
        },
        "tfidf": {
            "analyzer": "char",
            "ngram_range": [3, 5],
            "min_df": 1,
            "max_features": args.tfidf_max_features,
        },
        "output": {
            "output_dir": args.output_dir,
        },
    }


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()
    config = build_config(args)

    print("[AI_Trainer] training config:")
    print(json.dumps(config, indent=2, ensure_ascii=False))

    try:
        result = run_training_pipeline(config)
    except Exception as exc:
        print(f"[AI_Trainer] training failed: {exc}", file=sys.stderr)
        return 1

    print("[AI_Trainer] training completed")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
