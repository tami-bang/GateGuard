# ~/GateGuard/ai_trainer/app.py
"""
AI_Trainer 실행 진입점

역할
- CLI 인자 파싱
- 학습 실행 설정 구성
- ai_train_manager 호출
"""

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
        "--db-host",
        default=os.getenv("DB_HOST", "127.0.0.1"),
        help="MariaDB host"
    )
    parser.add_argument(
        "--db-port",
        type=int,
        default=int(os.getenv("DB_PORT", "3306")),
        help="MariaDB port"
    )
    parser.add_argument(
        "--db-user",
        default=os.getenv("DB_USER", "gateguard"),
        help="MariaDB user"
    )
    parser.add_argument(
        "--db-password",
        default=os.getenv("DB_PASSWORD", ""),
        help="MariaDB password"
    )
    parser.add_argument(
        "--db-name",
        default=os.getenv("DB_NAME", "gateguard"),
        help="MariaDB database name"
    )

    parser.add_argument(
        "--output-dir",
        default=os.getenv("MODEL_OUTPUT_DIR", "./artifacts/latest"),
        help="Directory to save trained model artifacts"
    )
    parser.add_argument(
        "--algorithm",
        default="logistic_regression",
        choices=["logistic_regression", "random_forest"],
        help="Training algorithm"
    )
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="How many recent days of data to use"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5000,
        help="Max training rows"
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Validation split ratio"
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random state"
    )
    parser.add_argument(
        "--positive-source",
        default="block_only",
        choices=["block_only"],
        help="How to build positive labels"
    )

    return parser


def build_config(args: argparse.Namespace) -> Dict[str, Any]:
    return {
        "db": {
            "host": args.db_host,
            "port": args.db_port,
            "user": args.db_user,
            "password": args.db_password,
            "database": args.db_name,
        },
        "training": {
            "algorithm": args.algorithm,
            "days": args.days,
            "limit": args.limit,
            "test_size": args.test_size,
            "random_state": args.random_state,
            "positive_source": args.positive_source,
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
