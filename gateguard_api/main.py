import os
import time
import uuid
import json
import subprocess
from datetime import datetime, timedelta
from typing import Optional, Any, List, Dict

import pymysql
from fastapi import FastAPI, Header, HTTPException, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from gateguard_api.ai_loader import load_artifacts_on_startup, get_model_version
from gateguard_api.ai_manager import score_url
from gateguard_api.alert_state import dedup_allow_send, update_component_status
from gateguard_api.slack_alerts import (
    send_ai_block_alert,
    send_ai_error_summary_alert,
    send_infra_status_alert,
    send_platform_error_alert,
    send_policy_change_alert,
    send_repeat_block_alert,
)

def load_env(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


# config.env 로드
# 1) systemd EnvironmentFile(/etc/gateguard-fastapi.env)도 읽어준다 (있으면)
load_env("/etc/gateguard-fastapi.env")

# 2) repo 내부 dev용 config.env (있으면)
load_env(os.path.join(os.path.dirname(__file__), "config.env"))

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "gateguard")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "gateguard")

API_TOKEN = os.getenv("API_TOKEN", "changeme-token")
MODEL_VERSION = os.getenv("MODEL_VERSION", "urlclf-unknown")
THRESHOLD = float(os.getenv("THRESHOLD", "0.50"))

app = FastAPI(title="GateGuard AI Scoring API")

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    _safe_send_platform_error(str(request.url.path), str(exc))
    return JSONResponse(
        status_code=500,
        content={"detail": "internal server error"},
    )

@app.on_event("startup")
def startup_event() -> None:
    load_artifacts_on_startup()

# --- CORS (Admin UI에서 FastAPI 호출 허용) ---
def _parse_csv(v: Optional[str]) -> List[str]:
    if not v:
        return []
    return [x.strip() for x in v.split(",") if x.strip()]

allowed_origins = _parse_csv(os.getenv("CORS_ORIGINS", "")) or [
    "http://192.168.1.24:8080",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def db_conn():
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


# =========================
# Alert helpers
# =========================

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


def _alerts_dedup_window_sec() -> int:
    return _env_int("ALERT_DEDUP_WINDOW_SEC", 300)


def _safe_send_platform_error(endpoint: str, error_message: str) -> None:
    try:
        send_platform_error_alert(endpoint=endpoint, error_message=error_message)
    except Exception:
        pass


def _safe_send_policy_alert(
    *,
    event_action: str,
    policy_id: int,
    changed_by: int,
    before_snapshot: Optional[dict],
    after_snapshot: Optional[dict],
    change_note: Optional[str] = None,
    source_review_id: Optional[int] = None,
) -> None:
    try:
        send_policy_change_alert(
            event_action=event_action,
            policy_id=int(policy_id),
            changed_by=int(changed_by),
            before_snapshot=before_snapshot,
            after_snapshot=after_snapshot,
            change_note=change_note,
            source_review_id=source_review_id,
        )
    except Exception:
        pass


def _get_system_health_snapshot() -> Dict[str, str]:
    def check_service(service: str) -> str:
        try:
            result = subprocess.run(
                ["systemctl", "is-active", service],
                capture_output=True,
                text=True
            )
            return result.stdout.strip() or "unknown"
        except Exception:
            return "unknown"

    engine = check_service("gateguard-engine")
    fastapi = check_service("gateguard-fastapi")
    mariadb = check_service("mariadb")

    model_dir = os.getenv(
        "MODEL_DIR",
        "/home/ktech/GateGuard/ai_trainer/artifacts/latest"
    )
    model_file = os.path.join(model_dir, "model.pkl")
    meta_file = os.path.join(model_dir, "meta.json")

    ai_model = "loaded" if os.path.exists(model_file) and os.path.exists(meta_file) else "missing"

    return {
        "engine": engine,
        "fastapi": fastapi,
        "mariadb": mariadb,
        "ai_model": ai_model,
    }


def _dispatch_recent_ai_blocks() -> int:
    sent_count = 0
    lookback_sec = _env_int("ALERT_AI_BLOCK_LOOKBACK_SEC", 120)
    latest_ai_join_sql = """
    LEFT JOIN (
      SELECT x.*
      FROM ai_analysis x
      JOIN (
        SELECT log_id, MAX(analysis_seq) AS max_seq
        FROM ai_analysis
        GROUP BY log_id
      ) m ON m.log_id = x.log_id AND m.max_seq = x.analysis_seq
    ) aa ON aa.log_id = al.log_id
    """

    sql = f"""
    SELECT
      al.log_id,
      al.request_id,
      DATE_FORMAT(al.detect_timestamp, '%%Y-%%m-%%d %%H:%%i:%%s') AS detected_at,
      al.client_ip,
      al.host,
      al.path,
      aa.score AS ai_score,
      aa.label AS ai_label,
      aa.model_version AS ai_model_version
    FROM access_log al
    {latest_ai_join_sql}
    WHERE al.detect_timestamp >= (NOW() - INTERVAL %s SECOND)
      AND al.decision='BLOCK'
      AND al.decision_stage='AI_STAGE'
      AND {_security_event_filter_sql("al")}
    ORDER BY al.detect_timestamp DESC, al.log_id DESC
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (int(lookback_sec),))
            rows = cur.fetchall() or []

    for row in rows:
        log_id = int(row["log_id"])
        dedup_key = f"ai_block:{log_id}"
        if not dedup_allow_send(dedup_key, _alerts_dedup_window_sec()):
            continue

        ok = send_ai_block_alert(
            log_id=log_id,
            detected_at=row.get("detected_at") or _now_str(),
            client_ip=row.get("client_ip") or "",
            host=row.get("host") or "",
            path=row.get("path") or "/",
            score=row.get("ai_score"),
            label=row.get("ai_label"),
            model_version=row.get("ai_model_version"),
            request_id=row.get("request_id"),
        )
        if ok:
            sent_count += 1

    return sent_count


def _dispatch_repeat_blocked_clients() -> int:
    sent_count = 0
    threshold = _env_int("ALERT_REPEAT_BLOCK_THRESHOLD", 5)
    window_min = _env_int("ALERT_REPEAT_BLOCK_WINDOW_MIN", 5)

    sql = f"""
    SELECT
      al.client_ip,
      COUNT(*) AS cnt
    FROM access_log al
    WHERE al.detect_timestamp >= (NOW() - INTERVAL %s MINUTE)
      AND al.decision='BLOCK'
      AND al.client_ip IS NOT NULL
      AND al.client_ip <> ''
      AND {_security_event_filter_sql("al")}
    GROUP BY al.client_ip
    HAVING COUNT(*) >= %s
    ORDER BY cnt DESC, al.client_ip ASC
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (int(window_min), int(threshold)))
            rows = cur.fetchall() or []

    for row in rows:
        client_ip = str(row.get("client_ip") or "").strip()
        if not client_ip:
            continue

        dedup_key = f"repeat_block:{client_ip}"
        if not dedup_allow_send(dedup_key, window_min * 60):
            continue

        ok = send_repeat_block_alert(
            client_ip=client_ip,
            blocked_count=int(row.get("cnt") or 0),
            window_minutes=window_min,
        )
        if ok:
            sent_count += 1

    return sent_count


def _dispatch_ai_error_summary() -> int:
    sent_count = 0
    lookback_sec = _env_int("ALERT_AI_ERROR_LOOKBACK_SEC", 120)

    sql = """
    SELECT
      error_code,
      COUNT(*) AS cnt,
      MAX(DATE_FORMAT(analyzed_at, '%%Y-%%m-%%d %%H:%%i:%%s')) AS latest_at,
      MIN(log_id) AS example_log_id
    FROM ai_analysis
    WHERE analyzed_at >= (NOW() - INTERVAL %s SECOND)
      AND error_code IS NOT NULL
      AND error_code <> ''
    GROUP BY error_code
    ORDER BY cnt DESC, error_code ASC
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (int(lookback_sec),))
            rows = cur.fetchall() or []

    for row in rows:
        error_code = str(row.get("error_code") or "").strip() or "UNKNOWN"
        dedup_key = f"ai_error:{error_code}"
        if not dedup_allow_send(dedup_key, _alerts_dedup_window_sec()):
            continue

        ok = send_ai_error_summary_alert(
            error_code=error_code,
            count=int(row.get("cnt") or 0),
            latest_at=row.get("latest_at") or _now_str(),
            example_log_id=int(row["example_log_id"]) if row.get("example_log_id") is not None else None,
        )
        if ok:
            sent_count += 1

    return sent_count


def _dispatch_infra_status_changes() -> int:
    sent_count = 0
    snapshot = _get_system_health_snapshot()

    components = {
        "gateguard-engine": snapshot.get("engine", "unknown"),
        "mariadb": snapshot.get("mariadb", "unknown"),
        "ai_model": snapshot.get("ai_model", "unknown"),
    }

    for component, current_status in components.items():
        previous_status = update_component_status(component, current_status)
        if previous_status is None:
            continue

        dedup_key = f"infra:{component}:{current_status}"
        if not dedup_allow_send(dedup_key, 60):
            continue

        ok = send_infra_status_alert(
            component=component,
            previous_status=previous_status,
            current_status=current_status,
        )
        if ok:
            sent_count += 1

    return sent_count


# =========================
# Common helpers
# =========================

_TABLE_COLS_CACHE: Dict[str, set] = {}  # (table_name) -> set(cols)


def _now_str() -> str:
    # MariaDB DATETIME 호환 문자열
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _get_table_cols(conn, table: str) -> set:
    key = table.lower()
    if key in _TABLE_COLS_CACHE:
        return _TABLE_COLS_CACHE[key]
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM {table}")
        cols = {r["Field"] for r in cur.fetchall()}
    _TABLE_COLS_CACHE[key] = cols
    return cols


def _filter_payload_by_cols(payload: dict, cols: set) -> dict:
    return {k: v for k, v in payload.items() if k in cols}


def _insert_dynamic(cur, table: str, payload: dict) -> int:
    """
    payload의 key/value를 그대로 INSERT (컬럼 존재하는 것만 넣어야 함)
    return: lastrowid
    """
    if not payload:
        raise HTTPException(status_code=400, detail=f"no insertable columns for {table}")
    cols = list(payload.keys())
    vals = [payload[c] for c in cols]
    col_sql = ", ".join(cols)
    ph_sql = ", ".join(["%s"] * len(cols))
    sql = f"INSERT INTO {table} ({col_sql}) VALUES ({ph_sql})"
    cur.execute(sql, vals)
    return int(cur.lastrowid)


def _update_dynamic(cur, table: str, key_col: str, key_val: Any, payload: dict) -> int:
    """
    payload의 key/value를 그대로 UPDATE
    return: affected rows
    """
    if not payload:
        return 0
    sets = ", ".join([f"{k}=%s" for k in payload.keys()])
    vals = list(payload.values()) + [key_val]
    sql = f"UPDATE {table} SET {sets} WHERE {key_col}=%s"
    cur.execute(sql, vals)
    return int(cur.rowcount)


def _get_reviewer_id_from_header(request: Request) -> Optional[int]:
    """
    Admin UI(Next) -> FastAPI 호출 시 사용자 식별자 전달용
    - 헤더: X-User-Id: <int>
    """
    raw = request.headers.get("x-user-id") or request.headers.get("X-User-Id")
    if not raw:
        return None
    try:
        v = int(str(raw).strip())
        return v if v > 0 else None
    except Exception:
        return None


# =========================
# Access log helpers (existing)
# =========================

def _get_access_log(conn, log_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM access_log WHERE log_id=%s", (log_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="log not found")
        return row


# =========================
# Review Event (review_event) SSOT
# =========================

REVIEW_STATUS_OPEN = "OPEN"
REVIEW_STATUS_IN_PROGRESS = "IN_PROGRESS"
REVIEW_STATUS_CLOSED = "CLOSED"

REVIEW_ALLOWED_STATUS = {REVIEW_STATUS_OPEN, REVIEW_STATUS_IN_PROGRESS, REVIEW_STATUS_CLOSED}

REVIEW_ACTION_ALLOW = "ALLOW"
REVIEW_ACTION_BLOCK = "BLOCK"
REVIEW_ACTION_CREATE_POLICY = "CREATE_POLICY"
REVIEW_ACTION_UPDATE_POLICY = "UPDATE_POLICY"
REVIEW_ACTION_NO_ACTION = "NO_ACTION"

REVIEW_ALLOWED_ACTION = {
    REVIEW_ACTION_ALLOW,
    REVIEW_ACTION_BLOCK,
    REVIEW_ACTION_CREATE_POLICY,
    REVIEW_ACTION_UPDATE_POLICY,
    REVIEW_ACTION_NO_ACTION,
}


def _review_id_col(conn) -> str:
    cols = _get_table_cols(conn, "review_event")
    if "review_id" not in cols:
        raise HTTPException(status_code=500, detail="review_event.review_id column not found (SSOT mismatch)")
    return "review_id"


def _get_review_event_by_id(conn, review_id: int) -> dict:
    id_col = _review_id_col(conn)
    with conn.cursor() as cur:
        cur.execute(f"SELECT * FROM review_event WHERE {id_col}=%s", (review_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="review_event not found")
        return row


def _get_review_event_by_log(conn, log_id: int) -> Optional[dict]:
    cols = _get_table_cols(conn, "review_event")
    if "log_id" not in cols:
        raise HTTPException(status_code=500, detail="review_event.log_id column not found")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM review_event WHERE log_id=%s ORDER BY review_id DESC LIMIT 1",
            (int(log_id),),
        )
        return cur.fetchone()


class ReviewEventCreateRequest(BaseModel):
    # 설계서 기준: 생성 최소값
    log_id: int
    proposed_action: Optional[str] = None  # ALLOW/BLOCK/CREATE_POLICY/UPDATE_POLICY/NO_ACTION
    note: Optional[str] = None

    # 운영자 지정(선택) - 설계서: reviewer_id는 nullable
    reviewer_id: Optional[int] = None


class ReviewEventPatchRequest(BaseModel):
    status: Optional[str] = None  # OPEN/IN_PROGRESS/CLOSED
    proposed_action: Optional[str] = None
    note: Optional[str] = None
    reviewer_id: Optional[int] = None


class CreatePolicyFromReviewRequest(BaseModel):
    # 정책 생성 시 override 용 (없으면 access_log 기반)
    policy_name: Optional[str] = None
    policy_type: Optional[str] = None  # ALLOWLIST/BLOCKLIST/MONITOR
    action: Optional[str] = None       # ALLOW/BLOCK/MONITOR

    host: Optional[str] = None
    path: Optional[str] = None
    method: Optional[str] = None


class ResolveReviewRequest(BaseModel):
    # CLOSED 처리 + (옵션) policy 생성
    note: Optional[str] = None
    reviewer_id: Optional[int] = None
    create_policy: bool = False
    policy_override: Optional[CreatePolicyFromReviewRequest] = None


def _create_policy_from_review_tx(
    cur,
    conn,
    review_event: dict,
    access_log: dict,
    override: Optional[CreatePolicyFromReviewRequest],
) -> int:
    """
    트랜잭션 내부에서 실행.
    DB 스키마(2026-03-03 확인) 기준:
    - policy.is_enabled 사용
    - policy_rule: (rule_type, match_type, pattern, is_case_sensitive, is_negated, rule_order) 필수
    - policy_audit: (changed_by, changed_at, change_note, source_review_id, after_snapshot 등)
    return: policy_id
    """
    policy_cols = _get_table_cols(conn, "policy")
    rule_cols = _get_table_cols(conn, "policy_rule")
    audit_cols = _get_table_cols(conn, "policy_audit")
    review_cols = _get_table_cols(conn, "review_event")

    review_id = int(review_event["review_id"])
    log_id = int(review_event["log_id"])

    # access_log 기반 + override 우선
    def pick_log_or_override(log_key: str, ov_val: Optional[str]) -> Optional[str]:
        if ov_val is not None and ov_val != "":
            return ov_val
        v = access_log.get(log_key)
        if v is None:
            return None
        return str(v)

    host_raw = pick_log_or_override("host", override.host if override else None)
    path_raw = pick_log_or_override("path", override.path if override else None)

    # method는 access_log에 있을 수 있지만, policy_rule enum에 METHOD가 없어서 정책 rule로는 미사용
    method = pick_log_or_override("method", override.method if override else None)

    # ---- P0: noisy/dev/admin-ui 요청으로 정책 자동 생성 금지 ----
    if _is_noise_request_for_policy(host_raw, path_raw):
        raise HTTPException(
            status_code=400,
            detail="cannot create policy: noisy/dev/admin-ui request (nextjs/internal)",
        )

    # ---- normalize: host에서 포트 제거, path에서 query 제거 ----
    host = _strip_port_from_host(host_raw)
    path = _normalize_path_for_policy(path_raw)

    policy_name = (override.policy_name if override and override.policy_name else None) or f"review-{review_id}-log-{log_id}"
    policy_type = (override.policy_type if override and override.policy_type else None) or "BLOCKLIST"
    action = (override.action if override and override.action else None) or "BLOCK"

    # 최소 룰: host 필수
    if not host:
        raise HTTPException(status_code=400, detail="cannot create policy: access_log.host is empty")

    reviewer_id = int(review_event.get("reviewer_id") or 0)
    if reviewer_id <= 0:
        reviewer_id = 1  # 스키마 NOT NULL 안전장치 (운영자 헤더가 안 오면 1로)

    # ---- policy INSERT (policy 스키마 맞춤) ----
    base_policy_payload = {
        "policy_name": policy_name,
        "policy_type": policy_type,
        "action": action,
        "priority": 100,
        "is_enabled": 1,
        "created_at": _now_str(),
        "updated_at": _now_str(),
        "created_by": reviewer_id,
        "updated_by": reviewer_id,
    }
    policy_payload = _filter_payload_by_cols(base_policy_payload, policy_cols)
    policy_id = _insert_dynamic(cur, "policy", policy_payload)

    # ---- policy_rule INSERT (policy_rule 스키마 맞춤) ----
    rules = []

    # HOST rule: EXACT 매칭 권장
    host_rule = {
        "policy_id": policy_id,
        "rule_type": "HOST",
        "match_type": "EXACT",
        "pattern": host,
        "is_case_sensitive": 0,
        "is_negated": 0,
        "rule_order": 0,
        "is_enabled": 1,
        "created_at": _now_str(),
    }
    host_rule = _filter_payload_by_cols(host_rule, rule_cols)
    if not host_rule:
        raise HTTPException(status_code=500, detail="policy_rule schema mismatch: cannot insert HOST rule")
    rules.append(host_rule)

    # PATH rule: PREFIX 매칭 권장
    if path:
        path_rule = {
            "policy_id": policy_id,
            "rule_type": "PATH",
            "match_type": "PREFIX",
            "pattern": path,
            "is_case_sensitive": 0,
            "is_negated": 0,
            "rule_order": 1,
            "is_enabled": 1,
            "created_at": _now_str(),
        }
        path_rule = _filter_payload_by_cols(path_rule, rule_cols)
        if path_rule:
            rules.append(path_rule)

    for r in rules:
        _insert_dynamic(cur, "policy_rule", r)

    # ---- policy_audit INSERT (policy_audit 스키마 맞춤) ----
    audit_payload = {
        "policy_id": policy_id,
        "action": "CREATE",
        "changed_by": reviewer_id,
        "changed_at": _now_str(),
        "source_review_id": review_id,
        "change_note": f"policy created from review_event(review_id={review_id}, log_id={log_id})",
        "before_snapshot": None,
        "after_snapshot": json.dumps(
            {
                "policy": {
                    "policy_id": policy_id,
                    "policy_name": policy_name,
                    "policy_type": policy_type,
                    "action": action,
                    "priority": 100,
                    "is_enabled": 1,
                },
                "rules": [
                    {"rule_type": "HOST", "match_type": "EXACT", "pattern": host},
                    {"rule_type": "PATH", "match_type": "PREFIX", "pattern": path} if path else None,
                ],
                "source": {"review_id": review_id, "log_id": log_id},
                "log_context": {"method": method},
            },
            ensure_ascii=False,
        ),
    }
    audit_payload = _filter_payload_by_cols(audit_payload, audit_cols)
    if audit_payload:
        _insert_dynamic(cur, "policy_audit", audit_payload)

    # ---- review_event 업데이트: generated_policy_id + CLOSED + reviewed_at (+ reviewer_id 보정 가능) ----
    upd = {}
    if "generated_policy_id" in review_cols:
        upd["generated_policy_id"] = policy_id
    if "status" in review_cols:
        upd["status"] = REVIEW_STATUS_CLOSED
    if "reviewed_at" in review_cols:
        upd["reviewed_at"] = _now_str()
    if "reviewer_id" in review_cols and review_event.get("reviewer_id") is not None:
        try:
            upd["reviewer_id"] = int(review_event.get("reviewer_id"))
        except Exception:
            pass
    if "updated_at" in review_cols:
        upd["updated_at"] = _now_str()

    if upd:
        _update_dynamic(cur, "review_event", "review_id", review_id, upd)

    return policy_id


# -------------------------
# Review Event API (review_event)
# -------------------------

@app.get("/v1/review-events")
@app.get("/review-events")
@app.get("/v1/incidents")   # backward alias
@app.get("/incidents")      # backward alias
def list_review_events(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    page: Optional[int] = Query(None, ge=1),
    status: Optional[str] = None,
    log_id: Optional[int] = None,
    sort: Optional[str] = "created_at",
    dir: Optional[str] = "desc",
):
    if page is not None:
        offset = (page - 1) * limit

    with db_conn() as conn:
        cols = _get_table_cols(conn, "review_event")

        where = []
        params: List[Any] = []

        if status:
            if status not in REVIEW_ALLOWED_STATUS:
                raise HTTPException(status_code=400, detail="invalid status (OPEN/IN_PROGRESS/CLOSED)")
            if "status" in cols:
                where.append("status=%s")
                params.append(status)

        if log_id is not None and "log_id" in cols:
            where.append("log_id=%s")
            params.append(int(log_id))

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        allowed_sort = [c for c in ["created_at", "reviewed_at", "status", "log_id", "review_id"] if c in cols]
        if sort not in allowed_sort:
            sort = allowed_sort[0] if allowed_sort else "review_id"

        if (dir or "").lower() not in ("asc", "desc"):
            dir = "desc"

        order_sql = f"ORDER BY {sort} {dir.upper()}"

        count_sql = f"SELECT COUNT(*) AS cnt FROM review_event {where_sql}"
        data_sql = f"SELECT * FROM review_event {where_sql} {order_sql} LIMIT %s OFFSET %s"

        with conn.cursor() as cur:
            cur.execute(count_sql, params)
            total = int(cur.fetchone()["cnt"])

            cur.execute(data_sql, params + [limit, offset])
            rows = cur.fetchall()

    current_page = (offset // limit) + 1 if limit > 0 else 1

    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "page": current_page,
        "sort": sort,
        "dir": dir,
    }

@app.get("/v1/review-events/{review_id}")
@app.get("/review-events/{review_id}")
@app.get("/v1/incidents/{review_id}")  # backward alias
@app.get("/incidents/{review_id}")     # backward alias
def get_review_event(review_id: int, include_log: bool = Query(True)):
    with db_conn() as conn:
        ev = _get_review_event_by_id(conn, review_id)
        if not include_log:
            return {"review_event": ev}

        log_id = ev.get("log_id")
        log = _get_access_log(conn, int(log_id)) if log_id is not None else None
        return {"review_event": ev, "log": log}


@app.get("/v1/review-events/by-log/{log_id}")
@app.get("/review-events/by-log/{log_id}")
@app.get("/v1/incidents/by-log/{log_id}")  # backward alias
@app.get("/incidents/by-log/{log_id}")     # backward alias
def get_review_event_by_log(log_id: int):
    with db_conn() as conn:
        ev = _get_review_event_by_log(conn, int(log_id))
        return {"review_event": ev}


@app.post("/v1/review-events")
@app.post("/review-events")
@app.post("/v1/incidents")  # backward alias
@app.post("/incidents")     # backward alias
def create_review_event(req: ReviewEventCreateRequest, request: Request):
    with db_conn() as conn:
        # 1) access_log 존재 확인 (설계서 기준: review_event.log_id FK 성격)
        log = _get_access_log(conn, int(req.log_id))

        cols = _get_table_cols(conn, "review_event")
        _ = _review_id_col(conn)

        if req.proposed_action is not None and req.proposed_action not in REVIEW_ALLOWED_ACTION:
            raise HTTPException(
                status_code=400,
                detail="invalid proposed_action (ALLOW/BLOCK/CREATE_POLICY/UPDATE_POLICY/NO_ACTION)",
            )

        # reviewer_id 자동 주입: req 우선, 없으면 헤더(X-User-Id)
        reviewer_id = req.reviewer_id if req.reviewer_id is not None else _get_reviewer_id_from_header(request)

        # 2) 운영 정책(추천): log_id당 OPEN/IN_PROGRESS는 1개만 허용
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM review_event
                WHERE log_id=%s AND status IN (%s, %s)
                ORDER BY review_id DESC
                LIMIT 1
                """,
                (int(req.log_id), REVIEW_STATUS_OPEN, REVIEW_STATUS_IN_PROGRESS),
            )
            existing = cur.fetchone()

        if existing:
            return {"review_event": existing, "log": log}

        # 3) 없으면 새로 생성
        payload = {
            "log_id": int(req.log_id),
            "status": REVIEW_STATUS_OPEN,
            "proposed_action": req.proposed_action,
            "reviewer_id": reviewer_id,
            "note": (req.note[:255] if req.note else None),
            "created_at": _now_str(),
            "reviewed_at": None,
            "generated_policy_id": None,
        }
        payload = _filter_payload_by_cols(payload, cols)

        with conn.cursor() as cur:
            new_id = _insert_dynamic(cur, "review_event", payload)

        ev = _get_review_event_by_id(conn, new_id)
        return {"review_event": ev, "log": log}


@app.patch("/v1/review-events/{review_id}")
@app.patch("/review-events/{review_id}")
@app.patch("/v1/incidents/{review_id}")  # backward alias
@app.patch("/incidents/{review_id}")     # backward alias
def patch_review_event(review_id: int, req: ReviewEventPatchRequest, request: Request):
    with db_conn() as conn:
        cols = _get_table_cols(conn, "review_event")
        id_col = _review_id_col(conn)

        _ = _get_review_event_by_id(conn, review_id)

        payload = {}
        header_reviewer_id = _get_reviewer_id_from_header(request)

        status_changed = False
        action_changed = False

        if req.status is not None:
            if req.status not in REVIEW_ALLOWED_STATUS:
                raise HTTPException(status_code=400, detail="invalid status (OPEN/IN_PROGRESS/CLOSED)")
            if "status" in cols:
                payload["status"] = req.status
                status_changed = True
            if req.status == REVIEW_STATUS_CLOSED and "reviewed_at" in cols:
                payload["reviewed_at"] = _now_str()

        if req.proposed_action is not None:
            if req.proposed_action not in REVIEW_ALLOWED_ACTION:
                raise HTTPException(
                    status_code=400,
                    detail="invalid proposed_action (ALLOW/BLOCK/CREATE_POLICY/UPDATE_POLICY/NO_ACTION)",
                )
            if "proposed_action" in cols:
                payload["proposed_action"] = req.proposed_action
                action_changed = True

        if req.note is not None and "note" in cols:
            payload["note"] = req.note[:255]

        # reviewer_id: req 우선, (status/proposed_action 변경 시) 헤더 fallback
        if "reviewer_id" in cols:
            if req.reviewer_id is not None:
                payload["reviewer_id"] = int(req.reviewer_id)
            elif (status_changed or action_changed) and header_reviewer_id is not None:
                payload["reviewer_id"] = int(header_reviewer_id)

        if "updated_at" in cols:
            payload["updated_at"] = _now_str()

        with conn.cursor() as cur:
            _update_dynamic(cur, "review_event", id_col, review_id, payload)

        ev = _get_review_event_by_id(conn, review_id)
        return {"review_event": ev}


@app.post("/v1/review-events/{review_id}/actions/create-policy")
@app.post("/review-events/{review_id}/actions/create-policy")
@app.post("/v1/incidents/{review_id}/actions/create-policy")  # backward alias
@app.post("/incidents/{review_id}/actions/create-policy")     # backward alias
def create_policy_from_review_event(review_id: int, body: Optional[CreatePolicyFromReviewRequest] = None, request: Request = None):
    """
    review_event 기반 policy + policy_rule 생성, policy_audit.source_review_id로 연결,
    review_event.generated_policy_id 갱신 + CLOSED 처리.
    """
    conn = db_conn()
    try:
        conn.autocommit(False)
        with conn.cursor() as cur:
            ev = _get_review_event_by_id(conn, review_id)
            log = _get_access_log(conn, int(ev["log_id"]))

            if ev.get("proposed_action") and ev.get("proposed_action") != REVIEW_ACTION_CREATE_POLICY:
                raise HTTPException(status_code=400, detail="proposed_action is not CREATE_POLICY")

            # reviewer_id 자동 보정: ev에 없으면 헤더(X-User-Id)로 review_event에 먼저 반영
            cols = _get_table_cols(conn, "review_event")
            header_reviewer_id = _get_reviewer_id_from_header(request) if request is not None else None
            if "reviewer_id" in cols:
                ev_reviewer = ev.get("reviewer_id")
                if (ev_reviewer is None or int(ev_reviewer or 0) <= 0) and header_reviewer_id is not None:
                    _update_dynamic(cur, "review_event", "review_id", int(review_id), {"reviewer_id": int(header_reviewer_id), "updated_at": _now_str()} if "updated_at" in cols else {"reviewer_id": int(header_reviewer_id)})
                    ev["reviewer_id"] = int(header_reviewer_id)

            policy_id = _create_policy_from_review_tx(cur, conn, ev, log, override=body)
            conn.commit()

        with conn.cursor() as cur:
            cur.execute("SELECT * FROM policy WHERE policy_id=%s", (policy_id,))
            pol = cur.fetchone()

        updated_ev = _get_review_event_by_id(conn, review_id)
        after_snapshot = _snapshot_policy(conn, int(policy_id))
        _safe_send_policy_alert(
            event_action="CREATE",
            policy_id=int(policy_id),
            changed_by=int(updated_ev.get("reviewer_id") or 1),
            before_snapshot={},
            after_snapshot=after_snapshot,
            change_note=f"policy created from review_event(review_id={review_id}, log_id={ev['log_id']})",
            source_review_id=int(review_id),
        )
        return {"policy_id": policy_id, "policy": pol, "review_event": updated_ev}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        
        # 예상 못한 오류 발생시 Slack 알림
        _safe_send_platform_error(f"/v1/review-events/{review_id}/actions/create-policy [POST]", str(e))
        
        raise HTTPException(status_code=500, detail=f"create-policy failed: {str(e)}")
    finally:
        conn.autocommit(True)
        conn.close()


@app.post("/v1/review-events/{review_id}/resolve")
@app.post("/review-events/{review_id}/resolve")
@app.post("/v1/incidents/{review_id}/resolve")  # backward alias
@app.post("/incidents/{review_id}/resolve")     # backward alias
def resolve_review_event(review_id: int, req: ResolveReviewRequest, request: Request):
    """
    설계서: CLOSED 시 reviewed_at 기록.
    옵션: create_policy=True면 resolve 과정에서 policy 생성까지 수행하고 연결.
    """
    conn = db_conn()
    try:
        conn.autocommit(False)
        with conn.cursor() as cur:
            ev = _get_review_event_by_id(conn, review_id)
            log = _get_access_log(conn, int(ev["log_id"]))

            cols = _get_table_cols(conn, "review_event")
            header_reviewer_id = _get_reviewer_id_from_header(request)

            # reviewer_id 결정: req 우선, 없으면 헤더
            effective_reviewer_id: Optional[int] = None
            if req.reviewer_id is not None:
                effective_reviewer_id = int(req.reviewer_id)
            elif header_reviewer_id is not None:
                effective_reviewer_id = int(header_reviewer_id)

            # 정책 생성 시에도 reviewer_id가 tx로 전달되게 ev에 주입
            if effective_reviewer_id is not None:
                ev["reviewer_id"] = effective_reviewer_id

            created_policy_id = None
            if req.create_policy:
                created_policy_id = _create_policy_from_review_tx(
                    cur,
                    conn,
                    ev,
                    log,
                    override=req.policy_override,
                )

            upd = {}

            if "status" in cols:
                upd["status"] = REVIEW_STATUS_CLOSED
            if "reviewed_at" in cols:
                upd["reviewed_at"] = _now_str()

            if "reviewer_id" in cols and effective_reviewer_id is not None:
                upd["reviewer_id"] = effective_reviewer_id

            if req.note is not None and "note" in cols:
                upd["note"] = req.note[:255]
            if "updated_at" in cols:
                upd["updated_at"] = _now_str()

            if upd:
                _update_dynamic(cur, "review_event", "review_id", review_id, upd)

            conn.commit()

        updated_ev = _get_review_event_by_id(conn, review_id)
        return {"review_event": updated_ev, "created_policy_id": created_policy_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()

        # 예상 못한 오류 발생시 Slack 알림
        _safe_send_platform_error(f"/v1/review-events/{review_id}/resolve [POST]", str(e))

        raise HTTPException(status_code=500, detail=f"resolve failed: {str(e)}")
    finally:
        conn.autocommit(True)
        conn.close()

# =========================
# Policy creation normalization / noise filtering (P0)
# =========================

def _strip_port_from_host(host: Optional[str]) -> Optional[str]:
    """
    host가 'ip:port' 형태면 port 제거.
    IPv4 기준(프로젝트 원칙).
    """
    if not host:
        return host
    h = str(host).strip()
    if ":" in h:
        parts = h.split(":")
        if len(parts) == 2 and parts[1].isdigit():
            return parts[0]
    return h


def _normalize_path_for_policy(path: Optional[str]) -> Optional[str]:
    """
    정책 rule 생성용 path 정규화:
    - query 제거 (? 이후 제거)
    - 길이 제한(폭주 방지)
    """
    if not path:
        return None
    s = str(path).strip()

    qpos = s.find("?")
    if qpos >= 0:
        s = s[:qpos]

    if len(s) > 256:
        s = s[:256]

    return s if s else None


def _is_noise_request_for_policy(host: Optional[str], path: Optional[str]) -> bool:
    """
    제품화 P0:
    - Next.js dev / internal 잡음 요청으로 정책 생성 금지
    - Admin UI 자체 트래픽으로 정책 생성 금지(현재 환경 기준)
    """
    h = (host or "").strip().lower()
    p = (path or "").strip().lower()

    # Next.js 내부/개발 잡음
    if p.startswith("/__nextjs_source-map"):
        return True
    if p.startswith("/_next/"):
        return True
    if p in ("/favicon.ico", "/robots.txt"):
        return True
    if "_rsc=" in p:
        return True

    # Admin UI 자체(현재 환경) - 정책 자동생성 제외
    # host에 포트가 붙는 경우가 있어서 둘 다 방어
    if h in ("192.168.1.24:8080", "192.168.1.24"):
        return True

    return False

def _snapshot_policy(conn, policy_id: int) -> dict:
    """
    policy_audit before/after_snapshot용 스냅샷
    - policy row
    - policy_rule rows
    """
    pol = _get_policy_by_id(conn, int(policy_id))
    rules = _list_policy_rules(conn, int(policy_id))
    return {"policy": pol, "rules": rules}

# =========================
# Policy audit helpers for rule changes
# =========================

def _get_policy_and_rules(conn, policy_id: int) -> dict:
    pol = _get_policy_by_id(conn, int(policy_id))
    rules = _list_policy_rules(conn, int(policy_id))
    return {"policy": pol, "rules": rules}

def _insert_policy_audit_update(
    cur,
    conn,
    policy_id: int,
    changed_by: int,
    change_note: str,
    before_obj: dict,
    after_obj: dict,
    source_review_id: Optional[int] = None,
) -> None:
    audit_cols = _get_table_cols(conn, "policy_audit")

    payload = {
        "policy_id": int(policy_id),
        "action": "UPDATE",
        "changed_by": int(changed_by),
        "changed_at": _now_str(),
        "source_review_id": int(source_review_id) if source_review_id is not None else None,
        "change_note": (change_note[:255] if change_note else None),
        "before_snapshot": json.dumps(before_obj, ensure_ascii=False, default=str),
        "after_snapshot": json.dumps(after_obj, ensure_ascii=False, default=str),
    }
    payload = _filter_payload_by_cols(payload, audit_cols)
    if payload:
        _insert_dynamic(cur, "policy_audit", payload)

def _touch_policy_updated(cur, conn, policy_id: int, user_id: int) -> None:
    cols = _get_table_cols(conn, "policy")
    upd = {}
    if "updated_at" in cols:
        upd["updated_at"] = _now_str()
    if "updated_by" in cols and user_id and user_id > 0:
        upd["updated_by"] = int(user_id)
    if upd:
        _update_dynamic(cur, "policy", "policy_id", int(policy_id), upd)

# =========================
# Policy API (policy, policy_rule)
# =========================

def _get_policy_by_id(conn, policy_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM policy WHERE policy_id=%s", (int(policy_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="policy not found")
        return row


def _list_policy_rules(conn, policy_id: int) -> List[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT *
            FROM policy_rule
            WHERE policy_id=%s
            ORDER BY rule_order ASC, rule_id ASC
            """,
            (int(policy_id),),
        )
        return cur.fetchall() or []

@app.get("/v1/policy-audits")
@app.get("/policy-audits")
def list_policy_audits(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    policy_id: Optional[int] = None,
    action: Optional[str] = None,
    source_review_id: Optional[int] = None,
    sort: str = Query("changed_at"),
    dir: str = Query("desc"),
):
    with db_conn() as conn:
        audit_cols = _get_table_cols(conn, "policy_audit")

        where = []
        params: List[Any] = []

        if policy_id is not None and "policy_id" in audit_cols:
            where.append("pa.policy_id = %s")
            params.append(int(policy_id))

        if action and "action" in audit_cols:
            where.append("pa.action = %s")
            params.append(action)

        if source_review_id is not None and "source_review_id" in audit_cols:
            where.append("pa.source_review_id = %s")
            params.append(int(source_review_id))

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        allowed_sort = [c for c in ["changed_at", "audit_id", "policy_id", "action", "changed_by"] if c in audit_cols]
        if sort not in allowed_sort:
            sort = "changed_at" if "changed_at" in audit_cols else (allowed_sort[0] if allowed_sort else "audit_id")

        if (dir or "").lower() not in ("asc", "desc"):
            dir = "desc"

        order_sql = f"ORDER BY pa.{sort} {dir.upper()}"

        count_sql = f"""
        SELECT COUNT(*) AS cnt
        FROM policy_audit pa
        {where_sql}
        """

        data_sql = f"""
        SELECT
          pa.*,
          p.policy_name
        FROM policy_audit pa
        LEFT JOIN policy p
          ON p.policy_id = pa.policy_id
        {where_sql}
        {order_sql}
        LIMIT %s OFFSET %s
        """

        with conn.cursor() as cur:
            cur.execute(count_sql, params)
            total = int(cur.fetchone()["cnt"])

            cur.execute(data_sql, params + [limit, offset])
            rows = cur.fetchall() or []

    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "sort": sort,
        "dir": dir,
    }

@app.get("/v1/policies")
@app.get("/policies")
def list_policies(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    q: Optional[str] = None,
    policy_type: Optional[str] = None,
    action: Optional[str] = None,
    is_enabled: Optional[int] = None,
    sort: str = Query("created_at"),
    dir: str = Query("desc"),
):
    with db_conn() as conn:
        cols = _get_table_cols(conn, "policy")

        where = []
        params: List[Any] = []

        if q:
            # name 기반 검색
            if "policy_name" in cols:
                where.append("policy_name LIKE %s")
                params.append(f"%{q}%")

        if policy_type and "policy_type" in cols:
            where.append("policy_type=%s")
            params.append(policy_type)

        if action and "action" in cols:
            where.append("action=%s")
            params.append(action)

        if is_enabled is not None and "is_enabled" in cols:
                where.append("is_enabled=%s")
                params.append(int(is_enabled))

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        allowed_sort = [c for c in ["created_at", "updated_at", "priority", "policy_id", "policy_name"] if c in cols]
        if sort not in allowed_sort:
            sort = allowed_sort[0] if allowed_sort else "policy_id"

        if (dir or "").lower() not in ("asc", "desc"):
            dir = "desc"

        order_sql = f"ORDER BY {sort} {dir.upper()}"

        count_sql = f"SELECT COUNT(*) AS cnt FROM policy {where_sql}"
        data_sql = f"SELECT * FROM policy {where_sql} {order_sql} LIMIT %s OFFSET %s"

        with conn.cursor() as cur:
            cur.execute(count_sql, params)
            total = int(cur.fetchone()["cnt"])

            cur.execute(data_sql, params + [limit, offset])
            rows = cur.fetchall() or []

    return {"items": rows, "total": total, "limit": limit, "offset": offset, "sort": sort, "dir": dir}

class PolicyCreateRequest(BaseModel):
    policy_name: str = Field(..., min_length=1, max_length=100)
    policy_type: str = Field(..., min_length=1, max_length=32)
    action: str = Field(..., min_length=1, max_length=32)

    priority: int = 100
    is_enabled: int = 1

    risk_level: Optional[str] = None
    category: Optional[str] = None
    block_status_code: Optional[int] = None
    redirect_url: Optional[str] = None
    description: Optional[str] = None


@app.post("/v1/policies")
@app.post("/policies")
def create_policy(req: PolicyCreateRequest, request: Request):
    conn = db_conn()
    try:
        conn.autocommit(False)

        cols = _get_table_cols(conn, "policy")
        audit_cols = _get_table_cols(conn, "policy_audit")

        reviewer_id = _get_reviewer_id_from_header(request)
        created_by = int(reviewer_id) if reviewer_id is not None and int(reviewer_id) > 0 else 1

        payload: Dict[str, Any] = {}

        # request payload -> table columns only
        for k, v in req.model_dump(exclude_unset=True).items():
            if k in cols:
                payload[k] = v

        # normalize empty strings
        for k in ["category", "redirect_url", "description", "risk_level"]:
            if k in payload and isinstance(payload[k], str) and payload[k].strip() == "":
                payload[k] = None

        # system columns
        if "created_at" in cols:
            payload["created_at"] = _now_str()
        if "created_by" in cols:
            payload["created_by"] = created_by

        # keep updated_* consistent on create
        if "updated_at" in cols:
            payload["updated_at"] = _now_str()
        if "updated_by" in cols:
            payload["updated_by"] = created_by

        # required sanity (in case cols filtering removed something)
        if "policy_name" in cols and (not payload.get("policy_name")):
            raise HTTPException(status_code=422, detail="policy_name is required")

        with conn.cursor() as cur:
            policy_id = _insert_dynamic(cur, "policy", payload)

            # after snapshot
            after_snapshot = _snapshot_policy(conn, int(policy_id))

            # policy_audit INSERT (CREATE)
            audit_payload = {
                "policy_id": int(policy_id),
                "action": "CREATE",
                "changed_by": created_by,
                "changed_at": _now_str(),
                "change_note": "policy created via API",
                "before_snapshot": json.dumps({}, ensure_ascii=False, default=str),
                "after_snapshot": json.dumps(after_snapshot, ensure_ascii=False, default=str),
            }
            audit_payload = _filter_payload_by_cols(audit_payload, audit_cols)
            if audit_payload:
                _insert_dynamic(cur, "policy_audit", audit_payload)

        conn.commit()

        after_snapshot = _snapshot_policy(conn, int(policy_id))
        _safe_send_policy_alert(
            event_action="CREATE",
            policy_id=int(policy_id),
            changed_by=int(created_by),
            before_snapshot={},
            after_snapshot=after_snapshot,
            change_note="policy created via API",
        )

        return {"ok": True, "policy_id": int(policy_id), "policy": _get_policy_by_id(conn, int(policy_id))}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()

        msg = str(e)
        # duplicate policy_name 같은 케이스를 좀 더 명확하게
        if "Duplicate" in msg or "duplicate" in msg:
            raise HTTPException(status_code=409, detail=f"create policy failed: {msg}")
        
         # 예상 못한 서버 오류만 Slack 알림
        _safe_send_platform_error("/v1/policies [POST]", msg)

        raise HTTPException(status_code=500, detail=f"create policy failed: {msg}")
    finally:
        try:
            conn.autocommit(True)
        except Exception:
            pass
        conn.close()

@app.get("/v1/policies/{policy_id}")
@app.get("/policies/{policy_id}")
def get_policy(policy_id: int, include_rules: bool = Query(True)):
    with db_conn() as conn:
        pol = _get_policy_by_id(conn, int(policy_id))
        if not include_rules:
            return {"policy": pol}

        rules = _list_policy_rules(conn, int(policy_id))
        return {"policy": pol, "rules": rules}


@app.get("/v1/policies/{policy_id}/rules")
@app.get("/policies/{policy_id}/rules")
def list_policy_rules(policy_id: int):
    with db_conn() as conn:
        _ = _get_policy_by_id(conn, int(policy_id))  # 존재 확인
        rows = _list_policy_rules(conn, int(policy_id))
        return {"items": rows}


class PolicyPatchRequest(BaseModel):
    policy_name: Optional[str] = None
    policy_type: Optional[str] = None
    action: Optional[str] = None
    priority: Optional[int] = None
    is_enabled: Optional[int] = None

    risk_level: Optional[str] = None
    category: Optional[str] = None
    block_status_code: Optional[int] = None
    redirect_url: Optional[str] = None
    description: Optional[str] = None

class PolicyRuleCreateRequest(BaseModel):
    rule_type: str  # HOST/PATH/URL
    match_type: str # EXACT/PREFIX/CONTAINS/REGEX
    pattern: str

    is_case_sensitive: int = 0
    is_negated: int = 0
    rule_order: Optional[int] = None
    is_enabled: int = 1

class PolicyRulePatchRequest(BaseModel):
    rule_type: Optional[str] = None
    match_type: Optional[str] = None
    pattern: Optional[str] = None

    is_case_sensitive: Optional[int] = None
    is_negated: Optional[int] = None
    rule_order: Optional[int] = None
    is_enabled: Optional[int] = None

@app.patch("/v1/policies/{policy_id}")
@app.patch("/policies/{policy_id}")
def patch_policy(policy_id: int, req: PolicyPatchRequest, request: Request):
    conn = db_conn()
    try:
        conn.autocommit(False)

        cols = _get_table_cols(conn, "policy")
        audit_cols = _get_table_cols(conn, "policy_audit")

        # 존재 확인 + before snapshot
        before_snapshot = _snapshot_policy(conn, int(policy_id))

        payload: Dict[str, Any] = {}

        # 허용 필드만 반영
        for k, v in req.model_dump(exclude_unset=True).items():
            if k in cols:
                payload[k] = v

        # updated_at/updated_by 자동 반영
        if "updated_at" in cols:
            payload["updated_at"] = _now_str()

        reviewer_id = _get_reviewer_id_from_header(request)
        changed_by = int(reviewer_id) if reviewer_id is not None and int(reviewer_id) > 0 else 1

        if "updated_by" in cols:
            payload["updated_by"] = changed_by

        # 변경사항이 없으면 audit도 남기지 않음(정상)
        if not payload:
            conn.rollback()
            return {"ok": True, "policy": _get_policy_by_id(conn, int(policy_id))}

        with conn.cursor() as cur:
            _update_dynamic(cur, "policy", "policy_id", int(policy_id), payload)

            # after snapshot
            after_snapshot = _snapshot_policy(conn, int(policy_id))

            # policy_audit INSERT (UPDATE)
            audit_payload = {
                "policy_id": int(policy_id),
                "action": "UPDATE",
                "changed_by": changed_by,
                "changed_at": _now_str(),
                "change_note": f"policy patched via API: fields={list(payload.keys())}",
                "before_snapshot": json.dumps(before_snapshot, ensure_ascii=False, default=str),
                "after_snapshot": json.dumps(after_snapshot, ensure_ascii=False, default=str),
            }
            audit_payload = _filter_payload_by_cols(audit_payload, audit_cols)

            if audit_payload:
                _insert_dynamic(cur, "policy_audit", audit_payload)

        conn.commit()
        
        _safe_send_policy_alert(
            event_action="UPDATE",
            policy_id=int(policy_id),
            changed_by=int(changed_by),
            before_snapshot=before_snapshot,
            after_snapshot=after_snapshot,
            change_note=f"policy patched via API: fields={list(payload.keys())}",
        )

        return {"ok": True, "policy": _get_policy_by_id(conn, int(policy_id))}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        
        # 예상 못한 에러 오류 Slack 알림
        _safe_send_platform_error(f"/v1/policies/{policy_id} [PATCH]", str(e))

        raise HTTPException(status_code=500, detail=f"patch policy failed: {str(e)}")
    finally:
        try:
            conn.autocommit(True)
        except Exception:
            pass
        conn.close()

@app.delete("/v1/policies/{policy_id}")
@app.delete("/policies/{policy_id}")
def delete_policy(policy_id: int, request: Request):
    conn = db_conn()
    try:
        conn.autocommit(False)

        policy_cols = _get_table_cols(conn, "policy")
        rule_cols = _get_table_cols(conn, "policy_rule")
        audit_cols = _get_table_cols(conn, "policy_audit")

        reviewer_id = _get_reviewer_id_from_header(request)
        changed_by = int(reviewer_id) if reviewer_id is not None and int(reviewer_id) > 0 else 1

        # 존재 확인 + 삭제 전 스냅샷
        before_snapshot = _snapshot_policy(conn, int(policy_id))

        with conn.cursor() as cur:
            # 이미 비활성화된 정책이면 중복 삭제 방지
            current_policy = before_snapshot.get("policy") or {}
            if int(current_policy.get("is_enabled") or 0) == 0:
                raise HTTPException(status_code=400, detail="policy already deleted/disabled")

            # 1) policy 비활성화 (soft delete)
            policy_update_payload: Dict[str, Any] = {}
            if "is_enabled" in policy_cols:
                policy_update_payload["is_enabled"] = 0
            if "updated_at" in policy_cols:
                policy_update_payload["updated_at"] = _now_str()
            if "updated_by" in policy_cols:
                policy_update_payload["updated_by"] = changed_by

            if policy_update_payload:
                _update_dynamic(cur, "policy", "policy_id", int(policy_id), policy_update_payload)

            # 2) policy_rule도 함께 비활성화
            rule_update_payload: Dict[str, Any] = {}
            if "is_enabled" in rule_cols:
                rule_update_payload["is_enabled"] = 0

            if rule_update_payload:
                _update_dynamic(cur, "policy_rule", "policy_id", int(policy_id), rule_update_payload)

            # 3) 삭제 후 스냅샷 (실제로는 soft delete 상태)
            after_snapshot = _snapshot_policy(conn, int(policy_id))

            # 4) policy_audit INSERT (DELETE)
            audit_payload = {
                "policy_id": int(policy_id),
                "action": "DELETE",
                "changed_by": changed_by,
                "changed_at": _now_str(),
                "change_note": f"policy soft-deleted via API: policy_id={int(policy_id)}",
                "before_snapshot": json.dumps(before_snapshot, ensure_ascii=False, default=str),
                "after_snapshot": json.dumps(after_snapshot, ensure_ascii=False, default=str),
            }
            audit_payload = _filter_payload_by_cols(audit_payload, audit_cols)
            if audit_payload:
                _insert_dynamic(cur, "policy_audit", audit_payload)

        conn.commit()

        _safe_send_policy_alert(
            event_action="DELETE",
            policy_id=int(policy_id),
            changed_by=int(changed_by),
            before_snapshot=before_snapshot,
            after_snapshot=after_snapshot,
            change_note=f"policy soft-deleted via API: policy_id={int(policy_id)}",
        )

        return {
            "ok": True,
            "deleted_policy_id": int(policy_id),
            "delete_mode": "soft",
            "policy": _get_policy_by_id(conn, int(policy_id)),
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()

        _safe_send_platform_error(f"/v1/policies/{policy_id} [DELETE]", str(e))

        raise HTTPException(status_code=500, detail=f"delete policy failed: {str(e)}")
    finally:
        try:
            conn.autocommit(True)
        except Exception:
            pass
        conn.close()

@app.post("/v1/policies/{policy_id}/rules")
@app.post("/policies/{policy_id}/rules")
def create_policy_rule(policy_id: int, req: PolicyRuleCreateRequest, request: Request):
    user_id = _get_reviewer_id_from_header(request) or 1

    conn = db_conn()
    try:
        conn.autocommit(False)
        with conn.cursor() as cur:
            _ = _get_policy_by_id(conn, int(policy_id))  # 존재 확인
            rule_cols = _get_table_cols(conn, "policy_rule")

            before_obj = _get_policy_and_rules(conn, int(policy_id))

            # rule_order 자동 부여
            rule_order = req.rule_order
            if rule_order is None:
                cur.execute(
                    "SELECT COALESCE(MAX(rule_order), 0) AS mx FROM policy_rule WHERE policy_id=%s",
                    (int(policy_id),),
                )
                mx = int(cur.fetchone()["mx"] or 0)
                rule_order = mx + 1

            payload = {
                "policy_id": int(policy_id),
                "rule_type": req.rule_type,
                "match_type": req.match_type,
                "pattern": req.pattern,
                "is_case_sensitive": int(req.is_case_sensitive or 0),
                "is_negated": int(req.is_negated or 0),
                "rule_order": int(rule_order),
                "is_enabled": int(req.is_enabled),
                "created_at": _now_str(),
            }
            payload = _filter_payload_by_cols(payload, rule_cols)
            rule_id = _insert_dynamic(cur, "policy_rule", payload)

            _touch_policy_updated(cur, conn, int(policy_id), int(user_id))

            after_obj = _get_policy_and_rules(conn, int(policy_id))
            _insert_policy_audit_update(
                cur,
                conn,
                policy_id=int(policy_id),
                changed_by=int(user_id),
                change_note=f"policy_rule CREATE rule_id={rule_id}",
                before_obj=before_obj,
                after_obj=after_obj,
            )

            conn.commit()
            _safe_send_policy_alert(
                event_action="RULE_CREATE",
                policy_id=int(policy_id),
                changed_by=int(user_id),
                before_snapshot=before_obj,
                after_snapshot=after_obj,
                change_note=f"policy_rule CREATE rule_id={rule_id}",
            )
        return {"ok": True, "rule_id": rule_id, "policy_id": int(policy_id)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()

        # 예상 못한 에러 Slack 알림
        _safe_send_platform_error(f"/v1/policies/{policy_id}/rules [POST]", str(e))

        raise HTTPException(status_code=500, detail=f"create rule failed: {str(e)}")
    finally:
        conn.autocommit(True)
        conn.close()


@app.patch("/v1/policy-rules/{rule_id}")
@app.patch("/policy-rules/{rule_id}")
def patch_policy_rule(rule_id: int, req: PolicyRulePatchRequest, request: Request):
    user_id = _get_reviewer_id_from_header(request) or 1

    conn = db_conn()
    try:
        conn.autocommit(False)
        with conn.cursor() as cur:
            rule_cols = _get_table_cols(conn, "policy_rule")

            cur.execute("SELECT * FROM policy_rule WHERE rule_id=%s", (int(rule_id),))
            old = cur.fetchone()
            if not old:
                raise HTTPException(status_code=404, detail="policy_rule not found")

            policy_id = int(old["policy_id"])
            before_obj = _get_policy_and_rules(conn, policy_id)

            payload: Dict[str, Any] = {}
            for k, v in req.model_dump(exclude_unset=True).items():
                if k in rule_cols:
                    payload[k] = v

            if not payload:
                conn.rollback()
                return {"ok": True, "rule": old}

            _update_dynamic(cur, "policy_rule", "rule_id", int(rule_id), payload)

            _touch_policy_updated(cur, conn, int(policy_id), int(user_id))

            after_obj = _get_policy_and_rules(conn, policy_id)
            _insert_policy_audit_update(
                cur,
                conn,
                policy_id=policy_id,
                changed_by=int(user_id),
                change_note=f"policy_rule UPDATE rule_id={rule_id}",
                before_obj=before_obj,
                after_obj=after_obj,
            )

            conn.commit()
            _safe_send_policy_alert(
                event_action="RULE_UPDATE",
                policy_id=int(policy_id),
                changed_by=int(user_id),
                before_snapshot=before_obj,
                after_snapshot=after_obj,
                change_note=f"policy_rule UPDATE rule_id={rule_id}",
            )

        with conn.cursor() as cur:
            cur.execute("SELECT * FROM policy_rule WHERE rule_id=%s", (int(rule_id),))
            now = cur.fetchone()

        return {"ok": True, "rule": now}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()

        # 예상 못한 오류 Slack 알림
        _safe_send_platform_error(f"/v1/policy-rules/{rule_id} [PATCH]", str(e))

        raise HTTPException(status_code=500, detail=f"patch rule failed: {str(e)}")
    finally:
        conn.autocommit(True)
        conn.close()


@app.delete("/v1/policy-rules/{rule_id}")
@app.delete("/policy-rules/{rule_id}")
def delete_policy_rule(rule_id: int, request: Request):
    user_id = _get_reviewer_id_from_header(request) or 1

    conn = db_conn()
    try:
        conn.autocommit(False)
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM policy_rule WHERE rule_id=%s", (int(rule_id),))
            old = cur.fetchone()
            if not old:
                raise HTTPException(status_code=404, detail="policy_rule not found")

            policy_id = int(old["policy_id"])
            before_obj = _get_policy_and_rules(conn, policy_id)

            cur.execute("DELETE FROM policy_rule WHERE rule_id=%s", (int(rule_id),))

            _touch_policy_updated(cur, conn, int(policy_id), int(user_id))

            after_obj = _get_policy_and_rules(conn, policy_id)
            _insert_policy_audit_update(
                cur,
                conn,
                policy_id=policy_id,
                changed_by=int(user_id),
                change_note=f"policy_rule DELETE rule_id={rule_id}",
                before_obj=before_obj,
                after_obj=after_obj,
            )

            conn.commit()
            _safe_send_policy_alert(
                event_action="RULE_DELETE",
                policy_id=int(policy_id),
                changed_by=int(user_id),
                before_snapshot=before_obj,
                after_snapshot=after_obj,
                change_note=f"policy_rule DELETE rule_id={rule_id}",
            )
        return {"ok": True, "deleted_rule_id": int(rule_id), "policy_id": int(policy_id)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()

        # 예상 못한 오류 Slack 알림
        _safe_send_platform_error(f"/v1/policy-rules/{rule_id} [DELETE]", str(e))

        raise HTTPException(status_code=500, detail=f"delete rule failed: {str(e)}")
    finally:
        conn.autocommit(True)
        conn.close()

# =========================
# AI Scoring (existing)
# =========================

class ScoreRequest(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    host: str
    path: Optional[str] = None


class ScoreResponse(BaseModel):
    request_id: str
    model_version: str
    score: float
    label: str
    threshold: float
    latency_ms: int


@app.get("/health")
def health():
    return {
        "status": "ok", 
        "service": "gateguard-ai-api", 
        "model_version": get_model_version(),
        }

# dispatcher endpoint
@app.post("/v1/alerts/dispatch")
def dispatch_alerts(authorization: Optional[str] = Header(default=None)):
    require_token(authorization)

    result = {
        "ai_blocks_sent": 0,
        "repeat_blocks_sent": 0,
        "ai_error_summaries_sent": 0,
        "infra_status_changes_sent": 0,
    }

    try:
        result["ai_blocks_sent"] = _dispatch_recent_ai_blocks()
        result["repeat_blocks_sent"] = _dispatch_repeat_blocked_clients()
        result["ai_error_summaries_sent"] = _dispatch_ai_error_summary()
        result["infra_status_changes_sent"] = _dispatch_infra_status_changes()
    except Exception as e:
        _safe_send_platform_error("/v1/alerts/dispatch", str(e))
        raise HTTPException(status_code=500, detail=f"dispatch alerts failed: {str(e)}")

    result["ok"] = True
    return result

def require_token(authorization: Optional[str]) -> None:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth scheme")
    token = authorization.split(" ", 1)[1].strip()
    if token != API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")

@app.post("/v1/score", response_model=ScoreResponse)
def score(req: ScoreRequest, authorization: Optional[str] = Header(default=None)):
    """
    운영 API 호환 유지:
    - Authorization Bearer 토큰 검사 유지
    - 응답 스키마(request_id, model_version, score, label, threshold, latency_ms) 유지
    - 실제 추론은 ai_manager.score_url() 사용
    """
    require_token(authorization)

    start = time.time()

    h = (req.host or "").lower()
    p = (req.path or "").lower()

    # 기존 엔진 테스트 훅 유지
    if "timeout_test" in h or "timeout_test" in p:
        time.sleep(10)

    if "error_test" in h or "error_test" in p:
        raise HTTPException(status_code=500, detail="forced 500 for engine test")

    if "invalid_test" in h or "invalid_test" in p:
        return Response(
            content='{"request_id": "' + req.request_id + '", "score": 0.1, "label": ',
            media_type="application/json",
            status_code=200,
        )

    try:
        result = score_url(
            request_id=req.request_id,
            log_id=None,   # 현재 엔진 SSOT 정책 유지: 엔진이 ai_analysis 기록
            host=req.host,
            path=req.path or "/",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # platform-dev 알림 추가
        _safe_send_platform_error("/v1/score [POST]", str(exc))

        raise HTTPException(status_code=500, detail=f"AI scoring failed: {exc}") from exc

    latency_ms = int((time.time() - start) * 1000)

    return ScoreResponse(
        request_id=req.request_id,
        model_version=result["model_version"],
        score=round(float(result["score"]), 4),
        label=result["label"],
        threshold=float(THRESHOLD),
        latency_ms=int(latency_ms),
    )

def label_from_score(score: float, threshold: float) -> str:
    return "malicious" if score >= threshold else "benign"

def _security_event_filter_sql(alias: str = "al") -> str:
    return f"""
      {alias}.host IS NOT NULL
      AND {alias}.host <> ''
      AND {alias}.host NOT IN ('192.168.1.24:8080', '192.168.1.24')
      AND (
        {alias}.path IS NULL OR (
          {alias}.path NOT LIKE '%%_rsc=%%'
          AND {alias}.path NOT LIKE '/_next%%'
          AND {alias}.path NOT LIKE '/api/auth%%'
          AND {alias}.path NOT LIKE '/dashboard%%'
          AND {alias}.path NOT LIKE '/logs%%'
          AND {alias}.path NOT LIKE '/policies%%'
          AND {alias}.path NOT LIKE '/ai-analysis%%'
          AND {alias}.path NOT LIKE '/incidents%%'
          AND {alias}.path NOT LIKE '/audit-log%%'
        )
      )
    """

@app.get("/v1/logs")
def list_logs(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    decision: Optional[str] = None,
    stage: Optional[str] = None,
    host: Optional[str] = None,
    client_ip: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    min_score: Optional[float] = Query(default=None, ge=0.0, le=1.0),
    max_score: Optional[float] = Query(default=None, ge=0.0, le=1.0),
    inject_attempted: Optional[int] = Query(default=None, ge=0, le=1),
    inject_send: Optional[int] = Query(default=None, ge=0, le=1),
    inject_status_code: Optional[int] = None,
    sort: Optional[str] = "detect_timestamp",
    dir: Optional[str] = "desc",
):
    latest_ai_join_sql = """
    LEFT JOIN (
      SELECT x.*
      FROM ai_analysis x
      JOIN (
        SELECT log_id, MAX(analysis_seq) AS max_seq
        FROM ai_analysis
        GROUP BY log_id
      ) m ON m.log_id = x.log_id AND m.max_seq = x.analysis_seq
    ) aa ON aa.log_id = al.log_id
    """

    where = [_security_event_filter_sql("al")]
    params: List[Any] = []

    if decision and decision != "all":
        where.append("al.decision = %s")
        params.append(decision)

    if stage and stage != "all":
        where.append("al.decision_stage = %s")
        params.append(stage)

    if host:
        where.append("al.host LIKE %s")
        params.append(f"%{host}%")

    if client_ip:
        where.append("al.client_ip LIKE %s")
        params.append(f"%{client_ip}%")

    if start_time:
        where.append("al.detect_timestamp >= %s")
        params.append(start_time)

    if end_time:
        where.append("al.detect_timestamp <= %s")
        params.append(end_time)

    if min_score is not None:
        where.append("aa.score >= %s")
        params.append(float(min_score))

    if max_score is not None:
        where.append("aa.score <= %s")
        params.append(float(max_score))

    if inject_attempted is not None:
        where.append("al.inject_attempted = %s")
        params.append(int(inject_attempted))

    if inject_send is not None:
        where.append("al.inject_send = %s")
        params.append(int(inject_send))

    if inject_status_code is not None:
        where.append("al.inject_status_code = %s")
        params.append(int(inject_status_code))

    where_sql = "WHERE " + " AND ".join(where)

    allowed_sort = {
        "log_id",
        "detect_timestamp",
        "client_ip",
        "host",
        "path",
        "decision",
        "decision_stage",
        "policy_id",
        "engine_latency_ms",
        "inject_status_code",
        "ai_score",
    }

    if sort not in allowed_sort:
        sort = "detect_timestamp"

    if (dir or "").lower() not in ("asc", "desc"):
        dir = "desc"

    sort_sql_map = {
        "log_id": "al.log_id",
        "detect_timestamp": "al.detect_timestamp",
        "client_ip": "al.client_ip",
        "host": "al.host",
        "path": "al.path",
        "decision": "al.decision",
        "decision_stage": "al.decision_stage",
        "policy_id": "al.policy_id",
        "engine_latency_ms": "al.engine_latency_ms",
        "inject_status_code": "al.inject_status_code",
        "ai_score": "aa.score",
    }
    order_sql = f"ORDER BY {sort_sql_map.get(sort, 'al.detect_timestamp')} {dir.upper()}"

    count_sql = f"""
    SELECT COUNT(*) AS cnt
    FROM access_log al
    {latest_ai_join_sql}
    {where_sql}
    """

    data_sql = f"""
    SELECT
      al.log_id,
      al.request_id,
      al.detect_timestamp,
      al.client_ip,
      al.client_port,
      al.server_ip,
      al.server_port,
      al.host,
      al.path,
      al.method,
      al.url_norm,
      al.decision,
      al.reason,
      al.decision_stage,
      al.policy_id,
      al.user_agent,
      al.engine_latency_ms,
      al.inject_attempted,
      al.inject_send,
      al.inject_errno,
      al.inject_latency_ms,
      al.inject_status_code,
      aa.score AS ai_score,
      aa.label AS ai_label,
      aa.model_version AS ai_model_version,
      aa.latency_ms AS ai_latency_ms,
      aa.error_code AS ai_error_code
    FROM access_log al
    {latest_ai_join_sql}
    {where_sql}
    {order_sql}
    LIMIT %s OFFSET %s
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(count_sql, params)
            row = cur.fetchone()
            total = int(row["cnt"]) if row else 0

            cur.execute(data_sql, params + [limit, offset])
            rows = cur.fetchall() or []

    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "sort": sort,
        "dir": dir,
    }

# FastAPI Health API
@app.get("/v1/system/health")
def system_health():
    snapshot = _get_system_health_snapshot()
    return {
        "engine": snapshot["engine"],
        "fastapi": snapshot["fastapi"],
        "mariadb": snapshot["mariadb"],
        "ai_model": snapshot["ai_model"],
        "model_version": get_model_version() if snapshot["ai_model"] == "loaded" else None,
    }

@app.get("/v1/logs/{log_id}")
def get_log_detail(log_id: int):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM access_log
                WHERE log_id=%s
                """,
                (log_id,),
            )
            log = cur.fetchone()

            if not log:
                raise HTTPException(status_code=404, detail="log not found")

            cur.execute(
                """
                SELECT
                  ai_analysis_id,
                  analyzed_at,
                  score,
                  label,
                  model_version,
                  latency_ms,
                  analysis_seq,
                  ai_response,
                  error_code
                FROM ai_analysis
                WHERE log_id=%s
                ORDER BY analysis_seq DESC
                """,
                (log_id,),
            )
            analyses = cur.fetchall()

    return {"log": log, "analyses": analyses}

# =========================
# Dashboard API
# =========================

def _build_hour_labels(last_hours: int) -> List[str]:
    # 최근 N시간 라벨 생성
    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    labels: List[str] = []
    for i in range(last_hours - 1, -1, -1):
        dt = now - timedelta(hours=i)
        labels.append(dt.strftime("%m-%d %H:00"))
    return labels


def _series_map_to_list(labels: List[str], data_map: Dict[str, dict], defaults: dict) -> List[dict]:
    # 누락 구간 0 채움
    rows: List[dict] = []
    for label in labels:
        row = {"hour": label}
        row.update(defaults)
        if label in data_map:
            row.update(data_map[label])
        rows.append(row)
    return rows

@app.get("/v1/dashboard/ai-threat-distribution")
def get_ai_threat_distribution(
    last_hours: int = Query(24, ge=1, le=168),
):
    """
    최근 N시간 ai_analysis.label 분포 조회
    - benign / phishing / malware
    - 과거 malicious 라벨은 malware로 정규화
    - Dashboard Pie Chart 용
    """
    window_start = datetime.now().replace(minute=0, second=0, microsecond=0) - timedelta(hours=last_hours - 1)
    window_start_str = window_start.strftime("%Y-%m-%d %H:%M:%S")

    base_labels = ["benign", "phishing", "malware"]
    counts_map = {label: 0 for label in base_labels}

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  label,
                  COUNT(*) AS cnt
                FROM ai_analysis
                WHERE analyzed_at >= %s
                  AND label IS NOT NULL
                  AND label <> ''
                GROUP BY label
                ORDER BY cnt DESC, label ASC
                """,
                (window_start_str,),
            )
            rows = cur.fetchall() or []

    for row in rows:
        label = str(row.get("label") or "").strip().lower()
        cnt = int(row.get("cnt") or 0)

        if not label:
            continue

        if label == "malicious":
            label = "malware"

        if label in counts_map:
            counts_map[label] += cnt
        else:
            counts_map[label] = cnt

    total = sum(counts_map.values())

    items = []
    for label, count in counts_map.items():
        percent = round((count / total * 100.0), 1) if total > 0 else 0.0
        items.append({
            "label": label,
            "count": int(count),
            "percent": percent,
        })

    return {
        "items": items,
        "total": int(total),
        "last_hours": last_hours,
    }

@app.get("/v1/dashboard/summary")
def get_dashboard_summary(
    last_hours: int = Query(24, ge=1, le=168),
):
    """
    Dashboard summary API
    - 기존 KPI / 차트 데이터 유지
    - SOC 확장용 top_client_ips / decision_distribution / policy_vs_ai_composition 추가
    """
    window_start = datetime.now().replace(minute=0, second=0, microsecond=0) - timedelta(hours=last_hours - 1)
    window_start_str = window_start.strftime("%Y-%m-%d %H:%M:%S")

    latest_ai_join_sql = """
    LEFT JOIN (
      SELECT x.*
      FROM ai_analysis x
      JOIN (
        SELECT log_id, MAX(analysis_seq) AS max_seq
        FROM ai_analysis
        GROUP BY log_id
      ) m ON m.log_id = x.log_id AND m.max_seq = x.analysis_seq
    ) aa ON aa.log_id = al.log_id
    """

    labels = _build_hour_labels(last_hours)
    security_filter_sql = _security_event_filter_sql("al")

    with db_conn() as conn:
        with conn.cursor() as cur:
            # =========================
            # KPI
            # =========================
            cur.execute(
                f"""
                SELECT COUNT(*) AS cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND {security_filter_sql}
                """,
                (window_start_str,),
            )
            total_requests = int(cur.fetchone()["cnt"] or 0)

            cur.execute(
                f"""
                SELECT COUNT(*) AS cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND al.decision='BLOCK'
                  AND {security_filter_sql}
                """,
                (window_start_str,),
            )
            blocked_requests = int(cur.fetchone()["cnt"] or 0)

            cur.execute(
                f"""
                SELECT COUNT(*) AS cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND al.decision='BLOCK'
                  AND al.decision_stage='AI_STAGE'
                  AND {security_filter_sql}
                """,
                (window_start_str,),
            )
            ai_enforced_blocks = int(cur.fetchone()["cnt"] or 0)

            cur.execute(
                f"""
                SELECT COUNT(*) AS cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND al.decision='BLOCK'
                  AND al.decision_stage='POLICY_STAGE'
                  AND {security_filter_sql}
                """,
                (window_start_str,),
            )
            policy_enforced_blocks = int(cur.fetchone()["cnt"] or 0)

            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM review_event
                WHERE status='OPEN'
                """
            )
            open_incidents = int(cur.fetchone()["cnt"] or 0)

            block_rate = round((blocked_requests / total_requests * 100.0), 1) if total_requests > 0 else 0.0
            ai_block_rate = round((ai_enforced_blocks / blocked_requests * 100.0), 1) if blocked_requests > 0 else 0.0
            policy_block_rate = round((policy_enforced_blocks / blocked_requests * 100.0), 1) if blocked_requests > 0 else 0.0

            # =========================
            # Requests Over Time
            # =========================
            cur.execute(
                f"""
                SELECT
                  DATE_FORMAT(al.detect_timestamp, '%%m-%%d %%H:00') AS hour,
                  COUNT(*) AS requests
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND {security_filter_sql}
                GROUP BY DATE_FORMAT(al.detect_timestamp, '%%m-%%d %%H:00')
                ORDER BY MIN(al.detect_timestamp) ASC
                """,
                (window_start_str,),
            )
            req_rows = cur.fetchall() or []
            req_map = {r["hour"]: {"requests": int(r["requests"] or 0)} for r in req_rows}
            requests_over_time = _series_map_to_list(labels, req_map, {"requests": 0})

            # =========================
            # Block vs Allow Over Time
            # =========================
            cur.execute(
                f"""
                SELECT
                  DATE_FORMAT(al.detect_timestamp, '%%m-%%d %%H:00') AS hour,
                  SUM(CASE WHEN al.decision='ALLOW' THEN 1 ELSE 0 END) AS allow_cnt,
                  SUM(CASE WHEN al.decision='BLOCK' THEN 1 ELSE 0 END) AS block_cnt,
                  SUM(CASE WHEN al.decision='REVIEW' THEN 1 ELSE 0 END) AS review_cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND {security_filter_sql}
                GROUP BY DATE_FORMAT(al.detect_timestamp, '%%m-%%d %%H:00')
                ORDER BY MIN(al.detect_timestamp) ASC
                """,
                (window_start_str,),
            )
            block_rows = cur.fetchall() or []
            block_map = {
                r["hour"]: {
                    "allow": int(r["allow_cnt"] or 0),
                    "block": int(r["block_cnt"] or 0),
                    "review": int(r["review_cnt"] or 0),
                }
                for r in block_rows
            }
            block_vs_allow_over_time = _series_map_to_list(
                labels,
                block_map,
                {"allow": 0, "block": 0, "review": 0},
            )

            # =========================
            # Top Hosts
            # =========================
            cur.execute(
                f"""
                SELECT al.host, COUNT(*) AS cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND {security_filter_sql}
                GROUP BY al.host
                ORDER BY cnt DESC, al.host ASC
                LIMIT 8
                """,
                (window_start_str,),
            )
            top_hosts = [{"host": r["host"], "count": int(r["cnt"] or 0)} for r in (cur.fetchall() or [])]

            # =========================
            # Top Paths
            # =========================
            cur.execute(
                f"""
                SELECT al.path, COUNT(*) AS cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND al.path IS NOT NULL
                  AND al.path <> ''
                  AND {security_filter_sql}
                GROUP BY al.path
                ORDER BY cnt DESC, al.path ASC
                LIMIT 6
                """,
                (window_start_str,),
            )
            top_paths = [{"path": r["path"], "count": int(r["cnt"] or 0)} for r in (cur.fetchall() or [])]

            # =========================
            # Top Client IPs (신규)
            # =========================
            cur.execute(
                f"""
                SELECT al.client_ip, COUNT(*) AS cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND al.client_ip IS NOT NULL
                  AND al.client_ip <> ''
                  AND {security_filter_sql}
                GROUP BY al.client_ip
                ORDER BY cnt DESC, al.client_ip ASC
                LIMIT 8
                """,
                (window_start_str,),
            )
            top_client_ips = [
                {"client_ip": r["client_ip"], "count": int(r["cnt"] or 0)}
                for r in (cur.fetchall() or [])
            ]

            # =========================
            # Decision Distribution (신규)
            # =========================
            cur.execute(
                f"""
                SELECT al.decision, COUNT(*) AS cnt
                FROM access_log al
                WHERE al.detect_timestamp >= %s
                  AND {security_filter_sql}
                GROUP BY al.decision
                ORDER BY cnt DESC, al.decision ASC
                """,
                (window_start_str,),
            )
            decision_distribution = [
                {"decision": r["decision"], "count": int(r["cnt"] or 0)}
                for r in (cur.fetchall() or [])
            ]

            # =========================
            # Policy vs AI Composition (신규)
            # BLOCK 기준으로 stage별 구성비
            # =========================
            policy_vs_ai_composition = [
                {"label": "AI Blocks", "count": int(ai_enforced_blocks)},
                {"label": "Policy Blocks", "count": int(policy_enforced_blocks)},
            ]

            # =========================
            # AI Score Distribution
            # =========================
            cur.execute(
                """
                SELECT
                  CASE
                    WHEN score < 0.1 THEN '0.0-0.1'
                    WHEN score < 0.2 THEN '0.1-0.2'
                    WHEN score < 0.3 THEN '0.2-0.3'
                    WHEN score < 0.4 THEN '0.3-0.4'
                    WHEN score < 0.5 THEN '0.4-0.5'
                    WHEN score < 0.6 THEN '0.5-0.6'
                    WHEN score < 0.7 THEN '0.6-0.7'
                    WHEN score < 0.8 THEN '0.7-0.8'
                    WHEN score < 0.9 THEN '0.8-0.9'
                    ELSE '0.9-1.0'
                  END AS score_range,
                  COUNT(*) AS cnt
                FROM ai_analysis
                WHERE analyzed_at >= %s
                  AND score IS NOT NULL
                GROUP BY score_range
                """,
                (window_start_str,),
            )
            dist_rows = cur.fetchall() or []
            dist_map = {r["score_range"]: int(r["cnt"] or 0) for r in dist_rows}

            score_ranges = [
                "0.0-0.1",
                "0.1-0.2",
                "0.2-0.3",
                "0.3-0.4",
                "0.4-0.5",
                "0.5-0.6",
                "0.6-0.7",
                "0.7-0.8",
                "0.8-0.9",
                "0.9-1.0",
            ]
            ai_score_distribution = [
                {"range": score_range, "count": dist_map.get(score_range, 0)}
                for score_range in score_ranges
            ]

            # =========================
            # AI Latency Over Time
            # =========================
            cur.execute(
                """
                SELECT
                  DATE_FORMAT(analyzed_at, '%%m-%%d %%H:00') AS hour,
                  ROUND(AVG(latency_ms), 0) AS avg_latency,
                  MAX(latency_ms) AS max_latency
                FROM ai_analysis
                WHERE analyzed_at >= %s
                  AND latency_ms IS NOT NULL
                GROUP BY DATE_FORMAT(analyzed_at, '%%m-%%d %%H:00')
                ORDER BY MIN(analyzed_at) ASC
                """,
                (window_start_str,),
            )
            latency_rows = cur.fetchall() or []
            latency_map = {
                r["hour"]: {
                    "avg_latency": int(r["avg_latency"] or 0),
                    "max_latency": int(r["max_latency"] or 0),
                }
                for r in latency_rows
            }
            ai_latency_over_time = _series_map_to_list(
                labels,
                latency_map,
                {"avg_latency": 0, "max_latency": 0},
            )

            # =========================
            # Recent Security Events
            # =========================
            cur.execute(
                f"""
                SELECT
                  al.log_id,
                  al.request_id,
                  al.detect_timestamp,
                  al.client_ip,
                  al.client_port,
                  al.server_ip,
                  al.server_port,
                  al.host,
                  al.path,
                  al.method,
                  al.url_norm,
                  al.decision,
                  al.reason,
                  al.decision_stage,
                  al.policy_id,
                  al.user_agent,
                  al.engine_latency_ms,
                  al.inject_attempted,
                  al.inject_send,
                  al.inject_errno,
                  al.inject_latency_ms,
                  al.inject_status_code,
                  aa.score AS ai_score,
                  aa.label AS ai_label,
                  aa.model_version AS ai_model_version,
                  aa.latency_ms AS ai_latency_ms,
                  aa.error_code AS ai_error_code
                FROM access_log al
                {latest_ai_join_sql}
                WHERE al.detect_timestamp >= %s
                  AND {security_filter_sql}
                ORDER BY al.detect_timestamp DESC, al.log_id DESC
                LIMIT 8
                """,
                (window_start_str,),
            )
            recent_events = cur.fetchall() or []

    return {
        "summary": {
            "total_requests": total_requests,
            "blocked_requests": blocked_requests,
            "block_rate": block_rate,
            "ai_enforced_blocks": ai_enforced_blocks,
            "policy_enforced_blocks": policy_enforced_blocks,
            "open_incidents": open_incidents,
            "ai_block_rate": ai_block_rate,
            "policy_block_rate": policy_block_rate,
        },
        "requests_over_time": requests_over_time,
        "block_vs_allow_over_time": block_vs_allow_over_time,
        "top_hosts": top_hosts,
        "top_paths": top_paths,
        "top_client_ips": top_client_ips,
        "decision_distribution": decision_distribution,
        "policy_vs_ai_composition": policy_vs_ai_composition,
        "ai_score_distribution": ai_score_distribution,
        "ai_latency_over_time": ai_latency_over_time,
        "recent_events": recent_events,
        "last_hours": last_hours,
    }
