import random
import pandas as pd

brands = ["kakao", "naver", "coupang", "toss", "kb", "shinhan"]

keywords = [
    "login", "secure", "verify", "update",
    "account", "payment", "delivery", "confirm"
]

tlds = ["xyz", "top", "shop", "live", "click"]

def generate():
    data = []

    for _ in range(200):
        brand = random.choice(brands)
        kw = random.choice(keywords)
        tld = random.choice(tlds)

        url = f"{brand}-{kw}-secure.{tld}/login"
        data.append({"url": url, "label": "malicious"})

    return pd.DataFrame(data)

if __name__ == "__main__":
    df = generate()
    df.to_csv("ai_trainer/data/raw/generated_korean_malicious.csv", index=False)
    print("generated:", len(df))
