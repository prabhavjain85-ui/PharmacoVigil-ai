"""Integration tests for extended disproportionality pipeline."""
from faers_signal_detection import (
    build_case_level_table,
    compute_disproportionality,
    load_table,
)


def test_sample_data_includes_bayesian_and_ml_columns():
    demo = load_table("sample_data/DEMO_sample.csv")
    drug = load_table("sample_data/DRUG_sample.csv")
    reac = load_table("sample_data/REAC_sample.csv")
    pairs = build_case_level_table(demo, drug, reac)
    signals = compute_disproportionality(pairs, min_cases=3)
    assert not signals.empty
    for col in (
        "IC", "IC025", "EBGM", "EB05", "signal_bcpnn", "signal_ebgm",
        "priority_score", "priority_rank",
    ):
        assert col in signals.columns
    warfarin_gi = signals[
        (signals["drug"] == "WARFARIN")
        & (signals["adverse_event"] == "GASTROINTESTINAL HAEMORRHAGE")
    ]
    assert len(warfarin_gi) == 1
    row = warfarin_gi.iloc[0]
    assert row["signal_detected"]
    assert row["priority_score"] is not None
    assert int(row["priority_rank"]) <= 5
    assert float(row["priority_score"]) >= 0.4
