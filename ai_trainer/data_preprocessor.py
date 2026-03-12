from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

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

BRAND_KEYWORDS = [
    "paypal",
    "google",
    "apple",
    "microsoft",
    "naver",
    "kakao",
    "facebook",
    "instagram",
    "amazon",
    "netflix",
    "telegram",
    "whatsapp",
    "bank",
    "woori",
    "kb",
    "shinhan",
    "hana",
    "nh",
]

QUERY_SUSPICIOUS_KEYWORDS = [
    "redirect",
    "return",
    "continue",
    "next",
    "target",
    "session",
    "token",
    "auth",
    "key",
    "login",
    "verify",
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

SUSPICIOUS_TLDS = {
    "xyz",
    "top",
    "click",
    "work",
    "shop",
    "info",
    "support",
    "live",
    "buzz",
}

VALID_LABELS = {"benign", "phishing", "malware"}
IPV4_PATTERN = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
HEX_LIKE_PATTERN = re.compile(r"[a-f0-9]{12,}")


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


def count_char(text: str, ch: str) -> int:
    return safe_lower(text).count(ch)


def keyword_hit_count(text: str, keywords: List[str]) -> int:
    text_lower = safe_lower(text)
    return sum(1 for kw in keywords if kw in text_lower)


def contains_any_keyword(text: str, keywords: List[str]) -> int:
    text_lower = safe_lower(text)
    return int(any(kw in text_lower for kw in keywords))


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


def extract_tld(host: str) -> str:
    host_norm = safe_lower(host)
    parts = [p for p in host_norm.split(".") if p]
    if len(parts) < 2:
        return ""
    return parts[-1]


def query_param_count(query: str) -> int:
    if not query:
        return 0
    try:
        return len(parse_qs(query, keep_blank_values=True))
    except Exception:
        return 0


def contains_hex_like_token(text: str) -> int:
    return int(bool(HEX_LIKE_PATTERN.search(safe_lower(text))))


def build_feature_row(url: str, label: str) -> Dict[str, Any] | None:
    try:
        normalized_url = normalize_url(url)
        split = split_url(normalized_url)

        host = split["host"]
        path = split["path"]
        query = split["query"]
        full_text = f"{host}{path}?{query}"
        tld = extract_tld(host)

        host_suspicious_hits = keyword_hit_count(host, SUSPICIOUS_KEYWORDS)
        path_suspicious_hits = keyword_hit_count(path, SUSPICIOUS_KEYWORDS)
        query_suspicious_hits = keyword_hit_count(query, QUERY_SUSPICIOUS_KEYWORDS)
        brand_hits = keyword_hit_count(host, BRAND_KEYWORDS) + keyword_hit_count(path, BRAND_KEYWORDS)

        has_brand = int(brand_hits > 0)
        has_suspicious = int(
            host_suspicious_hits + path_suspicious_hits + query_suspicious_hits > 0
        )

        brand_suspicious_combo = int(has_brand and has_suspicious)

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
            "host_suspicious_keyword_hits": host_suspicious_hits,
            "path_suspicious_keyword_hits": path_suspicious_hits,
            "query_suspicious_keyword_hits": query_suspicious_hits,
            "brand_keyword_hits": brand_hits,
            "has_brand_keyword": has_brand,
            "brand_suspicious_combo": brand_suspicious_combo,
            "has_suspicious_extension": has_suspicious_extension(path),
            "has_query": int(bool(query)),
            "is_ipv4_host": is_ipv4_host(host),
            "subdomain_count": subdomain_count(host),
            "host_dot_count": count_char(host, "."),
            "host_hyphen_count": count_char(host, "-"),
            "path_hyphen_count": count_char(path, "-"),
            "query_param_count": query_param_count(query),
            "tld_length": len(tld),
            "is_suspicious_tld": int(tld in SUSPICIOUS_TLDS),
            "has_long_host": int(len(host) >= 25),
            "has_many_subdomains": int(subdomain_count(host) >= 2),
            "has_at_symbol": int("@" in normalized_url),
            "double_slash_in_path": int("//" in path),
            "contains_hex_like_token": contains_hex_like_token(full_text),
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
