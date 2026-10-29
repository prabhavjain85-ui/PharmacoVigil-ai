#!/usr/bin/env python3
"""Write web/public/data/python-parity.json for browser pipeline checks."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from faers_signal_detection import build_case_level_table, compute_disproportionality, load_table

OUT = ROOT / "web" / "public" / "data" / "python-parity.json"


def main() -> None:
    demo = load_table(str(ROOT / "sample_data" / "DEMO_sample.csv"))
    drug = load_table(str(ROOT / "sample_data" / "DRUG_sample.csv"))
    reac = load_table(str(ROOT / "sample_data" / "REAC_sample.csv"))
    pairs = build_case_level_table(demo, drug, reac)
    signals = compute_disproportionality(pairs, min_cases=3)
    warfarin_gi = signals[
        (signals["drug"] == "WARFARIN")
        & (signals["adverse_event"] == "GASTROINTESTINAL HAEMORRHAGE")
    ].iloc[0]
    payload = {
        "case_count": int(demo["primaryid"].nunique()),
        "signal_count": int(len(signals)),
        "warfarin_gi": {
            "PRR": float(warfarin_gi["PRR"]),
            "IC025": float(warfarin_gi["IC025"]),
            "EB05": float(warfarin_gi["EB05"]),
            "case_count_a": int(warfarin_gi["case_count_a"]),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
