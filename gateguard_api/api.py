# ~/GateGuard/gateguard_api/api.py
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from gateguard_api.ai_manager import score_url

router = APIRouter()


class ScoreRequest(BaseModel):
    request_id: Optional[str] = Field(default=None)
    log_id: Optional[int] = Field(default=None)
    host: str
    path: str = "/"


class ScoreResponse(BaseModel):
    score: float
    label: str
    model_version: str


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.post("/v1/score", response_model=ScoreResponse)
def score_endpoint(payload: ScoreRequest) -> ScoreResponse:
    try:
        result = score_url(
            request_id=payload.request_id,
            log_id=payload.log_id,
            host=payload.host,
            path=payload.path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI scoring failed: {exc}") from exc

    return ScoreResponse(
        score=result["score"],
        label=result["label"],
        model_version=result["model_version"],
    )
