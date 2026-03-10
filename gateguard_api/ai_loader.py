# ~/GateGuard/gateguard_api/ai_loader.py
from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

import joblib


MODEL_STATE: Dict[str, Any] = {
    "model": None,
    "meta": None,
}


def get_model_dir() -> str:
    return os.getenv(
        "MODEL_DIR",
        "/home/ktech/GateGuard/ai_trainer/artifacts/latest",
    )


def load_model(model_dir: Optional[str] = None) -> None:
    target_dir = model_dir or get_model_dir()

    model_path = os.path.join(target_dir, "model.pkl")
    meta_path = os.path.join(target_dir, "meta.json")

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"model.pkl not found: {model_path}")

    if not os.path.exists(meta_path):
        raise FileNotFoundError(f"meta.json not found: {meta_path}")

    model = joblib.load(model_path)
    with open(meta_path, "r", encoding="utf-8") as fp:
        meta = json.load(fp)

    MODEL_STATE["model"] = model
    MODEL_STATE["meta"] = meta


def load_artifacts_on_startup() -> None:
    load_model()


def get_loaded_model() -> Any:
    model = MODEL_STATE.get("model")
    if model is None:
        raise RuntimeError("AI model is not loaded")
    return model


def get_loaded_meta() -> Dict[str, Any]:
    meta = MODEL_STATE.get("meta")
    if meta is None:
        raise RuntimeError("AI meta is not loaded")
    return meta


def get_model_version() -> str:
    meta = get_loaded_meta()
    return str(meta.get("model_version", "unknown"))
