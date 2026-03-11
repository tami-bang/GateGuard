from __future__ import annotations

from typing import Any, Dict, List

from sklearn.model_selection import train_test_split

from ai_train_program import (
    build_model,
    encode_labels,
    fit_feature_pipeline,
    predict,
    predict_top_score,
    save_artifacts,
    train_model,
    transform_feature_pipeline,
)
from data_preprocessor import preprocess_csv_files
from evaluator import evaluate_classification


def get_training_csv_paths(config: Dict[str, Any]) -> List[str]:
    data_config = config.get("data", {})
    csv_paths = data_config.get("csv_paths", [])

    if not csv_paths:
        raise ValueError("config['data']['csv_paths'] is empty")

    if not isinstance(csv_paths, list):
        raise ValueError("config['data']['csv_paths'] must be a list")

    normalized_paths = []
    for path in csv_paths:
        if not isinstance(path, str) or not path.strip():
            raise ValueError("Each csv path must be a non-empty string")
        normalized_paths.append(path.strip())

    return normalized_paths


def run_training_pipeline(config: Dict[str, Any]) -> Dict[str, Any]:
    csv_paths = get_training_csv_paths(config)

    dataset = preprocess_csv_files(csv_paths)

    if dataset.dataframe.empty:
        raise ValueError("No rows found after preprocessing CSV files")

    if dataset.labels.empty:
        raise ValueError("No labels found after preprocessing CSV files")

    x_train_df, x_valid_df, y_train, y_valid = train_test_split(
        dataset.dataframe,
        dataset.labels,
        test_size=config["training"]["test_size"],
        random_state=config["training"]["random_state"],
        stratify=dataset.labels,
    )

    vectorizer, x_train = fit_feature_pipeline(x_train_df, config)
    x_valid = transform_feature_pipeline(x_valid_df, vectorizer)

    label_encoder, y_train_enc, y_valid_enc = encode_labels(y_train, y_valid)

    model = build_model(config)
    trained_model = train_model(model, x_train, y_train_enc)

    y_pred_enc = predict(trained_model, x_valid)
    y_score = predict_top_score(trained_model, x_valid)

    y_pred = label_encoder.inverse_transform(y_pred_enc)
    y_valid_labels = label_encoder.inverse_transform(y_valid_enc)

    metrics = evaluate_classification(y_valid_labels, y_pred, y_score)

    output_dir = config["output"]["output_dir"]
    save_artifacts(
        model=trained_model,
        vectorizer=vectorizer,
        label_encoder=label_encoder,
        config=config,
        metrics=metrics,
        output_dir=output_dir,
    )

    return {
        "status": "success",
        "row_count": len(dataset.dataframe),
        "feature_count": len(dataset.feature_columns),
        "labels": sorted(dataset.labels.unique().tolist()),
        "artifacts": {
            "output_dir": output_dir,
        },
        "metrics": metrics,
    }
