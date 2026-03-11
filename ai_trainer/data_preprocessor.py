from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List
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

VALID_LABELS = {"benign", "phishing", "malware"}
IPV4_PATTERN = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")


@dataclass
class PreparedDataset:
    dataframe: pd.DataFrame
    feature_columns: List[str]
    labels: pd.Series
    urls: pd.Series


def safe_lower(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def normalize_url(url: str) -> str:
    url_norm = safe_lower(url)
    if not url_norm:
        return ""

    if not url_norm.startswith(("http://", "https://")):
        url_norm = "http://" + url_norm

    return url_norm

def split_url(url: str) -> Dict[str, str]:
    try:
        parsed = urlparse(url)
        host = parsed.netloc or ""
        path = parsed.path or ""
        query = parsed.query or ""

        return {
            "scheme": parsed.scheme or "",
            "host": host,
            "path": path,
            "query": query,
        }
    except Exception:
        return {
            "scheme": "",
            "host": "",
            "path": "",
            "query": "",
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

def build_feature_row(url: str, label: str) -> Dict[str, Any] | None:
    try:
        normalized_url = normalize_url(url)
        split = split_url(normalized_url)

        host = split["host"]
        path = split["path"]
        query = split["query"]
        full_text = f"{host}{path}?{query}"

        return {
            "url": normalized_url,
            "url_length": len(normalized_url),
            "host_length": len(host),
            "path_length": len(path),
            "query_length": len(query),
            "slash_count": normalized_url.count("/"),
            "dot_count": normalized_url.count("."),
            "hyphen_count": normalized_url.count("-"),
            "underscore_count": normalized_url.count("_"),
            "question_mark_count": normalized_url.count("?"),
            "ampersand_count": normalized_url.count("&"),
            "equal_count": normalized_url.count("="),
            "digit_count": count_digits(normalized_url),
            "special_char_count": count_special_chars(normalized_url),
            "suspicious_keyword_hits": keyword_hit_count(full_text, SUSPICIOUS_KEYWORDS),
            "has_suspicious_extension": has_suspicious_extension(path),
            "has_query": int(bool(query)),
            "is_ipv4_host": is_ipv4_host(host),
            "subdomain_count": subdomain_count(host),
            "label": safe_lower(label),
        }
    except Exception:
        return None


def load_and_merge_csv_files(csv_paths: List[str]) -> pd.DataFrame:
    frames: List[pd.DataFrame] = []

    for path in csv_paths:
        df = pd.read_csv(path)
        if "url" not in df.columns or "label" not in df.columns:
            raise ValueError(f"{path} must contain 'url' and 'label' columns")
        frames.append(df[["url", "label"]].copy())

    if not frames:
        raise ValueError("No CSV files were provided")

    merged = pd.concat(frames, ignore_index=True)
    return merged


def clean_dataset(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    df["url"] = df["url"].map(safe_lower)
    df["label"] = df["label"].map(safe_lower)

    df = df[(df["url"] != "") & (df["label"] != "")]
    df = df[df["label"].isin(VALID_LABELS)]

    df["url"] = df["url"].map(normalize_url)

    df = df.drop_duplicates(subset=["url", "label"]).reset_index(drop=True)
    return df

def build_feature_dataframe_from_df(df: pd.DataFrame) -> PreparedDataset:
    if df.empty:
        raise ValueError("No rows available for preprocessing")

    feature_rows = []
    skipped_count = 0

    for _, row in df.iterrows():
        item = build_feature_row(row["url"], row["label"])
        if item is None:
            skipped_count += 1
            continue
        feature_rows.append(item)

    if not feature_rows:
        raise ValueError("No valid rows available after feature extraction")

    feature_df = pd.DataFrame(feature_rows)

    labels = feature_df["label"].copy()
    urls = feature_df["url"].copy()

    x_df = feature_df.drop(columns=["label"])

    print(f"[AI_Trainer] skipped malformed url rows: {skipped_count}")

    return PreparedDataset(
        dataframe=x_df,
        feature_columns=list(x_df.columns),
        labels=labels,
        urls=urls,
    )

def preprocess_csv_files(csv_paths: List[str]) -> PreparedDataset:
    merged = load_and_merge_csv_files(csv_paths)
    cleaned = clean_dataset(merged)
    return build_feature_dataframe_from_df(cleaned)


def save_processed_dataset(df: pd.DataFrame, output_path: str) -> None:
    df.to_csv(output_path, index=False)
