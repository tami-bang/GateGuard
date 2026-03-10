# ~/GateGuard/ai_trainer/data_preprocessor.py
"""
학습용 전처리 및 feature 생성

중요 원칙
- FastAPI ai_function / ai_manager 와 동일 규칙 사용
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse

import pandas as pd


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


@dataclass
class PreparedDataset:
    dataframe: pd.DataFrame
    feature_columns: List[str]
    labels: pd.Series


def safe_lower(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def normalize_url(host: str, path: str) -> str:
    """
    host/path 기반으로 표준 URL 문자열 생성
    """
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


def build_feature_row(row: Dict[str, Any]) -> Dict[str, Any]:
    host = safe_lower(row.get("host"))
    path = str(row.get("path") or "").strip()
    url = normalize_url(host, path)
    split = split_url(url)

    full_text = f"{host}{path}"

    path_value = split["path"]
    query_value = split["query"]

    feature_row = {
        "url_length": len(url),
        "host_length": len(host),
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
        "is_ipv4_host": is_ipv4_host(host),
        "subdomain_count": subdomain_count(host),
        "label": int(row.get("label", 0)),
    }

    return feature_row


def build_feature_dataframe(rows: List[Dict[str, Any]]) -> PreparedDataset:
    if not rows:
        raise ValueError("No rows available for preprocessing")

    feature_rows = [build_feature_row(row) for row in rows]
    df = pd.DataFrame(feature_rows)

    if "label" not in df.columns:
        raise ValueError("label column is missing")

    labels = df["label"].astype(int)
    feature_df = df.drop(columns=["label"])

    return PreparedDataset(
        dataframe=feature_df,
        feature_columns=list(feature_df.columns),
        labels=labels,
    )
