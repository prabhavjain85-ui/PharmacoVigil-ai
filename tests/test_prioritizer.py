"""Tests for reference sets, pair features, ML prioritisation, and training pipeline."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from faers_loader import load_faers
from faers_signal_detection import build_case_level_table, compute_disproportionality
from make_synthetic_benchmark import write as write_synthetic_benchmark
from ml_prioritization import PrioritizationModel, apply_prioritization, load_model, model_card
from pair_features import (
    ALL_FEATURES,
    CASE_FEATURES,
    DISPROPORTIONALITY_FEATURES,
    CaseContext,
    build_feature_frame,
    case_level_features,
)
from reference_sets import (
    HOI_PREFIX,
    load_reference_controls,
    map_event_to_hoi,
    reference_drug_name,
)
from train_prioritizer import build_training_frame, choose_feature_set, evaluate, fit_and_export


def test_reference_control_counts_and_uniqueness():
    controls = load_reference_controls()
    assert len(controls) == 485
    assert int((controls["label"] == 1).sum()) == 201
    assert int((controls["label"] == 0).sum()) == 284
    assert not controls.duplicated(subset=["drug", "adverse_event"]).any()


def test_pt_to_hoi_mapping():
    assert map_event_to_hoi("gastrointestinal haemorrhage") == f"{HOI_PREFIX}UPPER GI BLEEDING"
    assert map_event_to_hoi("Stevens-Johnson Syndrome") == f"{HOI_PREFIX}SEVERE CUTANEOUS REACTION"
    assert map_event_to_hoi("HEADACHE") == "HEADACHE"


def test_reference_drug_name_mapping():
    assert reference_drug_name("Coumadin") == "WARFARIN"
    assert reference_drug_name("Paracetamol sodium") == "ACETAMINOPHEN"
    assert reference_drug_name("Aciclovir") == "ACYCLOVIR"
    assert reference_drug_name("DivAlproex Sodium") == "VALPROATE"


def test_hand_built_case_level_features():
    demo = pd.DataFrame([
        {"primaryid": "1", "sex": "F", "age": "60", "age_cod": "YR", "occp_cod": "MD", "event_dt": "20240111"},
        {"primaryid": "2", "sex": "M", "age": "4", "age_cod": "DEC", "occp_cod": "CN", "event_dt": "20240201"},
    ])
    drug = pd.DataFrame([
        {"primaryid": "1", "drug_seq": "1", "role_cod": "PS", "drugname": "WARFARIN"},
        {"primaryid": "1", "drug_seq": "2", "role_cod": "C", "drugname": "ASPIRIN"},
        {"primaryid": "2", "drug_seq": "1", "role_cod": "SS", "drugname": "WARFARIN"},
    ])
    reac = pd.DataFrame([
        {"primaryid": "1", "pt": "MELAENA"},
        {"primaryid": "2", "pt": "MELAENA"},
    ])
    outc = pd.DataFrame([
        {"primaryid": "1", "outc_cod": "DE"},
        {"primaryid": "1", "outc_cod": "HO"},
        # Report 2 absent from OUTC -> counts as non-serious (0.0)
    ])
    indi = pd.DataFrame([
        {"primaryid": "1", "indi_drug_seq": "1", "indi_pt": "ATRIAL FIBRILLATION"},
        {"primaryid": "2", "indi_drug_seq": "1", "indi_pt": "MELAENA"},
    ])
    ther = pd.DataFrame([
        {"primaryid": "1", "dsg_drug_seq": "1", "start_dt": "20240101"},  # TTO = 10 days
        {"primaryid": "2", "dsg_drug_seq": "1", "start_dt": "20231201"},  # TTO = 62 days
    ])

    pairs = build_case_level_table(demo, drug, reac)
    ctx = CaseContext(demo=demo, drug=drug, outc=outc, indi=indi, ther=ther)
    cf = case_level_features(pairs, ctx)
    assert len(cf) == 1
    row = cf.iloc[0]

    assert row["frac_death"] == pytest.approx(0.5)
    assert row["frac_hosp_lt"] == pytest.approx(0.5)
    assert row["frac_serious"] == pytest.approx(0.5)
    assert row["frac_hcp"] == pytest.approx(0.5)
    assert row["frac_female"] == pytest.approx(0.5)
    assert row["mean_age"] == pytest.approx(50.0)  # (60 + 40) / 2
    assert row["log_median_tto"] == pytest.approx(math.log1p(36.0))  # median(10, 62) = 36
    assert row["frac_tto_30d"] == pytest.approx(0.5)  # 10 <= 30, 62 > 30
    assert row["log_mean_drugs"] == pytest.approx(math.log(1.5))  # (2 + 1) / 2 = 1.5
    assert row["frac_primary_suspect"] == pytest.approx(0.5)  # PS vs SS
    assert row["frac_event_is_indication"] == pytest.approx(0.5)  # only report 2


def test_case_features_nan_when_optional_tables_absent():
    demo = pd.DataFrame([{"primaryid": "1"}, {"primaryid": "2"}, {"primaryid": "3"}])
    drug = pd.DataFrame([
        {"primaryid": "1", "drugname": "WARFARIN"},
        {"primaryid": "2", "drugname": "WARFARIN"},
        {"primaryid": "3", "drugname": "WARFARIN"},
    ])
    reac = pd.DataFrame([
        {"primaryid": "1", "pt": "BLEED"},
        {"primaryid": "2", "pt": "BLEED"},
        {"primaryid": "3", "pt": "BLEED"},
    ])
    pairs = build_case_level_table(demo, drug, reac)
    cf = case_level_features(pairs, CaseContext(demo=demo))
    row = cf.iloc[0]
    for name, _ in CASE_FEATURES:
        assert math.isnan(float(row[name])), f"Expected {name} to be NaN when optional columns/tables absent"


def test_tto_bounds_and_partial_dates():
    demo = pd.DataFrame([
        {"primaryid": "1", "event_dt": "202401"},    # partial date -> missing
        {"primaryid": "2", "event_dt": "20240101"},  # negative TTO -> missing
        {"primaryid": "3", "event_dt": "20240121"},  # valid 20 days
    ])
    drug = pd.DataFrame([
        {"primaryid": "1", "drug_seq": "1", "drugname": "WARFARIN"},
        {"primaryid": "2", "drug_seq": "1", "drugname": "WARFARIN"},
        {"primaryid": "3", "drug_seq": "1", "drugname": "WARFARIN"},
    ])
    reac = pd.DataFrame([
        {"primaryid": "1", "pt": "MELAENA"},
        {"primaryid": "2", "pt": "MELAENA"},
        {"primaryid": "3", "pt": "MELAENA"},
    ])
    ther = pd.DataFrame([
        {"primaryid": "1", "dsg_drug_seq": "1", "start_dt": "20240101"},
        {"primaryid": "2", "dsg_drug_seq": "1", "start_dt": "20240201"},
        {"primaryid": "3", "dsg_drug_seq": "1", "start_dt": "20240101"},
    ])
    pairs = build_case_level_table(demo, drug, reac)
    cf = case_level_features(pairs, CaseContext(demo=demo, drug=drug, ther=ther)).iloc[0]
    assert cf["log_median_tto"] == pytest.approx(math.log1p(20.0))
    assert cf["frac_tto_30d"] == pytest.approx(1.0)


def test_signed_contributions_and_missing_value_imputation():
    spec = {
        "schema_version": 1,
        "model_type": "L2 logistic regression",
        "created": "2026-11-11",
        "feature_set": "all",
        "training": {},
        "evaluation": {},
        "intercept": -0.25,
        "features": [
            {"name": "ic", "label": "IC", "group": "disproportionality", "weight": 0.8, "mean": 1.0, "std": 2.0, "used": True},
            {"name": "log_prr", "label": "log PRR", "group": "disproportionality", "weight": -0.5, "mean": 0.5, "std": 1.0, "used": True},
            {"name": "frac_death", "label": "Fatal fraction", "group": "case", "weight": 1.2, "mean": 0.1, "std": 0.2, "used": True},
        ] + [
            {"name": n, "label": n, "group": "case", "weight": 0.0, "mean": 0.0, "std": 1.0, "used": False}
            for n in ALL_FEATURES if n not in {"ic", "log_prr", "frac_death"}
        ],
    }
    model = PrioritizationModel(spec)
    row_data = {n: 0.0 for n in ALL_FEATURES}
    row_data["ic"] = 3.0          # z = (3 - 1) / 2 = +1.0 -> contrib = +0.8
    row_data["log_prr"] = 1.5     # z = (1.5 - 0.5) / 1 = +1.0 -> contrib = -0.5
    row_data["frac_death"] = np.nan  # missing -> contrib = 0.0
    frame = pd.DataFrame([row_data])

    probs, contrib = model.score(frame)
    assert contrib["ic"].iloc[0] == pytest.approx(0.8)
    assert contrib["log_prr"].iloc[0] == pytest.approx(-0.5)
    assert contrib["frac_death"].iloc[0] == pytest.approx(0.0)

    expected_logit = spec["intercept"] + float(contrib.iloc[0].sum())
    actual_logit = math.log(probs[0] / (1.0 - probs[0]))
    assert actual_logit == pytest.approx(expected_logit)

    batch = model.predict_batch(frame)
    driver_names = [d["feature"] for d in batch[0]["priority_explain"]]
    assert "frac_death" not in driver_names


def test_restrict_to_leaves_disproportionality_unchanged():
    demo = pd.read_csv("sample_data/DEMO_sample.csv", dtype=str)
    drug = pd.read_csv("sample_data/DRUG_sample.csv", dtype=str)
    reac = pd.read_csv("sample_data/REAC_sample.csv", dtype=str)
    pairs = build_case_level_table(demo, drug, reac)

    full = compute_disproportionality(pairs, min_cases=3, score=False)
    target = ("WARFARIN", "GASTROINTESTINAL HAEMORRHAGE")
    restricted = compute_disproportionality(pairs, min_cases=3, restrict_to={target}, score=False)

    assert len(restricted) == 1
    full_row = full[(full["drug"] == target[0]) & (full["adverse_event"] == target[1])].iloc[0]
    rest_row = restricted.iloc[0]
    for col in ("PRR", "ROR", "ROR_95CI_low", "chi_square", "IC", "IC025", "EBGM", "EB05"):
        assert rest_row[col] == full_row[col]


def test_model_card_and_default_model():
    card = model_card()
    assert card["model_type"] == "L2 logistic regression"
    assert len(card["features"]) == len(ALL_FEATURES)
    assert "selected" in card["evaluation"]


def test_end_to_end_synthetic_training_and_reload(tmp_path: Path):
    bench_dir = write_synthetic_benchmark(tmp_path / "bench", n_cases=4000, seed=11)
    tables = load_faers([bench_dir])
    frame, coverage = build_training_frame(tables, min_cases=2)
    assert len(frame) >= 40
    assert coverage["controls_total"] == 485

    evaluation = evaluate(frame)
    feature_set = choose_feature_set(evaluation, "auto")
    out_json = tmp_path / "model.json"
    training_meta = {
        "data": "synthetic",
        "description": "Test synthetic run",
        "quarters": [],
        "reference_sets": ["OMOP", "EU-ADR"],
        "label_unit": "drug x HOI",
        "min_cases": 2,
        "n_cases": coverage["n_cases"],
        "superseded_versions_dropped": tables.superseded_versions_dropped,
        "controls_total": coverage["controls_total"],
        "controls_scored": coverage["controls_with_min_cases"],
    }
    fit_and_export(frame, feature_set, evaluation, training_meta, out_json)
    reloaded = load_model(out_json)
    scored = apply_prioritization(frame.drop(columns=["label", "source", "indication"]), reloaded, coverage["n_cases"])
    assert "priority_score" in scored.columns
    assert scored["priority_score"].between(0.0, 1.0).all()
