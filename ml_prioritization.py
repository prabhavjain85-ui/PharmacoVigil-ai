"""
Gradient-boosted prioritisation of drug–event pairs using weak reference labels.

Training uses ``reference_signals.REFERENCE_POSITIVE_PAIRS`` as positives and
all other eligible pairs as negatives. This is suitable for demo / triage ranking
only — not validated for regulatory decision-making.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier

from reference_signals import is_reference_positive

FEATURE_COLUMNS = [
    "PRR",
    "ROR",
    "chi_square",
    "IC",
    "EBGM",
    "EB05",
    "case_count_a",
    "log_cases",
    "serious_event",
    "drug_report_share",
    "event_report_share",
]

DISPLAY_NAMES = {
    "PRR": "PRR",
    "ROR": "ROR",
    "chi_square": "χ²",
    "IC": "IC (BCPNN)",
    "EBGM": "EBGM",
    "EB05": "EB05",
    "case_count_a": "Case count",
    "log_cases": "log(cases)",
    "serious_event": "Serious PT flag",
    "drug_report_share": "Drug report share",
    "event_report_share": "Event report share",
}


@dataclass
class PrioritizationModel:
    classifier: GradientBoostingClassifier
    feature_columns: list[str]
    global_importance: dict[str, float]

    def predict_batch(self, frame: pd.DataFrame) -> list[dict[str, Any]]:
        matrix = frame[self.feature_columns].astype(float).values
        probs = self.classifier.predict_proba(matrix)[:, 1]
        importances = np.array(
            [self.global_importance[c] for c in self.feature_columns], dtype=float
        )
        importances = importances / (importances.sum() or 1.0)
        rows: list[dict[str, Any]] = []
        for idx, prob in enumerate(probs):
            feat_row = matrix[idx]
            contributions = feat_row * importances
            order = np.argsort(-np.abs(contributions))[:3]
            explain = [
                {
                    "feature": self.feature_columns[i],
                    "label": DISPLAY_NAMES.get(self.feature_columns[i], self.feature_columns[i]),
                    "value": round(float(feat_row[i]), 4),
                    "contribution": round(float(contributions[i]), 4),
                }
                for i in order
            ]
            rows.append({
                "priority_score": round(float(prob), 4),
                "priority_explain": explain,
            })
        return rows


def _build_feature_matrix(signals: pd.DataFrame, total_reports: int) -> pd.DataFrame:
    frame = signals.copy()
    frame["log_cases"] = np.log1p(frame["case_count_a"].astype(float))
    frame["serious_event"] = frame["serious_event"].astype(float)
    frame["drug_report_share"] = frame["drug_total_reports"] / max(total_reports, 1)
    frame["event_report_share"] = frame["event_total_reports"] / max(total_reports, 1)
    return frame


def train_prioritization_model(
    signals: pd.DataFrame,
    total_reports: int,
    random_state: int = 42,
) -> PrioritizationModel:
    if signals.empty:
        clf = GradientBoostingClassifier(random_state=random_state)
        return PrioritizationModel(clf, FEATURE_COLUMNS, {c: 0.0 for c in FEATURE_COLUMNS})

    frame = _build_feature_matrix(signals, total_reports)
    labels = [
        1 if is_reference_positive(row["drug"], row["adverse_event"]) else 0
        for _, row in frame.iterrows()
    ]
    y = np.array(labels, dtype=int)
    x = frame[FEATURE_COLUMNS].astype(float).values

    clf = GradientBoostingClassifier(
        random_state=random_state,
        max_depth=3,
        n_estimators=120,
        learning_rate=0.08,
        subsample=0.9,
    )
    clf.fit(x, y)
    global_imp = dict(zip(FEATURE_COLUMNS, clf.feature_importances_, strict=True))
    return PrioritizationModel(clf, FEATURE_COLUMNS, global_imp)


def apply_prioritization(
    signals: pd.DataFrame,
    model: PrioritizationModel,
    total_reports: int,
) -> pd.DataFrame:
    if signals.empty:
        return signals
    frame = _build_feature_matrix(signals, total_reports)
    scored = model.predict_batch(frame)
    out = signals.copy()
    out["priority_score"] = [row["priority_score"] for row in scored]
    out["priority_explain"] = [row["priority_explain"] for row in scored]
    out = out.sort_values("priority_score", ascending=False).reset_index(drop=True)
    out["priority_rank"] = np.arange(1, len(out) + 1)
    return out
