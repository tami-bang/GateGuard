# ~/GateGuard/gateguard_api/ai_function.py
from __future__ import annotations

import re
from typing import Any, Dict, List
from urllib.parse import urlparse

import pandas as pd

from gateguard_api.ai_loader import get_loaded_meta, get_loaded_model

SUSPICIOUS_KEYWORDS = [
    "login",
    "admin",
    "signin",
    "verify",
    "update",
    "payment",
    "secure",
    "account",
    "token",
    "reset",
    "confirm",
    "bank",
    "wallet",
    "free",
    "bonus",
    "download",
    "exe",
    "apk",
]

SUSPICIOUS_EXTENSIONS = [
    ".exe",
    ".apk",
    ".zip",
    ".rar",
    ".scr",
    ".bat",
    ".js",
]

IPV4_PATTERN = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")


def safe_lower(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def normalize_url(host: str, path: str) -> str:
    host_norm = safe_lower(host)
    path_norm = str(path or "").strip()

    if not path_norm.startswith("/"):
        path_norm = "/" + path_norm

    return f"http://{host_norm}{path_norm}"


def split_url(url: str) -> Dict[str, str]:
    parsed = urlparse(url)
    return {
        "scheme": parsed.scheme or "",
        "netloc": parsed.netloc or "",
        "path": parsed.path or "",
        "query": parsed.query or "",
    }


def count_digits(text: str) -> int:
    return sum(1 for ch in text if ch.isdigit())


def count_special_chars(text: str) -> int:
    return sum(1 for ch in text if not ch.isalnum())


def keyword_hit_count(text: str, keywords: List[str]) -> int:
    text_lower = safe_lower(text)
    return sum(1 for kw in keywords if kw in text_lower)


def has_suspicious_extension(path: str) -> int:
    path_lower = safe_lower(path)
    return int(any(path_lower.endswith(ext) for ext in SUSPICIOUS_EXTENSIONS))


def is_ipv4_host(host: str) -> int:
    return int(bool(IPV4_PATTERN.match(safe_lower(host))))


def subdomain_count(host: str) -> int:
    host_norm = safe_lower(host)
    if not host_norm:
        return 0
    parts = [p for p in host_norm.split(".") if p]
    return max(len(parts) - 2, 0)


def build_feature_row(host: str, path: str) -> Dict[str, Any]:
    host_norm = safe_lower(host)
    path_raw = str(path or "").strip()
    url = normalize_url(host_norm, path_raw)
    split = split_url(url)

    path_value = split["path"]
    query_value = split["query"]
    full_text = f"{host_norm}{path_raw}"

    return {
        "url_length": len(url),
        "host_length": len(host_norm),
        "path_length": len(path_value),
        "query_length": len(query_value),
        "slash_count": url.count("/"),
        "dot_count": url.count("."),
        "hyphen_count": url.count("-"),
        "underscore_count": url.count("_"),
        "question_mark_count": url.count("?"),
        "ampersand_count": url.count("&"),
        "equal_count": url.count("="),
        "digit_count": count_digits(url),
        "special_char_count": count_special_chars(url),
        "suspicious_keyword_hits": keyword_hit_count(full_text, SUSPICIOUS_KEYWORDS),
        "has_suspicious_extension": has_suspicious_extension(path_value),
        "has_query": int(bool(query_value)),
        "is_ipv4_host": is_ipv4_host(host_norm),
        "subdomain_count": subdomain_count(host_norm),
    }


def build_feature_dataframe(host: str, path: str) -> pd.DataFrame:
    row = build_feature_row(host, path)
    df = pd.DataFrame([row])

    meta = get_loaded_meta()
    feature_columns = meta.get("feature_columns", [])

    if not feature_columns:
        raise RuntimeError("feature_columns missing in meta.json")

    missing_columns = [col for col in feature_columns if col not in df.columns]
    if missing_columns:
        raise RuntimeError(f"Missing feature columns: {missing_columns}")

    return df[feature_columns]


def predict_score(host: str, path: str) -> Dict[str, Any]:
    model = get_loaded_model()
    df = build_feature_dataframe(host, path)

    if not hasattr(model, "predict_proba"):
        raise RuntimeError("Loaded model does not support predict_proba")

    score = float(model.predict_proba(df)[0][1])
    label = "malicious" if score >= 0.5 else "benign"

    return {
        "score": score,
        "label": label,
    }
