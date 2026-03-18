#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import pandas as pd

BASE_DIR = Path("/home/ktech/GateGuard/ai_trainer")
RAW_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DIR = BASE_DIR / "data" / "processed"

OUT_RAW = PROCESSED_DIR / "dataset_v14_raw.csv"
OUT_TRAIN = PROCESSED_DIR / "dataset_v14_for_training.csv"

TRUSTED_BENIGN_FILES = [
    RAW_DIR / "gateguard_custom_benign_hard.csv",
    RAW_DIR / "gateguard_custom_urls.csv",
    RAW_DIR / "real_benign_anchor.csv",
]

TRUSTED_MALICIOUS_FILES = [
    RAW_DIR / "ops_candidates_train_from_review.csv",
    RAW_DIR / "generated_korean_malicious.csv",
    RAW_DIR / "generated_advanced_malicious.csv",
]

OPTIONAL_FILES = {
    "verified_online": RAW_DIR / "verified_online.csv",
    "urlhaus": RAW_DIR / "urlhaus.csv",
    "malicious_phish": RAW_DIR / "malicious_phish.csv",
    "tranco": RAW_DIR / "tranco.csv",
}

VALID_LABELS = {"benign", "malicious", "phishing"}

PRIVATE_HOST_PREFIXES = (
    "127.",
    "10.",
    "192.168.",
    "172.16.",
    "172.17.",
    "172.18.",
    "172.19.",
    "172.20.",
    "172.21.",
    "172.22.",
    "172.23.",
    "172.24.",
    "172.25.",
    "172.26.",
    "172.27.",
    "172.28.",
    "172.29.",
    "172.30.",
    "172.31.",
)

EXCLUDED_HOST_EXACT = {
    "",
    "localhost",
    "0.0.0.0",
}

EXCLUDED_PATH_KEYWORDS = (
    "/admin",
    "/dashboard",
    "/api/",
    "/health",
    "/metrics",
    "/status",
)

EXCLUDED_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".gif", ".svg",
    ".css", ".js", ".ico", ".woff", ".woff2",
    ".ttf", ".map", ".pdf", ".zip",
)

MAX_TRANCO_ROWS = 60000
MAX_MALICIOUS_PHISH_ROWS = 40000
MAX_URLHAUS_ROWS = 30000
MAX_VERIFIED_ONLINE_ROWS = 30000


def clean_url_text(raw: str) -> str:
    s = str(raw).strip()
    if not s:
        return ""
    if s.startswith(("http://", "https://")):
        return s
    return "http://" + s


def split_url_to_host_path(raw: str) -> tuple[str, str] | None:
    s = clean_url_text(raw)
    if not s:
        return None

    try:
        p = urlparse(s)
    except Exception:
        return None

    host = (p.hostname or "").strip().lower()
    path = (p.path or "/").strip()

    if not host:
        return None

    if path == "":
        path = "/"

    return host, path


def is_private_host(host: str) -> bool:
    if host in EXCLUDED_HOST_EXACT:
        return True
    return any(host.startswith(prefix) for prefix in PRIVATE_HOST_PREFIXES)


def is_excluded_path(path: str) -> bool:
    lower_path = path.lower()
    if any(keyword in lower_path for keyword in EXCLUDED_PATH_KEYWORDS):
        return True
    if lower_path.endswith(EXCLUDED_EXTENSIONS):
        return True
    return False


def normalize_label(label: str) -> str:
    v = str(label).strip().lower()
    if v == "phishing":
        return "malicious"
    return v


def normalize_url_label_df(df: pd.DataFrame, url_col: str, label_col: str) -> pd.DataFrame:
    out = df[[url_col, label_col]].copy()
    out.columns = ["url", "label"]

    out["url"] = out["url"].fillna("").astype(str).str.strip()
    out["label"] = out["label"].fillna("").astype(str).map(normalize_label)

    out = out[out["label"].isin({"benign", "malicious"})].copy()

    parsed = out["url"].map(split_url_to_host_path)
    out = out[parsed.notna()].copy()
    out["host"] = parsed[parsed.notna()].map(lambda x: x[0])
    out["path"] = parsed[parsed.notna()].map(lambda x: x[1])

    return out[["host", "path", "label"]].copy()


def normalize_host_path_label_df(df: pd.DataFrame, host_col: str, path_col: str, label_col: str) -> pd.DataFrame:
    out = df[[host_col, path_col, label_col]].copy()
    out.columns = ["host", "path", "label"]

    out["host"] = out["host"].fillna("").astype(str).str.strip().str.lower()
    out["path"] = out["path"].fillna("/").astype(str).str.strip()
    out["label"] = out["label"].fillna("").astype(str).map(normalize_label)

    out.loc[out["path"] == "", "path"] = "/"
    out = out[out["label"].isin({"benign", "malicious"})].copy()

    return out[["host", "path", "label"]].copy()


def load_trusted_url_label_file(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    return normalize_url_label_df(df, "url", "label")


def load_trusted_host_path_label_file(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    return normalize_host_path_label_df(df, "host", "path", "label")


def load_verified_online(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df = df[df["verified"].astype(str).str.lower() == "yes"].copy()
    df = df[df["online"].astype(str).str.lower() == "yes"].copy()
    df = df.head(MAX_VERIFIED_ONLINE_ROWS).copy()
    df["label"] = "malicious"
    return normalize_url_label_df(df, "url", "label")


def load_malicious_phish(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["type"] = df["type"].fillna("").astype(str).str.lower()
    df = df[df["type"] == "phishing"].copy()
    df = df.head(MAX_MALICIOUS_PHISH_ROWS).copy()
    df["label"] = "malicious"
    return normalize_url_label_df(df, "url", "label")


def load_tranco(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, header=None, names=["rank", "domain"])
    df = df.head(MAX_TRANCO_ROWS).copy()
    df["url"] = df["domain"].fillna("").astype(str).str.strip() + "/"
    df["label"] = "benign"
    return normalize_url_label_df(df, "url", "label")


def load_urlhaus(path: Path) -> pd.DataFrame:
    rows = []
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            rows.append(s)

    if not rows:
        return pd.DataFrame(columns=["host", "path", "label"])

    tmp_path = PROCESSED_DIR / "_urlhaus_tmp.csv"
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path.write_text("\n".join(rows), encoding="utf-8")

    df = pd.read_csv(tmp_path, header=None)
    tmp_path.unlink(missing_ok=True)

    url_col = None
    for idx in range(df.shape[1]):
        sample = df.iloc[:20, idx].astype(str).tolist()
        if any("http://" in x or "https://" in x for x in sample):
            url_col = idx
            break

    if url_col is None:
        raise ValueError("urlhaus.csv: URL column not found")

    out = pd.DataFrame({
        "url": df.iloc[:, url_col].astype(str),
        "label": "malicious",
    })

    out = out.head(MAX_URLHAUS_ROWS).copy()
    return normalize_url_label_df(out, "url", "label")


def apply_common_filters(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    df["host"] = df["host"].fillna("").astype(str).str.strip().str.lower()
    df["path"] = df["path"].fillna("/").astype(str).str.strip()
    df["label"] = df["label"].fillna("").astype(str).str.strip().str.lower()

    df.loc[df["path"] == "", "path"] = "/"

    df = df[df["host"] != ""].copy()
    df = df[~df["host"].map(is_private_host)].copy()
    df = df[~df["path"].map(is_excluded_path)].copy()
    df = df[df["label"].isin({"benign", "malicious"})].copy()

    return df


def dedupe_with_conflict_drop(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    grouped = df.groupby(["host", "path"])["label"].nunique()
    conflict_keys = grouped[grouped > 1].index
    conflict_count = len(conflict_keys)

    if conflict_count > 0:
        conflict_df = pd.DataFrame(conflict_keys.tolist(), columns=["host", "path"])
        df = df.merge(conflict_df.assign(conflict=1), on=["host", "path"], how="left")
        df = df[df["conflict"].isna()].copy()
        df = df.drop(columns=["conflict"])

    df = df.drop_duplicates(subset=["host", "path", "label"]).reset_index(drop=True)
    return df, conflict_count


def main() -> None:
    frames: list[pd.DataFrame] = []

    for path in TRUSTED_BENIGN_FILES:
        if path.exists():
            df = load_trusted_url_label_file(path)
            df["source_file"] = path.name
            frames.append(df)

    for path in TRUSTED_MALICIOUS_FILES:
        if path.exists():
            if path.name == "ops_candidates_train_from_review.csv":
                df = load_trusted_host_path_label_file(path)
            else:
                df = load_trusted_url_label_file(path)
            df["source_file"] = path.name
            frames.append(df)

    if OPTIONAL_FILES["verified_online"].exists():
        df = load_verified_online(OPTIONAL_FILES["verified_online"])
        df["source_file"] = OPTIONAL_FILES["verified_online"].name
        frames.append(df)

    if OPTIONAL_FILES["malicious_phish"].exists():
        df = load_malicious_phish(OPTIONAL_FILES["malicious_phish"])
        df["source_file"] = OPTIONAL_FILES["malicious_phish"].name
        frames.append(df)

    if OPTIONAL_FILES["tranco"].exists():
        df = load_tranco(OPTIONAL_FILES["tranco"])
        df["source_file"] = OPTIONAL_FILES["tranco"].name
        frames.append(df)

    if OPTIONAL_FILES["urlhaus"].exists():
        df = load_urlhaus(OPTIONAL_FILES["urlhaus"])
        df["source_file"] = OPTIONAL_FILES["urlhaus"].name
        frames.append(df)

    if not frames:
        raise ValueError("no usable input files found")

    merged = pd.concat(frames, ignore_index=True)
    merged = apply_common_filters(merged)

    deduped, conflict_count = dedupe_with_conflict_drop(merged)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    raw_df = deduped[["host", "path", "label"]].copy()
    raw_df.to_csv(OUT_RAW, index=False, encoding="utf-8-sig")

    train_df = raw_df.copy()
    train_df["url"] = train_df["host"] + train_df["path"]
    train_df = train_df[["url", "label"]].drop_duplicates().reset_index(drop=True)
    train_df.to_csv(OUT_TRAIN, index=False, encoding="utf-8-sig")

    print("saved raw   :", OUT_RAW)
    print("saved train :", OUT_TRAIN)
    print("raw rows    :", len(raw_df))
    print("conflicts dropped :", conflict_count)
    print(train_df["label"].value_counts())


if __name__ == "__main__":
    main()
