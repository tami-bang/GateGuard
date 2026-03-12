from __future__ import annotations

import re
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack

from gateguard_api.ai_loader import (
    get_loaded_label_encoder,
    get_loaded_meta,
    get_loaded_model,
    get_loaded_vectorizer,
)

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

IPV4_PATTERN = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
HEX_LIKE_PATTERN = re.compile(r"[a-f0-9]{12,}")


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


def build_url(host: str, path: str) -> str:
    host_norm = safe_lower(host)
    path_norm = str(path or "").strip()

    if not path_norm:
        path_norm = "/"

    if not path_norm.startswith("/"):
        path_norm = "/" + path_norm

    return normalize_url(f"{host_norm}{path_norm}")


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


def build_feature_row(host: str, path: str) -> Dict[str, Any]:
    url = build_url(host, path)
    split = split_url(url)

    host_value = split["host"]
    path_value = split["path"]
    query_value = split["query"]
    full_text = f"{host_value}{path_value}?{query_value}"
    tld = extract_tld(host_value)

    host_suspicious_hits = keyword_hit_count(host_value, SUSPICIOUS_KEYWORDS)
    path_suspicious_hits = keyword_hit_count(path_value, SUSPICIOUS_KEYWORDS)
    query_suspicious_hits = keyword_hit_count(query_value, QUERY_SUSPICIOUS_KEYWORDS)
    brand_hits = keyword_hit_count(host_value, BRAND_KEYWORDS) + keyword_hit_count(path_value, BRAND_KEYWORDS)

    has_brand = int(brand_hits > 0)
    has_suspicious = int(
        host_suspicious_hits + path_suspicious_hits + query_suspicious_hits > 0
    )
    brand_suspicious_combo = int(has_brand and has_suspicious)

    return {
        "url": url,
        "url_length": len(url),
        "host_length": len(host_value),
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
        "host_suspicious_keyword_hits": host_suspicious_hits,
        "path_suspicious_keyword_hits": path_suspicious_hits,
        "query_suspicious_keyword_hits": query_suspicious_hits,
        "brand_keyword_hits": brand_hits,
        "has_brand_keyword": has_brand,
        "brand_suspicious_combo": brand_suspicious_combo,
        "has_suspicious_extension": has_suspicious_extension(path_value),
        "has_query": int(bool(query_value)),
        "is_ipv4_host": is_ipv4_host(host_value),
        "subdomain_count": subdomain_count(host_value),
        "host_dot_count": count_char(host_value, "."),
        "host_hyphen_count": count_char(host_value, "-"),
        "path_hyphen_count": count_char(path_value, "-"),
        "query_param_count": query_param_count(query_value),
        "tld_length": len(tld),
        "is_suspicious_tld": int(tld in SUSPICIOUS_TLDS),
        "has_long_host": int(len(host_value) >= 25),
        "has_many_subdomains": int(subdomain_count(host_value) >= 2),
        "has_at_symbol": int("@" in url),
        "double_slash_in_path": int("//" in path_value),
        "contains_hex_like_token": contains_hex_like_token(full_text),
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
    vectorizer = get_loaded_vectorizer()
    label_encoder = get_loaded_label_encoder()
    meta = get_loaded_meta()

    if not hasattr(model, "predict_proba"):
        raise RuntimeError("Loaded model does not support predict_proba")

    if vectorizer is None:
        raise RuntimeError("Loaded vectorizer is missing")

    if label_encoder is None:
        raise RuntimeError("Loaded label encoder is missing")

    feature_mode = meta.get("feature_mode")
    if feature_mode != "tfidf_plus_numeric":
        raise RuntimeError(f"Unsupported feature_mode: {feature_mode}")

    numeric_feature_columns = meta.get("numeric_feature_columns", [])
    if not numeric_feature_columns:
        raise RuntimeError("numeric_feature_columns missing in meta.json")

    df = build_feature_dataframe(host, path)

    text_series = df["url"].astype(str)
    numeric_df = df[numeric_feature_columns].astype(float)

    x_text = vectorizer.transform(text_series)
    x_numeric = csr_matrix(numeric_df.values)
    x_combined = hstack([x_text, x_numeric])

    probabilities = model.predict_proba(x_combined)[0]
    pred_index = int(np.argmax(probabilities))
    label = str(label_encoder.inverse_transform([pred_index])[0])

    classes = [str(c) for c in label_encoder.classes_]
    if "benign" not in classes:
        raise RuntimeError("label_encoder.classes_ does not contain 'benign'")

    benign_index = classes.index("benign")
    benign_probability = float(probabilities[benign_index])

    score = 1.0 - benign_probability

    return {
        "score": score,
        "label": label,
        "model_version": meta.get("model_version", "unknown"),
    }
