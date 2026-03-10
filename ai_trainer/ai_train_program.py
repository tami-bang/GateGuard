# ~/GateGuard/ai_trainer/ai_train_program.py
"""
실제 모델 학습 담당
"""

from __future__ import annotations

from typing import Any, Dict

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression


def build_model(config: Dict[str, Any]) -> Any:
    algorithm = config["training"]["algorithm"]
    random_state = config["training"]["random_state"]

    if algorithm == "logistic_regression":
        return LogisticRegression(
            max_iter=1000,
            random_state=random_state,
        )

    if algorithm == "random_forest":
        return RandomForestClassifier(
            n_estimators=200,
            max_depth=12,
            min_samples_split=4,
            min_samples_leaf=2,
            random_state=random_state,
        )

    raise ValueError(f"Unsupported algorithm: {algorithm}")


def train_model(model: Any, x_train, y_train) -> Any:
    model.fit(x_train, y_train)
    return model


def predict(model: Any, x_valid):
    return model.predict(x_valid)


def predict_proba(model: Any, x_valid):
    if hasattr(model, "predict_proba"):
        return model.predict_proba(x_valid)[:, 1]
    return None
