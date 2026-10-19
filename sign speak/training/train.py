"""Train browser-ready landmark classifiers from HaGRID and RealSign."""

from __future__ import annotations

import argparse
import json
import random
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

import mediapipe as mp
import numpy as np
from PIL import Image
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

HAGRID_CLASSES = (
    "call",
    "dislike",
    "fist",
    "four",
    "like",
    "mute",
    "ok",
    "one",
    "palm",
    "peace_inverted",
    "peace",
    "rock",
    "stop_inverted",
    "stop",
    "three",
    "three2",
    "two_up_inverted",
    "two_up",
    "no_gesture",
)
HAND_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
SCHEMA = "signspeak-landmark-mlp-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--realsign-dir",
        type=Path,
        default=None,
        help="Extracted RealSign Dataset.zip directory.",
    )
    parser.add_argument(
        "--hagrid-annotations",
        type=Path,
        default=None,
        help="Extracted HaGRID train/validation annotations directory.",
    )
    parser.add_argument(
        "--dataset",
        choices=("both", "hagrid", "isl"),
        default="both",
        help="Train both models, only HaGRID, or only the ISL alphabet model.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("public/models"),
        help="Directory for browser model JSON files (default: public/models).",
    )
    parser.add_argument(
        "--max-samples-per-class",
        type=int,
        default=20_000,
        help="Cap HaGRID samples per class; use 0 to keep every annotation.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for sampling and validation splitting.",
    )
    return parser.parse_args()


def normalized_features(points: Any) -> np.ndarray | None:
    try:
        values = np.asarray(
            [[float(point[0]), float(point[1])] for point in points],
            dtype=np.float32,
        )
    except (TypeError, ValueError, IndexError):
        return None

    if values.shape != (21, 2) or not np.isfinite(values).all():
        return None

    values -= values[0]
    scale = float(np.linalg.norm(values, axis=1).max())
    if scale < 1e-6:
        return None
    return (values / scale).reshape(-1)


def features_from_task_landmarks(landmarks: Any) -> np.ndarray | None:
    return normalized_features([[point.x, point.y] for point in landmarks])


def load_hagrid(
    annotation_root: Path,
    sample_cap: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = random.Random(seed)
    reservoirs: dict[str, list[tuple[np.ndarray, str]]] = defaultdict(list)
    seen: dict[str, int] = defaultdict(int)
    json_files = sorted(annotation_root.rglob("*.json"))
    if not json_files:
        raise FileNotFoundError(f"No HaGRID annotation JSON files found in {annotation_root}")

    known_classes = set(HAGRID_CLASSES)
    for annotation_path in json_files:
        with annotation_path.open(encoding="utf-8") as annotation_file:
            annotations = json.load(annotation_file)
        if not isinstance(annotations, dict):
            raise ValueError(f"Expected an image-keyed JSON object in {annotation_path}")

        for image_id, annotation in annotations.items():
            if not isinstance(annotation, dict):
                continue
            labels = annotation.get("labels", [])
            landmark_sets = annotation.get("landmarks", [])
            if not isinstance(labels, list) or not isinstance(landmark_sets, list):
                continue
            owner = str(annotation.get("user_id", image_id))

            for label, points in zip(labels, landmark_sets):
                if label not in known_classes:
                    continue
                features = normalized_features(points)
                if features is None:
                    continue
                seen[label] += 1
                sample = (features, owner)
                reservoir = reservoirs[label]
                if sample_cap <= 0 or len(reservoir) < sample_cap:
                    reservoir.append(sample)
                else:
                    replacement = rng.randrange(seen[label])
                    if replacement < sample_cap:
                        reservoir[replacement] = sample

    missing = sorted(known_classes - reservoirs.keys())
    if missing:
        raise ValueError(
            "HaGRID annotations are missing classes: "
            + ", ".join(missing)
            + ". Download annotations that include all 18 gestures and no_gesture."
        )

    features: list[np.ndarray] = []
    labels: list[str] = []
    groups: list[str] = []
    for label in HAGRID_CLASSES:
        for vector, owner in reservoirs[label]:
            features.append(vector)
            labels.append(label)
            groups.append(owner)

    print(
        f"HaGRID: retained {len(features):,} hand samples "
        f"from {len(json_files):,} annotation files."
    )
    return (
        np.asarray(features, dtype=np.float32),
        np.asarray(labels),
        np.asarray(groups),
    )


def locate_split(root: Path, split: str) -> Path:
    matches = [
        entry
        for entry in root.iterdir()
        if entry.is_dir() and split in entry.name.lower()
    ]
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected one {split} folder under {root}; found "
            + (", ".join(entry.name for entry in matches) or "none")
        )
    return matches[0]


def get_hand_landmarker(model_path: Path) -> Any:
    if not model_path.exists():
        model_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading MediaPipe hand landmark model to {model_path}...")
        urllib.request.urlretrieve(HAND_MODEL_URL, model_path)

    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_hands=2,
    )
    return mp.tasks.vision.HandLandmarker.create_from_options(options)


def extract_realsign_features(
    dataset_root: Path,
    hand_landmarker: Any,
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    split_features: dict[str, np.ndarray] = {}
    split_labels: dict[str, np.ndarray] = {}

    for split in ("training", "validation", "testing"):
        split_root = locate_split(dataset_root, split)
        features: list[np.ndarray] = []
        labels: list[str] = []
        skipped = 0
        class_dirs = sorted(entry for entry in split_root.iterdir() if entry.is_dir())
        if [entry.name.upper() for entry in class_dirs] != list("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
            raise ValueError(
                f"{split_root} must contain one folder per letter A-Z."
            )

        for class_dir in class_dirs:
            for image_path in sorted(class_dir.rglob("*")):
                if not image_path.is_file():
                    continue
                try:
                    with Image.open(image_path) as image:
                        rgb = np.asarray(image.convert("RGB"))
                except OSError as error:
                    raise OSError(f"Unable to read image {image_path}") from error

                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = hand_landmarker.detect(mp_image)
                if not result.hand_landmarks:
                    skipped += 1
                    continue

                hand = max(
                    result.hand_landmarks,
                    key=lambda points: max(point.x for point in points)
                    - min(point.x for point in points)
                    + max(point.y for point in points)
                    - min(point.y for point in points),
                )
                vector = features_from_task_landmarks(hand)
                if vector is None:
                    skipped += 1
                    continue
                features.append(vector)
                labels.append(class_dir.name.upper())

        if not features:
            raise ValueError(f"No usable hand landmarks found in {split_root}")
        missing = sorted(set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") - set(labels))
        if missing:
            raise ValueError(
                f"{split_root} has no usable landmarks for letters: "
                + ", ".join(missing)
            )
        split_features[split] = np.asarray(features, dtype=np.float32)
        split_labels[split] = np.asarray(labels)
        print(
            f"RealSign {split}: extracted {len(features):,} hands; "
            f"skipped {skipped:,} images without a usable hand."
        )

    return split_features, split_labels


def make_classifier(seed: int) -> tuple[StandardScaler, MLPClassifier]:
    return StandardScaler(), MLPClassifier(
        hidden_layer_sizes=(128, 64),
        activation="relu",
        solver="adam",
        max_iter=250,
        early_stopping=True,
        random_state=seed,
        verbose=True,
    )


def serialize_model(
    name: str,
    scaler: StandardScaler,
    classifier: MLPClassifier,
    classes: list[str],
    metrics: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "name": name,
        "inputSize": 42,
        "classes": classes,
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "layers": [
            {
                "weights": weights.tolist(),
                "bias": bias.tolist(),
                "activation": (
                    "relu" if index < len(classifier.coefs_) - 1 else "softmax"
                ),
            }
            for index, (weights, bias) in enumerate(
                zip(classifier.coefs_, classifier.intercepts_)
            )
        ],
        "minConfidence": 0.60,
        "metrics": metrics,
    }


def fit_and_export(
    name: str,
    features: np.ndarray,
    labels: np.ndarray,
    train_indices: np.ndarray,
    validation_indices: np.ndarray,
    output_path: Path,
    seed: int,
) -> None:
    scaler, classifier = make_classifier(seed)
    classes = sorted(set(labels.tolist()))
    class_to_index = {label: index for index, label in enumerate(classes)}
    encoded_labels = np.asarray([class_to_index[label] for label in labels])
    train_features = scaler.fit_transform(features[train_indices])
    validation_features = scaler.transform(features[validation_indices])
    classifier.fit(train_features, encoded_labels[train_indices])

    predictions = classifier.predict(validation_features).astype(int)
    report = classification_report(
        encoded_labels[validation_indices],
        predictions,
        labels=list(range(len(classes))),
        target_names=classes,
        output_dict=True,
        zero_division=0,
    )
    metrics = {
        "validationAccuracy": float(
            accuracy_score(encoded_labels[validation_indices], predictions)
        ),
        "validationSamples": int(len(validation_indices)),
        "classificationReport": report,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            serialize_model(name, scaler, classifier, classes, metrics),
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(
        f"{name}: validation accuracy "
        f"{metrics['validationAccuracy']:.1%}; wrote {output_path}"
    )


def train_hagrid(
    annotations_root: Path,
    output_dir: Path,
    sample_cap: int,
    seed: int,
) -> None:
    features, labels, groups = load_hagrid(annotations_root, sample_cap, seed)
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=seed)
    train_indices, validation_indices = next(
        splitter.split(features, labels, groups=groups)
    )
    missing_train = sorted(set(HAGRID_CLASSES) - set(labels[train_indices]))
    missing_validation = sorted(set(HAGRID_CLASSES) - set(labels[validation_indices]))
    if missing_train or missing_validation:
        raise ValueError(
            "The signer-based HaGRID split must contain all classes in both "
            f"sets. Missing from train: {missing_train or 'none'}; "
            f"missing from validation: {missing_validation or 'none'}."
        )
    fit_and_export(
        "hagrid",
        features,
        labels,
        train_indices,
        validation_indices,
        output_dir / "hagrid.json",
        seed,
    )


def train_realsign(dataset_root: Path, output_dir: Path, seed: int) -> None:
    model_path = Path.home() / ".signspeak" / "hand_landmarker.task"
    with get_hand_landmarker(model_path) as hand_landmarker:
        split_features, split_labels = extract_realsign_features(
            dataset_root, hand_landmarker
        )

    train_features = split_features["training"]
    train_labels = split_labels["training"]
    validation_features = split_features["validation"]
    validation_labels = split_labels["validation"]
    test_features = split_features["testing"]
    test_labels = split_labels["testing"]

    scaler, classifier = make_classifier(seed)
    classes = sorted(set(train_labels.tolist()))
    class_to_index = {label: index for index, label in enumerate(classes)}
    encoded_train_labels = np.asarray([class_to_index[label] for label in train_labels])
    encoded_validation_labels = np.asarray(
        [class_to_index[label] for label in validation_labels]
    )
    encoded_test_labels = np.asarray([class_to_index[label] for label in test_labels])
    classifier.fit(scaler.fit_transform(train_features), encoded_train_labels)
    validation_predictions = classifier.predict(
        scaler.transform(validation_features)
    ).astype(int)
    test_predictions = classifier.predict(scaler.transform(test_features)).astype(int)
    report = classification_report(
        encoded_test_labels,
        test_predictions,
        labels=list(range(len(classes))),
        target_names=classes,
        output_dict=True,
        zero_division=0,
    )
    metrics = {
        "validationAccuracy": float(
            accuracy_score(encoded_validation_labels, validation_predictions)
        ),
        "testAccuracy": float(accuracy_score(encoded_test_labels, test_predictions)),
        "testSamples": int(len(test_labels)),
        "classificationReport": report,
    }
    output_path = output_dir / "isl-alphabet.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            serialize_model("isl-alphabet", scaler, classifier, classes, metrics),
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(
        f"RealSign A-Z: validation accuracy "
        f"{metrics['validationAccuracy']:.1%}, test accuracy "
        f"{metrics['testAccuracy']:.1%}; wrote {output_path}"
    )


def main() -> None:
    args = parse_args()
    if args.max_samples_per_class < 0:
        raise ValueError("--max-samples-per-class must be zero or greater.")

    random.seed(args.seed)
    np.random.seed(args.seed)
    if args.dataset in ("both", "hagrid"):
        if args.hagrid_annotations is None or not args.hagrid_annotations.is_dir():
            raise FileNotFoundError(
                f"HaGRID annotation directory not found: {args.hagrid_annotations}"
            )
        train_hagrid(
            args.hagrid_annotations,
            args.output_dir,
            args.max_samples_per_class,
            args.seed,
        )
    if args.dataset in ("both", "isl"):
        if args.realsign_dir is None or not args.realsign_dir.is_dir():
            raise FileNotFoundError(f"RealSign directory not found: {args.realsign_dir}")
        train_realsign(args.realsign_dir, args.output_dir, args.seed)


if __name__ == "__main__":
    main()
