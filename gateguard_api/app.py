from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from gateguard_api.api import router
from gateguard_api.ai_loader import load_artifacts_on_startup


def parse_cors_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ORIGINS",
        "http://192.168.1.24:8080,http://127.0.0.1:8080,http://localhost:8080",
    )
    return [item.strip() for item in raw.split(",") if item.strip()]


def create_app() -> FastAPI:
    app = FastAPI(
        title="GateGuard AI Scoring API",
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=parse_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def startup_event() -> None:
        load_artifacts_on_startup()

    app.include_router(router)
    return app


app = create_app()
