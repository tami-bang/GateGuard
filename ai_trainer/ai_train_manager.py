from __future__ import annotations

from typing import Any, Dict, List

from sklearn.model_selection import train_test_split

from ai_train_program import (
    build_model,
    encode_labels,
    fit_feature_pipeline,
    predict,
    predict_top_score,
    train_model,
    transform_feature_pipeline,
)
from data_preprocessor import preprocess_csv_files
from evaluator import evaluate_classification
from extract_to_file import save_all_artifacts


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

    # 1) evaluation split
    x_train_df, x_valid_df, y_train, y_valid = train_test_split(
        dataset.dataframe,
        dataset.labels,
        test_size=config["training"]["test_size"],
        random_state=config["training"]["random_state"],
        stratify=dataset.labels,
    )

    # 2) fit/evaluate on train-valid split
    eval_vectorizer, x_train = fit_feature_pipeline(x_train_df, config)
    x_valid = transform_feature_pipeline(x_valid_df, eval_vectorizer)

    eval_label_encoder, y_train_enc, y_valid_enc = encode_labels(y_train, y_valid)

    eval_model = build_model(config)
    eval_trained_model = train_model(eval_model, x_train, y_train_enc)

    y_pred_enc = predict(eval_trained_model, x_valid)
    y_score = predict_top_score(eval_trained_model, x_valid)

    y_pred = eval_label_encoder.inverse_transform(y_pred_enc)
    y_valid_labels = eval_label_encoder.inverse_transform(y_valid_enc)

    metrics = evaluate_classification(y_valid_labels, y_pred, y_score)

    # 3) refit on full dataset for deployment artifacts
    full_vectorizer, x_full = fit_feature_pipeline(dataset.dataframe, config)
    full_label_encoder, y_full_enc, _ = encode_labels(dataset.labels)
    full_model = build_model(config)
    full_trained_model = train_model(full_model, x_full, y_full_enc)

    output_dir = config["output"]["output_dir"]
    artifact_paths = save_all_artifacts(
        model=full_trained_model,
        vectorizer=full_vectorizer,
        label_encoder=full_label_encoder,
        config=config,
        metrics=metrics,
        feature_columns=dataset.feature_columns,
        output_dir=output_dir,
    )

    return {
        "status": "success",
        "row_count": len(dataset.dataframe),
        "feature_count": len(dataset.feature_columns),
        "labels": sorted(dataset.labels.unique().tolist()),
        "artifacts": {
            "output_dir": output_dir,
            **artifact_paths,
        },
        "metrics": metrics,
    }
