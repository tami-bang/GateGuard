# ~/GateGuard/gateguard_api/ai_manager.py
from __future__ import annotations

import time
from typing import Any, Dict, Optional

from gateguard_api.ai_function import predict_score
from gateguard_api.ai_loader import get_model_version
from gateguard_api.db import insert_ai_analysis

def score_url(
    *,
    request_id: Optional[str],
    log_id: Optional[int],
    host: str,
    path: str,
) -> Dict[str, Any]:
    if not host or not str(host).strip():
        raise ValueError("host is required")

    if path is None or str(path).strip() == "":
        path = "/"

    started = time.perf_counter()
    model_version = get_model_version()

    try:
        prediction = predict_score(host=host, path=path)
        latency_ms = int((time.perf_counter() - started) * 1000)

        result = {
            "score": prediction["score"],
            "label": prediction["label"],
            "model_version": model_version,
        }

        if log_id is not None:
            insert_ai_analysis(
                log_id=log_id,
                score=result["score"],
                label=result["label"],
                ai_response=1,
                latency_ms=latency_ms,
                model_version=model_version,
                error_code=None,
                analysis_seq=0,
            )

        return result

    except Exception:
        latency_ms = int((time.perf_counter() - started) * 1000)

        if log_id is not None:
            insert_ai_analysis(
                log_id=log_id,
                score=None,
                label=None,
                ai_response=0,
                latency_ms=latency_ms,
                model_version=model_version,
                error_code="AI_SCORE_FAIL",
                analysis_seq=0,
            )
        raise
