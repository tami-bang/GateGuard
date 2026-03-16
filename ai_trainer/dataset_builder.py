from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import pandas as pd

TRUSTED_PLATFORM_HOSTS = {
    "docs.google.com",
    "sites.google.com",
    "script.google.com",
}

RAW_DIR = Path("data/raw")
PROCESSED_DIR = Path("data/processed")
CUSTOM_BENIGN_HARD_MULTIPLIER = 20


def safe_lower(value) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def canonicalize_url(value: str) -> str:
    text = safe_lower(value)
    if not text:
        return ""

    if not text.startswith(("http://", "https://")):
        text = "http://" + text

    try:
        parsed = urlparse(text)
    except Exception:
        return ""

    host = safe_lower(parsed.netloc)
    path = parsed.path or "/"

    if not host:
        return ""

    if ":" in host:
        host = host.split(":", 1)[0]

    if not path.startswith("/"):
        path = "/" + path

    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    return f"{host}{path}"


def extract_host_from_canonical_url(value: str) -> str:
    text = safe_lower(value)
    if not text:
        return ""
    return text.split("/", 1)[0]


def drop_trusted_platform_malicious(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["host"] = out["canonical_url"].map(extract_host_from_canonical_url)

    mask = (
        (out["label"] == "malicious")
        & (out["host"].isin(TRUSTED_PLATFORM_HOSTS))
    )

    removed = int(mask.sum())
    print("trusted platform malicious rows removed:", removed)

    out = out[~mask].copy()
    out = out.drop(columns=["host"])
    return out


def load_tranco(limit: int = 100000) -> pd.DataFrame:
    print("loading tranco...")
    df = pd.read_csv(RAW_DIR / "tranco.csv", names=["rank", "domain"])
    df["url"] = df["domain"]
    df["label"] = "benign"
    df["source"] = "tranco"
    return df[["url", "label", "source"]].head(limit)


def load_phishtank() -> pd.DataFrame:
    print("loading phishtank...")
    df = pd.read_csv(RAW_DIR / "verified_online.csv")
    df = df[["url"]].copy()
    df["label"] = "malicious"
    df["source"] = "phishtank"
    return df


def load_urlhaus() -> pd.DataFrame:
    print("loading urlhaus...")
    df = pd.read_csv(
        RAW_DIR / "urlhaus.csv",
        comment="#",
        header=None,
        names=[
            "id",
            "dateadded",
            "url",
            "url_status",
            "last_online",
            "threat",
            "tags",
            "urlhaus_link",
            "reporter",
        ],
    )
    df = df[["url"]].copy()
    df["label"] = "malicious"
    df["source"] = "urlhaus"
    return df


def load_custom_benign_hard() -> pd.DataFrame:
    print("loading custom benign hard samples...")
    df = pd.read_csv(RAW_DIR / "gateguard_custom_benign_hard.csv")
    df = df[["url", "label"]].copy()
    df["source"] = "custom_benign_hard"
    return df


def standardize_dataset(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    out["url"] = out["url"].map(safe_lower)
    out["label"] = out["label"].map(safe_lower)
    out["source"] = out["source"].map(safe_lower)

    out = out[(out["url"] != "") & (out["label"] != "")]
    out["canonical_url"] = out["url"].map(canonicalize_url)
    out = out[out["canonical_url"] != ""].copy()

    return out


def drop_conflicts(df: pd.DataFrame) -> pd.DataFrame:
    label_counts = (
        df.groupby("canonical_url")["label"]
        .nunique()
        .reset_index(name="label_count")
    )
    conflicts = label_counts[label_counts["label_count"] > 1]["canonical_url"]

    conflict_count = len(conflicts)
    print("conflicting canonical urls:", conflict_count)

    if conflict_count > 0:
        df = df[~df["canonical_url"].isin(conflicts)].copy()

    return df


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    tranco = load_tranco(limit=100000)
    phishtank = load_phishtank()
    urlhaus = load_urlhaus()
    custom_benign_hard = load_custom_benign_hard()

    # 1) public + custom 원본 병합
    print("merging base dataset...")
    base_dataset = pd.concat(
        [tranco, phishtank, urlhaus, custom_benign_hard],
        ignore_index=True,
    )

    # 2) standardize / conflict 제거 / trusted platform 제거
    base_dataset = standardize_dataset(base_dataset)
    base_dataset = drop_conflicts(base_dataset)
    base_dataset = drop_trusted_platform_malicious(base_dataset)

    # 3) base dataset는 canonical 기준 dedup 유지
    base_dataset = base_dataset.drop_duplicates(subset=["canonical_url"]).reset_index(drop=True)

    # 4) custom hard benign는 따로 standardize + dedup
    hard_benign = standardize_dataset(custom_benign_hard)
    hard_benign = hard_benign.drop_duplicates(subset=["canonical_url"]).reset_index(drop=True)

    # 5) hard benign를 dedup 이후에 반복 증강
    hard_benign_boosted = pd.concat(
        [hard_benign] * CUSTOM_BENIGN_HARD_MULTIPLIER,
        ignore_index=True,
    )

    print("custom benign hard unique rows:", len(hard_benign))
    print("custom benign hard multiplier:", CUSTOM_BENIGN_HARD_MULTIPLIER)
    print("custom benign hard boosted rows:", len(hard_benign_boosted))

    # 6) 최종 학습셋 = dedup된 base + boosted hard benign
    final_dataset = pd.concat(
        [base_dataset, hard_benign_boosted],
        ignore_index=True,
    )

    final_df = final_dataset[["canonical_url", "label", "source"]].rename(
        columns={"canonical_url": "url"}
    )

    output_path = PROCESSED_DIR / "gateguard_dataset_v4.csv"
    final_df.to_csv(output_path, index=False)

    print("dataset created")
    print("output:", output_path)
    print("total samples:", len(final_df))
    print("label distribution:")
    print(final_df["label"].value_counts())
    print("source distribution:")
    print(final_df["source"].value_counts())


if __name__ == "__main__":
    main()
