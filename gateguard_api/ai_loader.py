# ~/GateGuard/gateguard_api/ai_loader.py
from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

import joblib


MODEL_STATE: Dict[str, Any] = {
    "model": None,
    "vectorizer": None,
    "label_encoder": None,
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
    vectorizer_path = os.path.join(target_dir, "vectorizer.pkl")
    label_encoder_path = os.path.join(target_dir, "label_encoder.pkl")
    meta_path = os.path.join(target_dir, "meta.json")

    required_files = [
        model_path,
        vectorizer_path,
        label_encoder_path,
        meta_path,
    ]

    for path in required_files:
        if not os.path.exists(path):
            raise FileNotFoundError(f"artifact not found: {path}")

    model = joblib.load(model_path)
    vectorizer = joblib.load(vectorizer_path)
    label_encoder = joblib.load(label_encoder_path)

    with open(meta_path, "r", encoding="utf-8") as fp:
        meta = json.load(fp)

    MODEL_STATE["model"] = model
    MODEL_STATE["vectorizer"] = vectorizer
    MODEL_STATE["label_encoder"] = label_encoder
    MODEL_STATE["meta"] = meta


def load_artifacts_on_startup() -> None:
    load_model()


def get_loaded_model() -> Any:
    model = MODEL_STATE.get("model")
    if model is None:
        raise RuntimeError("AI model is not loaded")
    return model


def get_loaded_vectorizer() -> Any:
    vectorizer = MODEL_STATE.get("vectorizer")
    if vectorizer is None:
        raise RuntimeError("AI vectorizer is not loaded")
    return vectorizer


def get_loaded_label_encoder() -> Any:
    label_encoder = MODEL_STATE.get("label_encoder")
    if label_encoder is None:
        raise RuntimeError("AI label encoder is not loaded")
    return label_encoder


def get_loaded_meta() -> Dict[str, Any]:
    meta = MODEL_STATE.get("meta")
    if meta is None:
        raise RuntimeError("AI meta is not loaded")
    return meta


def get_model_version() -> str:
    meta = get_loaded_meta()
    return str(meta.get("model_version", "unknown"))
