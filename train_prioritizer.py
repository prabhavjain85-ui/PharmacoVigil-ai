#!/usr/bin/env python3
"""
Train, evaluate and export the ML prioritisation model.

    # real FAERS: one or more unzipped quarterly ASCII folders
    python train_prioritizer.py --faers-dir faers/24Q1/ASCII faers/24Q2/ASCII

    # no FAERS download: synthetic benchmark (pipeline check and placeholder weights)
    python train_prioritizer.py --synthetic

Steps
1. Load the reports and keep the latest version of each case.
2. Fold MedDRA preferred terms into the reference-set outcomes and compute
   disproportionality statistics and case-level features for every reference
   control with at least ``--min-cases`` reports.
3. Estimate out-of-sample performance with repeated cross-validation grouped
   by drug (a drug never appears in both the training and the test fold) and
   compare against ranking by each disproportionality statistic alone.
4. Fit on all labelled controls and export the weights as JSON, which both the
   browser app and the Python pipeline load.
"""
from __future__ import annotations

import argparse
import json
import tempfile
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler

from faers_loader import FaersTables, load_faers
from faers_signal_detection import (
    build_case_level_table,
    compute_disproportionality_from_tables,
)
from ml_prioritization import MODEL_PATH
from pair_features import (
    ALL_FEATURES,
    FEATURE_GROUP_OF,
    FEATURE_GROUPS,
    FEATURE_LABELS,
    CaseContext,
    build_feature_frame,
    case_level_features,
)
from reference_sets import load_reference_controls, map_event_to_hoi, reference_drug_name

BASELINES = {
    "PRR": "PRR",
    "ROR lower 95% bound": "ROR_95CI_low",
    "IC025 (BCPNN)": "IC025",
    "EB05 (EBGM)": "EB05",
    "Chi-square": "chi_square",
    "Case count": "case_count_a",
}
REPEAT_SEEDS = (11, 23, 37, 41, 53)
N_SPLITS = 5
PRECISION_KS = (10, 25, 50)


def build_training_frame(tables: FaersTables, min_cases: int) -> tuple[pd.DataFrame, dict]:
    """Labelled feature matrix: one row per reference control with enough reports."""
    import gc

    controls = load_reference_controls()

    drug = tables.drug
    uniq_names = drug["drugname"].dropna().unique()
    drug["drugname"] = drug["drugname"].map({n: reference_drug_name(n) for n in uniq_names})
    reac = tables.reac
    uniq_terms = reac["pt"].dropna().unique()
    reac["pt"] = reac["pt"].map({t: map_event_to_hoi(t) for t in uniq_terms})

    ctrl_drugs = set(controls["drug"])
    ctrl_events = set(controls["adverse_event"])
    subset = build_case_level_table(
        tables.demo,
        drug[drug["drugname"].isin(ctrl_drugs)],
        reac[reac["pt"].isin(ctrl_events)],
        deduplicate_cases=False,
    )
    context = CaseContext(demo=tables.demo, drug=drug, outc=tables.outc, indi=tables.indi, ther=tables.ther)
    case_features = case_level_features(subset, context, event_mapper=map_event_to_hoi)
    del subset, context
    tables.outc = None
    tables.indi = None
    tables.ther = None
    gc.collect()

    wanted = set(zip(controls["drug"], controls["adverse_event"]))
    demo = tables.demo
    tables.demo = None
    tables.drug = None
    tables.reac = None
    signals, total_reports, seen_drugs = compute_disproportionality_from_tables(
        demo, drug, reac, min_cases=min_cases, restrict_to=wanted, already_normalized=True,
    )
    del demo, drug, reac
    gc.collect()

    features = build_feature_frame(signals, total_reports, case_features)
    frame = pd.concat([signals.reset_index(drop=True), features.reset_index(drop=True)], axis=1)
    frame = frame.merge(controls, on=["drug", "adverse_event"], how="inner")

    coverage = {
        "n_cases": total_reports,
        "controls_total": int(len(controls)),
        "controls_drug_in_data": int(controls["drug"].isin(seen_drugs).sum()),
        "controls_with_min_cases": int(len(frame)),
        "unmatched_drugs": sorted(set(controls["drug"]) - seen_drugs),
    }
    return frame, coverage


def make_logistic() -> Pipeline:
    return make_pipeline(
        SimpleImputer(strategy="mean", keep_empty_features=True),
        StandardScaler(),
        LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000),
    )


def make_boosting() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_depth=3, max_iter=150, learning_rate=0.05, class_weight="balanced", random_state=0,
    )


def out_of_fold(make_model, x: np.ndarray, y: np.ndarray, groups: np.ndarray) -> list[np.ndarray]:
    """Out-of-fold scores for each repeat of drug-grouped stratified CV."""
    repeats = []
    for seed in REPEAT_SEEDS:
        scores = np.full(len(y), np.nan)
        splitter = StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=seed)
        for train, test in splitter.split(x, y, groups):
            model = make_model()
            model.fit(x[train], y[train])
            scores[test] = model.predict_proba(x[test])[:, 1]
        repeats.append(scores)
    return repeats


def precision_at_k(y: np.ndarray, scores: np.ndarray, k: int) -> float:
    order = np.argsort(-scores, kind="mergesort")[:k]
    return float(y[order].mean())


def summarise(y: np.ndarray, repeats: list[np.ndarray]) -> dict:
    aucs = [roc_auc_score(y, s) for s in repeats]
    aps = [average_precision_score(y, s) for s in repeats]
    summary = {
        "auc": round(float(np.mean(aucs)), 4),
        "auc_sd": round(float(np.std(aucs)), 4),
        "ap": round(float(np.mean(aps)), 4),
        "ap_sd": round(float(np.std(aps)), 4),
        "precision_at_k": {
            str(k): round(float(np.mean([precision_at_k(y, s, k) for s in repeats])), 4)
            for k in PRECISION_KS if k <= len(y)
        },
    }
    return summary


def evaluate(frame: pd.DataFrame) -> dict:
    y = frame["label"].to_numpy(dtype=int)
    groups = frame["drug"].to_numpy()
    candidates = {
        "Logistic regression, all features": (make_logistic, ALL_FEATURES),
        "Logistic regression, disproportionality only": (make_logistic, FEATURE_GROUPS["disproportionality"]),
        "Gradient boosting, all features": (make_boosting, ALL_FEATURES),
    }
    results = {
        name: summarise(y, out_of_fold(factory, frame[cols].to_numpy(dtype=float), y, groups))
        for name, (factory, cols) in candidates.items()
    }
    baselines = {}
    for name, column in BASELINES.items():
        scores = frame[column].to_numpy(dtype=float)
        baselines[name] = {
            "auc": round(float(roc_auc_score(y, scores)), 4),
            "ap": round(float(average_precision_score(y, scores)), 4),
            "precision_at_k": {
                str(k): round(precision_at_k(y, scores, k), 4) for k in PRECISION_KS if k <= len(y)
            },
        }
    return {
        "protocol": (
            f"{len(REPEAT_SEEDS)}x repeated {N_SPLITS}-fold cross-validation grouped by drug; "
            "mean and SD across repeats. Baselines rank the same controls by one statistic."
        ),
        "n_labelled": int(len(y)),
        "n_positive": int(y.sum()),
        "n_negative": int((1 - y).sum()),
        "prevalence": round(float(y.mean()), 4),
        "candidates": results,
        "baselines": baselines,
    }


def choose_feature_set(evaluation: dict, requested: str) -> str:
    """'auto' keeps the case features only if they beat the simpler model by more than one SD."""
    if requested != "auto":
        return requested
    full = evaluation["candidates"]["Logistic regression, all features"]
    simple = evaluation["candidates"]["Logistic regression, disproportionality only"]
    margin = max(full["auc_sd"], simple["auc_sd"])
    return "all" if full["auc"] - simple["auc"] > margin else "disproportionality"


def fit_and_export(frame: pd.DataFrame, feature_set: str, evaluation: dict, training: dict, out: Path) -> dict:
    columns = ALL_FEATURES if feature_set == "all" else FEATURE_GROUPS["disproportionality"]
    x = frame[columns].to_numpy(dtype=float)
    y = frame["label"].to_numpy(dtype=int)
    pipeline = make_logistic().fit(x, y)
    imputer, scaler, classifier = pipeline.steps[0][1], pipeline.steps[1][1], pipeline.steps[2][1]
    has_data = ~np.isnan(x).all(axis=0)

    fitted = {
        name: {
            "weight": float(classifier.coef_[0][j]) if has_data[j] else 0.0,
            "mean": float(imputer.statistics_[j]),
            "std": float(scaler.scale_[j]),
            "used": bool(has_data[j]),
        }
        for j, name in enumerate(columns)
    }
    features = []
    for name in ALL_FEATURES:
        stats = fitted.get(name, {"weight": 0.0, "mean": 0.0, "std": 1.0, "used": False})
        features.append({
            "name": name,
            "label": FEATURE_LABELS[name],
            "group": FEATURE_GROUP_OF[name],
            "weight": round(stats["weight"], 6),
            "mean": round(stats["mean"], 6),
            "std": round(stats["std"], 6),
            "used": stats["used"],
        })

    chosen = (
        "Logistic regression, all features" if feature_set == "all"
        else "Logistic regression, disproportionality only"
    )
    spec = {
        "schema_version": 1,
        "model_type": "L2 logistic regression",
        "created": date.today().isoformat(),
        "feature_set": feature_set,
        "training": training,
        "evaluation": {**evaluation, "selected": chosen},
        "intercept": round(float(classifier.intercept_[0]), 6),
        "features": features,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    return spec


def print_report(coverage: dict, evaluation: dict, feature_set: str, out: Path) -> None:
    print(f"\nReports after de-duplication: {coverage['n_cases']:,}")
    print(
        f"Reference controls: {coverage['controls_total']} total, "
        f"{coverage['controls_drug_in_data']} with the drug present, "
        f"{coverage['controls_with_min_cases']} with enough reports to score"
    )
    if coverage["unmatched_drugs"]:
        shown = ", ".join(coverage["unmatched_drugs"][:12])
        more = len(coverage["unmatched_drugs"]) - 12
        print(f"Reference drugs not found in the data: {shown}" + (f" (+{more} more)" if more > 0 else ""))
    print(
        f"Labelled rows: {evaluation['n_labelled']} "
        f"({evaluation['n_positive']} positive, {evaluation['n_negative']} negative)"
    )
    print(f"\n{evaluation['protocol']}\n")
    print(f"{'Ranking method':<48}{'AUC':>8}{'AP':>8}")
    for name, m in evaluation["candidates"].items():
        print(f"{name:<48}{m['auc']:>8.3f}{m['ap']:>8.3f}   (AUC SD {m['auc_sd']:.3f})")
    for name, m in evaluation["baselines"].items():
        print(f"{'Baseline: ' + name:<48}{m['auc']:>8.3f}{m['ap']:>8.3f}")
    print(f"\nExported feature set: {feature_set}")
    print(f"Wrote {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--faers-dir", nargs="+", help="Unzipped FAERS quarterly ASCII folder(s)")
    source.add_argument("--synthetic", action="store_true", help="Train on the synthetic benchmark")
    parser.add_argument("--synthetic-cases", type=int, default=60_000)
    parser.add_argument("--min-cases", type=int, default=3)
    parser.add_argument("--features", choices=["auto", "all", "disproportionality"], default="auto")
    parser.add_argument("--out", default=str(MODEL_PATH))
    args = parser.parse_args()

    if args.synthetic:
        from make_synthetic_benchmark import write

        with tempfile.TemporaryDirectory() as tmp:
            print(f"Generating synthetic benchmark ({args.synthetic_cases:,} cases)...")
            tables = load_faers([write(tmp, args.synthetic_cases)])
        training = {
            "data": "synthetic",
            "description": (
                "Synthetic FAERS-shaped benchmark built around the reference-set drugs. "
                "Placeholder weights: retrain on real FAERS before relying on the ranking."
            ),
            "quarters": [],
        }
    else:
        print("Loading FAERS extracts...")
        tables = load_faers(args.faers_dir)
        training = {
            "data": "faers",
            "description": "FDA FAERS quarterly extracts, latest version of each case.",
            "quarters": tables.quarters,
        }

    frame, coverage = build_training_frame(tables, args.min_cases)
    counts = frame["label"].value_counts()
    if len(frame) < 40 or counts.get(1, 0) < 10 or counts.get(0, 0) < 10:
        raise SystemExit(
            f"Only {len(frame)} labelled controls have >= {args.min_cases} reports "
            f"({counts.get(1, 0)} positive, {counts.get(0, 0)} negative). "
            "Add more quarters before training."
        )

    evaluation = evaluate(frame)
    feature_set = choose_feature_set(evaluation, args.features)
    training.update({
        "reference_sets": ["OMOP (Ryan et al. 2013)", "EU-ADR (Coloma et al. 2013)"],
        "label_unit": "drug x health outcome of interest",
        "min_cases": args.min_cases,
        "n_cases": coverage["n_cases"],
        "superseded_versions_dropped": tables.superseded_versions_dropped,
        "controls_total": coverage["controls_total"],
        "controls_scored": coverage["controls_with_min_cases"],
    })
    out = Path(args.out)
    fit_and_export(frame, feature_set, evaluation, training, out)
    print_report(coverage, evaluation, feature_set, out)


if __name__ == "__main__":
    main()
