#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import csv
import re
import sys
import time
from dataclasses import dataclass, asdict
from typing import Iterable, List, Set
from urllib.parse import urlparse

import certifi
import requests
from bs4 import BeautifulSoup

REQUEST_TIMEOUT = 10
SLEEP_SEC = 1.0
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

HEADERS = {"User-Agent": USER_AGENT}

URL_PATTERN = re.compile(
    r"""(?ix)
    \b(
        (?:
            https?://
            |
            hxxps?://
        )?
        (?:
            [a-z0-9-]+\.
        )+
        (?:kr|com|net|org|co\.kr|or\.kr|go\.kr|info|biz|xyz|top|site|shop|cc|me|tv|pw|live|link)
        (?:
            /[^\s<>"'()]* 
        )?
    )
    """
)

CONTEXT_KEYWORDS = [
    "피싱", "사칭", "도박", "불법", "악성", "유해", "스미싱",
    "금융사기", "계정", "로그인", "인증", "보안", "verify",
    "secure", "login", "bank", "naver", "kakao", "card", "pay"
]

SAFE_CONTEXT_KEYWORDS = [
    "정상", "공식", "공식사이트", "공식 사이트", "대표 홈페이지",
    "홈페이지", "신고", "보호나라", "정부", "기관", "예방", "주의",
    "안내", "상담", "문의", "고객센터"
]

BLOCKED_HOST_SUFFIXES = {
    "google.com", "google.co.kr",
    "naver.com", "kakao.com",
    "youtube.com", "tistory.com",
    "blog.me", "daum.net",
    "wikipedia.org",
    "boho.or.kr",
    "krcert.or.kr",
    "kisa.or.kr",
    "go.kr",
    "or.kr",
    "ac.kr",
    "mil.kr",
    "police.go.kr",
    "mois.go.kr",
    "hometax.go.kr",
}

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

EXCLUDED_PATH_KEYWORDS = (
    "/admin",
    "/dashboard",
    "/api/",
    "/health",
    "/metrics",
    "/status",
)

@dataclass
class UrlRecord:
    host: str
    path: str
    label: str
    source_page: str
    keyword_hit: str
    note: str


def fetch_html(url: str) -> str:
    resp = requests.get(
        url,
        headers=HEADERS,
        timeout=REQUEST_TIMEOUT,
        verify=certifi.where(),
    )
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or resp.encoding
    return resp.text


def clean_candidate(value: str) -> str:
    value = value.strip()
    value = value.strip("()[]{}<>.,;\"'")
    value = value.replace("hxxp://", "http://").replace("hxxps://", "https://")
    if not value.startswith(("http://", "https://")):
        value = "http://" + value
    return value


def normalize_url(value: str) -> str:
    value = clean_candidate(value)
    parsed = urlparse(value)

    host = (parsed.netloc or "").lower().strip()
    path = parsed.path or "/"

    if not host:
        raise ValueError("empty host")

    if host.endswith(":80"):
        host = host[:-3]
    elif host.endswith(":443"):
        host = host[:-4]

    return f"{parsed.scheme or 'http'}://{host}{path}"


def split_host_path(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    host = parsed.netloc.lower().strip()
    path = parsed.path or "/"
    return host, path


def is_blocked_host(host: str) -> bool:
    if host in {"", "localhost", "0.0.0.0"}:
        return True

    for prefix in PRIVATE_HOST_PREFIXES:
        if host.startswith(prefix):
            return True

    for suffix in BLOCKED_HOST_SUFFIXES:
        if host == suffix or host.endswith("." + suffix):
            return True

    return False


def looks_like_safe_or_public(host: str) -> bool:
    safe_exact = {
        "boho.or.kr",
        "krcert.or.kr",
        "kisa.or.kr",
        "mois.go.kr",
        "hometax.go.kr",
        "police.go.kr",
    }

    if host in safe_exact:
        return True

    safe_suffixes = (
        ".go.kr",
        ".or.kr",
        ".ac.kr",
        ".mil.kr",
        ".gov",
        ".edu",
    )

    return host.endswith(safe_suffixes)


def extract_visible_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript"]):
        tag.extract()

    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def extract_candidates_from_text(text: str) -> List[str]:
    found = URL_PATTERN.findall(text)
    return list(dict.fromkeys(found))


def get_context_window(text: str, raw_value: str, window: int = 80) -> str:
    idx = text.lower().find(raw_value.lower())
    if idx == -1:
        return ""
    start = max(0, idx - window)
    end = min(len(text), idx + len(raw_value) + window)
    return text[start:end]


def detect_keyword_context(context_text: str, raw_value: str) -> str:
    lower_text = context_text.lower()
    lower_raw = raw_value.lower()

    hits = []
    for kw in CONTEXT_KEYWORDS:
        if kw.lower() in lower_text or kw.lower() in lower_raw:
            hits.append(kw)

    return ",".join(sorted(set(hits))) if hits else ""


def has_safe_context(context_text: str) -> bool:
    lower_text = context_text.lower()
    for kw in SAFE_CONTEXT_KEYWORDS:
        if kw.lower() in lower_text:
            return True
    return False


def is_suspicious_host(host: str) -> bool:
    suspicious_tokens = [
        "login", "verify", "secure", "account", "bank", "pay",
        "auth", "update", "support", "wallet", "card", "refund",
        "bonus", "event", "point", "customer", "service",
        "naver", "kakao", "shinhan", "woori", "kb", "nh"
    ]
    score = 0
    for token in suspicious_tokens:
        if token in host:
            score += 1
    return score >= 1


def is_excluded_path(path: str) -> bool:
    lower_path = path.lower()
    return any(keyword in lower_path for keyword in EXCLUDED_PATH_KEYWORDS)


def collect_from_page(page_url: str) -> List[UrlRecord]:
    html = fetch_html(page_url)
    text = extract_visible_text(html)
    candidates = extract_candidates_from_text(text)

    records: List[UrlRecord] = []
    seen_local: Set[tuple[str, str]] = set()

    for raw in candidates:
        try:
            normalized = normalize_url(raw)
            host, path = split_host_path(normalized)

            if not host:
                continue

            if is_blocked_host(host):
                continue

            if looks_like_safe_or_public(host):
                continue

            if is_excluded_path(path):
                continue

            if (host, path) in seen_local:
                continue

            context = get_context_window(text, raw, window=120)
            keyword_hit = detect_keyword_context(context, raw)

            if not keyword_hit:
                continue

            if has_safe_context(context):
                continue

            if not is_suspicious_host(host) and host.count("-") == 0:
                continue

            records.append(
                UrlRecord(
                    host=host,
                    path=path,
                    label="malicious",
                    source_page=page_url,
                    keyword_hit=keyword_hit,
                    note="public_page_extracted",
                )
            )
            seen_local.add((host, path))
        except Exception:
            continue

    return records


def read_seed_urls(seed_file: str) -> List[str]:
    urls: List[str] = []
    with open(seed_file, "r", encoding="utf-8") as f:
        for line in f:
            value = line.strip()
            if not value or value.startswith("#"):
                continue
            urls.append(value)
    return urls


def write_csv(records: Iterable[UrlRecord], output_file: str) -> None:
    fieldnames = [
        "host",
        "path",
        "label",
        "source_page",
        "keyword_hit",
        "note",
    ]
    with open(output_file, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for rec in records:
            writer.writerow(asdict(rec))


def dedup_records(records: List[UrlRecord]) -> List[UrlRecord]:
    dedup_map: dict[tuple[str, str], UrlRecord] = {}
    for rec in records:
        key = (rec.host, rec.path)
        if key not in dedup_map:
            dedup_map[key] = rec
    return list(dedup_map.values())


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python ai_trainer/scripts/collect_public_malicious_urls.py <seed_urls.txt> <output.csv>")
        return 1

    seed_file = sys.argv[1]
    output_file = sys.argv[2]

    seed_urls = read_seed_urls(seed_file)
    all_records: List[UrlRecord] = []

    for idx, page_url in enumerate(seed_urls, start=1):
        try:
            print(f"[{idx}/{len(seed_urls)}] collecting: {page_url}")
            page_records = collect_from_page(page_url)
            print(f"  -> extracted: {len(page_records)}")
            all_records.extend(page_records)
        except Exception as e:
            print(f"  !! failed: {page_url} :: {e}")
        time.sleep(SLEEP_SEC)

    final_records = dedup_records(all_records)
    write_csv(final_records, output_file)
    print(f"done: {len(final_records)} records -> {output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
