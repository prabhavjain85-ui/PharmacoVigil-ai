"""
ML prioritisation of drug-event pairs with a pretrained, exported model.

The model is an L2-regularised logistic regression trained offline by
``train_prioritizer.py`` on published reference sets (see ``reference_sets.py``)
and stored as JSON.  The same JSON file is bundled into the web app, so the
browser and this module score pairs identically.  Nothing is trained at
scoring time.

Explanations are signed and exact for a linear model: the contribution of
feature j is ``weight_j * (x_j - mean_j) / std_j`` in log-odds, i.e. how far the
feature moved this pair away from an average training pair.  A missing feature
is imputed with the training mean and therefore contributes zero.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

from pair_features import build_feature_frame

MODEL_PATH = Path(__file__).resolve().parent / "web" / "lib" / "pipeline" / "prioritizerModel.json"
TOP_DRIVERS = 3


@dataclass(frozen=True)
class PrioritizationModel:
    spec: dict[str, Any]

    @property
    def features(self) -> list[dict[str, Any]]:
        return self.spec["features"]

    @property
    def used_features(self) -> list[dict[str, Any]]:
        return [f for f in self.features if f.get("used")]

    @property
    def intercept(self) -> float:
        return float(self.spec["intercept"])

    def contributions(self, frame: pd.DataFrame) -> pd.DataFrame:
        """Signed log-odds contribution per used feature (0 where the value is missing)."""
        out = {}
        for feat in self.used_features:
            values = frame[feat["name"]].astype(float).to_numpy()
            z = (values - feat["mean"]) / (feat["std"] or 1.0)
            out[feat["name"]] = np.where(np.isnan(values), 0.0, feat["weight"] * z)
        return pd.DataFrame(out, index=frame.index)

    def score(self, frame: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
        contrib = self.contributions(frame)
        logit = self.intercept + contrib.sum(axis=1).to_numpy()
        return 1.0 / (1.0 + np.exp(-logit)), contrib

    def predict_batch(self, frame: pd.DataFrame) -> list[dict[str, Any]]:
        probs, contrib = self.score(frame)
        labels = {f["name"]: f["label"] for f in self.features}
        names = list(contrib.columns)
        matrix = contrib.to_numpy()
        rows: list[dict[str, Any]] = []
        for i, prob in enumerate(probs):
            order = np.argsort(-np.abs(matrix[i]))[:TOP_DRIVERS]
            explain = []
            for j in order:
                name = names[j]
                value = float(frame[name].iloc[i])
                if np.isnan(value) or matrix[i, j] == 0:
                    continue
                explain.append({
                    "feature": name,
                    "label": labels[name],
                    "value": round(value, 4),
                    "contribution": round(float(matrix[i, j]), 4),
                })
            rows.append({"priority_score": round(float(prob), 4), "priority_explain": explain})
        return rows


@lru_cache(maxsize=4)
def _load_cached(path: str) -> PrioritizationModel:
    return PrioritizationModel(json.loads(Path(path).read_text(encoding="utf-8")))


def load_model(path: Optional[Path | str] = None) -> PrioritizationModel:
    """Load the exported model (default: the copy bundled with the web app)."""
    return _load_cached(str(path or MODEL_PATH))


def apply_prioritization(
    signals: pd.DataFrame,
    model: PrioritizationModel,
    total_reports: int,
    case_features: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Add ``priority_score``, ``priority_explain`` and ``priority_rank`` and sort by score."""
    if signals.empty:
        return signals
    frame = build_feature_frame(signals, total_reports, case_features)
    scored = model.predict_batch(frame)
    out = signals.copy()
    out["priority_score"] = [row["priority_score"] for row in scored]
    out["priority_explain"] = [row["priority_explain"] for row in scored]
    out = out.sort_values("priority_score", ascending=False, kind="mergesort").reset_index(drop=True)
    out["priority_rank"] = np.arange(1, len(out) + 1)
    return out


def model_card(model: Optional[PrioritizationModel] = None) -> dict[str, Any]:
    """Training provenance, evaluation and weights, for the API and the UI."""
    spec = (model or load_model()).spec
    return {
        "model_type": spec["model_type"],
        "created": spec["created"],
        "feature_set": spec["feature_set"],
        "training": spec["training"],
        "evaluation": spec["evaluation"],
        "features": spec["features"],
        "limitations": [
            "Ranks pairs for analyst triage only; not validated for regulatory decisions.",
            "Trained on health-outcome groups from 2013 reference sets, then applied to single preferred terms.",
            "Positive controls are established, labelled reactions, so the model learns what known "
            "reactions look like in spontaneous reports rather than what emerging ones look like.",
        ],
    }
