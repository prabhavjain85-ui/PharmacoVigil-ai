#!/usr/bin/env python3
"""Write web/public/data/python-parity.json for browser pipeline checks."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from faers_signal_detection import (
    build_case_level_table,
    compute_disproportionality,
    compute_drug_interactions,
    compute_stratified_analysis,
    compute_temporal_signal_series,
    compute_weibull_for_pairs,
    deduplicate_demo_by_caseid,
    detect_probable_duplicates,
    load_table,
)
from pair_features import ALL_FEATURES, CaseContext, build_feature_frame, case_level_features

OUT = ROOT / "web" / "public" / "data" / "python-parity.json"


def _clean_val(v):
    if v is None:
        return None
    f = float(v)
    if math.isnan(f):
        return None
    return round(f, 6)


def main() -> None:
    sample_dir = ROOT / "sample_data"
    demo = load_table(str(sample_dir / "DEMO_sample.csv"))
    drug = load_table(str(sample_dir / "DRUG_sample.csv"))
    reac = load_table(str(sample_dir / "REAC_sample.csv"))
    outc = load_table(str(sample_dir / "OUTC_sample.csv"))
    indi = load_table(str(sample_dir / "INDI_sample.csv"))
    ther = load_table(str(sample_dir / "THER_sample.csv"))

    dedup_demo, version_dups = deduplicate_demo_by_caseid(demo)
    pairs = build_case_level_table(dedup_demo, drug, reac, deduplicate_cases=False)
    total_reports = int(pairs["primaryid"].nunique())

    context = CaseContext(demo=dedup_demo, drug=drug, outc=outc, indi=indi, ther=ther)
    signals = compute_disproportionality(pairs, min_cases=3, case_context=context, score=True)

    stratified_by_key = compute_stratified_analysis(dedup_demo, pairs, signals)
    weibull_by_key = compute_weibull_for_pairs(dedup_demo, pairs, ther, min_cases=10)
    probable_dups = detect_probable_duplicates(dedup_demo, drug, reac)
    interactions = compute_drug_interactions(pairs, total_reports=total_reports, min_co_cases=3)
    temporal_warfarin_gi = compute_temporal_signal_series(
        pairs, "WARFARIN", "GASTROINTESTINAL HAEMORRHAGE", "quarter"
    )

    case_feats = case_level_features(pairs, context)
    feat_frame = build_feature_frame(signals, total_reports, case_feats)

    warfarin_gi = signals[
        (signals["drug"] == "WARFARIN")
        & (signals["adverse_event"] == "GASTROINTESTINAL HAEMORRHAGE")
    ].iloc[0]
    w_key = "WARFARIN|GASTROINTESTINAL HAEMORRHAGE"
    w_strat = stratified_by_key[w_key]
    w_weibull = weibull_by_key.get(w_key)

    pair_records = []
    for idx, row in signals.iterrows():
        f_row = feat_frame.loc[idx]
        pkey = f"{row['drug']}|{row['adverse_event']}"
        strat = stratified_by_key.get(pkey, {})
        wb = weibull_by_key.get(pkey)
        pair_records.append(
            {
                "drug": str(row["drug"]),
                "adverse_event": str(row["adverse_event"]),
                "case_count_a": int(row["case_count_a"]),
                "PRR": float(row["PRR"]),
                "ROR": float(row["ROR"]),
                "ROR_95CI_low": float(row["ROR_95CI_low"]),
                "chi_square": float(row["chi_square"]),
                "p_value": float(row["p_value"]),
                "q_value": float(row["q_value"]),
                "signal_fdr": bool(row["signal_fdr"]),
                "IC": float(row["IC"]),
                "IC025": float(row["IC025"]),
                "EBGM": float(row["EBGM"]),
                "EB05": float(row["EB05"]),
                "PRR_MH": strat.get("adjusted_PRR_MH"),
                "ROR_MH": strat.get("adjusted_ROR_MH"),
                "IC_stratified": strat.get("stratified_IC"),
                "confounding_flagged": strat.get("confounding_flagged"),
                "weibull_shape": wb["shape_k"] if wb else None,
                "weibull_shape_ci_low": wb["shape_ci_low"] if wb else None,
                "weibull_shape_ci_high": wb["shape_ci_high"] if wb else None,
                "weibull_scale": wb["scale_lambda"] if wb else None,
                "weibull_regime": wb["regime"] if wb else None,
                "priority_score": float(row["priority_score"]),
                "priority_rank": int(row["priority_rank"]),
                "features": {name: _clean_val(f_row[name]) for name in ALL_FEATURES},
            }
        )

    payload = {
        "case_count": int(dedup_demo["primaryid"].nunique()),
        "version_duplicates_removed": int(version_dups),
        "probable_duplicates_count": len(probable_dups["flagged_pairs"]),
        "signal_count": int(len(signals)),
        "feature_names": list(ALL_FEATURES),
        "warfarin_gi": {
            "PRR": float(warfarin_gi["PRR"]),
            "IC025": float(warfarin_gi["IC025"]),
            "EBGM": float(warfarin_gi["EBGM"]),
            "EB05": float(warfarin_gi["EB05"]),
            "p_value": float(warfarin_gi["p_value"]),
            "q_value": float(warfarin_gi["q_value"]),
            "PRR_MH": w_strat["adjusted_PRR_MH"],
            "IC_stratified": w_strat["stratified_IC"],
            "weibull_shape": w_weibull["shape_k"] if w_weibull else None,
            "case_count_a": int(warfarin_gi["case_count_a"]),
            "priority_score": float(warfarin_gi["priority_score"]),
        },
        "interactions": interactions,
        "temporal_warfarin_gi": temporal_warfarin_gi,
        "pairs": pair_records,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(pair_records)} pairs, {len(ALL_FEATURES)} features each)")


if __name__ == "__main__":
    main()
