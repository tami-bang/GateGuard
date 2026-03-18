import random
import pandas as pd

brands = [
    "google", "naver", "kakao", "microsoft", "apple",
    "amazon", "facebook", "instagram", "netflix",
    "toss", "coupang", "baemin", "woori", "kb", "shinhan"
]

subdomains = [
    "accounts", "login", "support", "docs", "drive",
    "mail", "auth", "secure", "portal", "service"
]

paths = [
    "/login", "/signin", "/account", "/verify",
    "/auth", "/dashboard", "/user/profile",
    "/payment", "/settings", "/home"
]

queries = [
    "?redirect=home",
    "?continue=/dashboard",
    "?next=/home",
    "?session=abc123",
    "?token=xyz789",
    "?auth=true",
    ""
]

tlds = ["com", "co.kr", "net", "org"]

def generate():
    data = []

    for _ in range(200):
        brand = random.choice(brands)
        sub = random.choice(subdomains)
        path = random.choice(paths)
        query = random.choice(queries)
        tld = random.choice(tlds)

        url = f"{sub}.{brand}.{tld}{path}{query}"
        data.append({"url": url, "label": "benign"})

    return pd.DataFrame(data)

if __name__ == "__main__":
    df = generate()
    df.to_csv("ai_trainer/data/raw/generated_hard_benign.csv", index=False)
    print("generated:", len(df))
