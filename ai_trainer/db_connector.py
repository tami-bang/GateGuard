# ~/GateGuard/ai_trainer/db_connector.py
"""
DB 연결 및 학습 데이터 조회 전담

관련 테이블
- access_log
- ai_analysis
- review_event
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import pymysql
from pymysql.cursors import DictCursor


def get_connection(db_config: Dict[str, Any]) -> pymysql.connections.Connection:
    return pymysql.connect(
        host=db_config["host"],
        port=int(db_config["port"]),
        user=db_config["user"],
        password=db_config["password"],
        database=db_config["database"],
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )


def fetch_training_rows(
    conn: pymysql.connections.Connection,
    days: int = 30,
    limit: int = 5000,
    positive_source: str = "block_only",
) -> List[Dict[str, Any]]:
    """
    학습용 row 조회

    현재 실스키마 기준 라벨 전략
    - review_event.status 는 운영 상태(OPEN/IN_PROGRESS/CLOSED)라서
      악성/정상 라벨로 직접 사용하지 않음
    - 따라서 1차 학습은 access_log.decision 기준으로 생성
    - block_only:
        decision='BLOCK' => 1
        그 외 => 0

    주의
    - 추후 운영자가 확정 라벨을 남기는 별도 컬럼/테이블이 생기면
      그때 positive_source 확장 가능
    """
    since_dt = datetime.now() - timedelta(days=days)

    if positive_source != "block_only":
        raise ValueError(
            "Current schema supports only 'block_only' for reliable labeling"
        )

    label_expr = """
        CASE
            WHEN al.decision = 'BLOCK' THEN 1
            ELSE 0
        END
    """

    sql = f"""
        SELECT
            al.log_id AS access_log_id,
            al.request_id,
            al.detect_timestamp,
            al.client_ip,
            al.host,
            al.path,
            al.method,
            al.url_norm,
            al.decision,
            al.reason,
            al.decision_stage,
            al.policy_id,
            al.user_agent,
            ai.ai_analysis_id,
            ai.score AS ai_score,
            ai.label AS ai_label,
            ai.ai_response,
            ai.latency_ms AS ai_latency_ms,
            ai.model_version,
            ai.error_code AS ai_error_code,
            ai.analysis_seq,
            ai.analyzed_at,
            re.review_id,
            re.status AS review_status,
            re.proposed_action,
            re.reviewer_id,
            re.reviewed_at,
            re.created_at AS review_created_at,
            re.note AS review_note,
            re.generated_policy_id,
            {label_expr} AS label
        FROM access_log al
        LEFT JOIN ai_analysis ai
            ON ai.log_id = al.log_id
           AND ai.analysis_seq = 0
        LEFT JOIN review_event re
            ON re.log_id = al.log_id
        WHERE al.detect_timestamp >= %s
          AND al.host IS NOT NULL
          AND al.host <> ''
        ORDER BY al.detect_timestamp DESC
        LIMIT %s
    """

    with conn.cursor() as cursor:
        cursor.execute(sql, (since_dt, limit))
        rows = cursor.fetchall()

    return rows


def close_connection(conn: Optional[pymysql.connections.Connection]) -> None:
    if conn is not None:
        conn.close()
