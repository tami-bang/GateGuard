import os
import time
import uuid
from typing import Optional, Any, List

import pymysql
from fastapi import FastAPI, Header, HTTPException, Query, Response
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

    if dir.lower() not in ("asc", "desc"):
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
