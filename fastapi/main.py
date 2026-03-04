import os
import time
import uuid
import json
from datetime import datetime
from typing import Optional, Any, List, Dict

import pymysql
from fastapi import FastAPI, Header, HTTPException, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


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

# --- CORS (Admin UI에서 FastAPI 호출 허용) ---
allowed_origins = [
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
    status: Optional[str] = None,
    log_id: Optional[int] = None,
    sort: Optional[str] = "created_at",
    dir: Optional[str] = "desc",
):
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

    return {"items": rows, "total": total, "limit": limit, "offset": offset, "sort": sort, "dir": dir}


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
        return {"policy_id": policy_id, "policy": pol, "review_event": updated_ev}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
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
        return {"ok": True, "policy": _get_policy_by_id(conn, int(policy_id))}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"patch policy failed: {str(e)}")
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

        return {"ok": True, "rule_id": rule_id, "policy_id": int(policy_id)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
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

        with conn.cursor() as cur:
            cur.execute("SELECT * FROM policy_rule WHERE rule_id=%s", (int(rule_id),))
            now = cur.fetchone()

        return {"ok": True, "rule": now}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
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

        return {"ok": True, "deleted_rule_id": int(rule_id), "policy_id": int(policy_id)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
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
    return {"status": "ok", "service": "gateguard-ai-api", "model_version": MODEL_VERSION}


def require_token(authorization: Optional[str]) -> None:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth scheme")
    token = authorization.split(" ", 1)[1].strip()
    if token != API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")


def simple_score(host: str, path: Optional[str]) -> float:
    s = host + (path or "")
    digit_cnt = sum(ch.isdigit() for ch in s)
    special_cnt = sum((not ch.isalnum()) for ch in s)

    base = 0.10
    base += min(digit_cnt * 0.03, 0.40)
    base += min(special_cnt * 0.02, 0.30)
    if path:
        base += min(len(path) / 200.0, 0.20)
    return max(0.0, min(1.0, base))


def label_from_score(score: float, threshold: float) -> str:
    return "malicious" if score >= threshold else "benign"


@app.get("/v1/logs")
def list_logs(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    decision: Optional[str] = None,
    stage: Optional[str] = None,
    host: Optional[str] = None,
    client_ip: Optional[str] = None,
    sort: Optional[str] = "detect_timestamp",
    dir: Optional[str] = "desc",
):
    where = []
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

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    allowed_sort = {
        "detect_timestamp",
        "client_ip",
        "host",
        "path",
        "decision",
        "decision_stage",
        "policy_id",
        "engine_latency_ms",
    }

    if sort not in allowed_sort:
        sort = "detect_timestamp"

    if (dir or "").lower() not in ("asc", "desc"):
        dir = "desc"

    order_sql = f"ORDER BY al.{sort} {dir.upper()}"

    count_sql = f"""
    SELECT COUNT(*)
    FROM access_log al
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
      aa.model_version AS ai_model_version
    FROM access_log al
    LEFT JOIN (
      SELECT x.*
      FROM ai_analysis x
      JOIN (
        SELECT log_id, MAX(analysis_seq) AS max_seq
        FROM ai_analysis
        GROUP BY log_id
      ) m ON m.log_id = x.log_id AND m.max_seq = x.analysis_seq
    ) aa ON aa.log_id = al.log_id
    {where_sql}
    {order_sql}
    LIMIT %s OFFSET %s
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(count_sql, params)
            row = cur.fetchone()
            total = int(next(iter(row.values()))) if row else 0

            cur.execute(data_sql, params + [limit, offset])
            rows = cur.fetchall()

    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "sort": sort,
        "dir": dir,
    }


@app.post("/v1/score", response_model=ScoreResponse)
def score(req: ScoreRequest, authorization: Optional[str] = Header(default=None)):
    """
    SSOT 정책: FastAPI는 ai_analysis/access_log에 기록하지 않는다.
    - 엔진이 request_id로 access_log를 만들고,
    - 엔진이 /v1/score 응답 결과(정상/실패)를 파싱해서 ai_analysis 및 access_log를 기록한다.
    """
    require_token(authorization)

    start = time.time()

    h = (req.host or "").lower()
    p = (req.path or "").lower()

    # timeout_test: 엔진 curl timeout 유도
    if "timeout_test" in h or "timeout_test" in p:
        time.sleep(10)

    # error_test: HTTP 500 강제 (엔진이 HTTP status로 실패 기록)
    if "error_test" in h or "error_test" in p:
        raise HTTPException(status_code=500, detail="forced 500 for engine test")

    # invalid_test: 200이지만 JSON 깨진 응답 (엔진이 파싱 실패로 실패 기록)
    if "invalid_test" in h or "invalid_test" in p:
        return Response(
            content='{"request_id": "' + req.request_id + '", "score": 0.1, "label": ',
            media_type="application/json",
            status_code=200,
        )

    threshold = THRESHOLD
    s = simple_score(req.host, req.path)
    lbl = label_from_score(s, threshold)
    latency_ms = int((time.time() - start) * 1000)

    return ScoreResponse(
        request_id=req.request_id,
        model_version=MODEL_VERSION,
        score=round(float(s), 4),
        label=lbl,
        threshold=float(threshold),
        latency_ms=int(latency_ms),
    )


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
