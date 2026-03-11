from __future__ import annotations

import os
import re
import pandas as pd

INPUT_PATH = "/home/ktech/GateGuard/ai_trainer/data/raw/malicious_phish.csv"
OUTPUT_PATH = "/home/ktech/GateGuard/ai_trainer/data/raw/gateguard_dataset.csv"

LABEL_MAP = {
    "benign": "benign",
    "phishing": "phishing",
    "malware": "malware",
}

MAX_PER_LABEL = 20000


def clean_url(value: str) -> str:
    url = str(value).strip().lower()

    url = url.strip('"').strip("'").strip()
    url = url.replace("\\", "")
    url = re.sub(r"\s+", "", url)

    return url


def main() -> None:
    if not os.path.exists(INPUT_PATH):
        raise FileNotFoundError(f"input file not found: {INPUT_PATH}")

    df = pd.read_csv(INPUT_PATH)

    if "url" not in df.columns or "type" not in df.columns:
        raise ValueError("input csv must contain 'url' and 'type' columns")

    df = df[["url", "type"]].copy()
    df["url"] = df["url"].map(clean_url)
    df["type"] = df["type"].astype(str).str.strip().str.lower()

    df = df[df["type"].isin(LABEL_MAP.keys())].copy()
    df["label"] = df["type"].map(LABEL_MAP)

    df = df[df["url"] != ""].copy()
    df = df[df["url"].str.len() >= 8].copy()

    df = df.drop_duplicates(subset=["url", "label"]).reset_index(drop=True)

    sampled_frames = []
    for label in ["benign", "phishing", "malware"]:
        label_df = df[df["label"] == label].copy()
        take_n = min(MAX_PER_LABEL, len(label_df))
        sampled_frames.append(label_df.sample(n=take_n, random_state=42))

    result = pd.concat(sampled_frames, ignore_index=True)
    result = result[["url", "label"]].sample(frac=1.0, random_state=42).reset_index(drop=True)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    result.to_csv(OUTPUT_PATH, index=False)

    print("saved:", OUTPUT_PATH)
    print(result["label"].value_counts())


if __name__ == "__main__":
    main()
