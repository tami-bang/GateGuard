import random
import pandas as pd

brands = ["kakao", "naver", "coupang", "toss", "kb", "shinhan"]
keywords = ["login", "verify", "secure", "update", "account", "payment"]
tlds = ["xyz", "top", "shop", "live"]

def generate():
    data = []

    for _ in range(300):
        b = random.choice(brands)
        k = random.choice(keywords)
        t = random.choice(tlds)

        # 패턴 1
        url1 = f"{k}-{b}.com.secure-check.{t}/login"

        # 패턴 2
        url2 = f"{b}-com-{k}.{t}/verify"

        # 패턴 3
        url3 = f"{b}.{k}-account.{t}/update"

        data.append({"url": url1, "label": "malicious"})
        data.append({"url": url2, "label": "malicious"})
        data.append({"url": url3, "label": "malicious"})

    return pd.DataFrame(data)

if __name__ == "__main__":
    df = generate()
    df.to_csv("ai_trainer/data/raw/generated_advanced_malicious.csv", index=False)
    print("generated:", len(df))
