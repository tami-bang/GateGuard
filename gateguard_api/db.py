# ~/GateGuard/gateguard_api/db.py
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import pymysql
from pymysql.cursors import DictCursor


def get_connection() -> pymysql.connections.Connection:
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "gateguard"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "gateguard"),
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )


def insert_ai_analysis(
    *,
    log_id: int,
    score: Optional[float],
    label: Optional[str],
    ai_response: int,
    latency_ms: Optional[int],
    model_version: str,
    error_code: Optional[str],
    analysis_seq: int = 0,
) -> None:
    sql = """
        INSERT INTO ai_analysis (
            log_id,
            score,
            label,
            ai_response,
            latency_ms,
            model_version,
            error_code,
            analysis_seq,
            analyzed_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, NOW()
        )
    """

    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute(
                sql,
                (
                    log_id,
                    score,
                    label,
                    ai_response,
                    latency_ms,
                    model_version,
                    error_code,
                    analysis_seq,
                ),
            )
        conn.commit()
    finally:
        if conn is not None:
            conn.close()
