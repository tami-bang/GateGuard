import pandas as pd

base = pd.read_csv("/home/ktech/GateGuard/ai_trainer/data/processed/gateguard_dataset_v4.csv")
benign = pd.read_csv("/home/ktech/GateGuard/ai_trainer/data/raw/generated_hard_benign.csv")
mal = pd.read_csv("/home/ktech/GateGuard/ai_trainer/data/raw/generated_korean_malicious.csv")
adv = pd.read_csv("/home/ktech/GateGuard/ai_trainer/data/raw/generated_advanced_malicious.csv")

merged = pd.concat([base, benign, mal, adv], ignore_index=True)
merged.to_csv("/home/ktech/GateGuard/ai_trainer/data/raw/gateguard_dataset_v6.csv", index=False)

print("done:", len(merged))
print(merged["label"].value_counts())
