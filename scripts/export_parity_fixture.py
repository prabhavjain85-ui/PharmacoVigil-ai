#!/usr/bin/env python3
"""Write web/public/data/python-parity.json for browser pipeline checks."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from faers_signal_detection import build_case_level_table, compute_disproportionality, load_table
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

    pairs = build_case_level_table(demo, drug, reac)
    total_reports = int(pairs["primaryid"].nunique())
    context = CaseContext(demo=demo, drug=drug, outc=outc, indi=indi, ther=ther)
    signals = compute_disproportionality(pairs, min_cases=3, case_context=context, score=True)
    case_feats = case_level_features(pairs, context)
    feat_frame = build_feature_frame(signals, total_reports, case_feats)

    warfarin_gi = signals[
        (signals["drug"] == "WARFARIN")
        & (signals["adverse_event"] == "GASTROINTESTINAL HAEMORRHAGE")
    ].iloc[0]

    pair_records = []
    for idx, row in signals.iterrows():
        f_row = feat_frame.loc[idx]
        pair_records.append(
            {
                "drug": str(row["drug"]),
                "adverse_event": str(row["adverse_event"]),
                "case_count_a": int(row["case_count_a"]),
                "PRR": float(row["PRR"]),
                "ROR": float(row["ROR"]),
                "ROR_95CI_low": float(row["ROR_95CI_low"]),
                "chi_square": float(row["chi_square"]),
                "IC": float(row["IC"]),
                "IC025": float(row["IC025"]),
                "EB05": float(row["EB05"]),
                "priority_score": float(row["priority_score"]),
                "priority_rank": int(row["priority_rank"]),
                "features": {name: _clean_val(f_row[name]) for name in ALL_FEATURES},
            }
        )

    payload = {
        "case_count": int(demo["primaryid"].nunique()),
        "signal_count": int(len(signals)),
        "feature_names": list(ALL_FEATURES),
        "warfarin_gi": {
            "PRR": float(warfarin_gi["PRR"]),
            "IC025": float(warfarin_gi["IC025"]),
            "EB05": float(warfarin_gi["EB05"]),
            "case_count_a": int(warfarin_gi["case_count_a"]),
            "priority_score": float(warfarin_gi["priority_score"]),
        },
        "pairs": pair_records,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(pair_records)} pairs, {len(ALL_FEATURES)} features each)")


if __name__ == "__main__":
    main()
