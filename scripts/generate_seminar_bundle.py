#!/usr/bin/env python3
"""Write public/seminar-demo-data.js from committed sample_data CSVs."""
from __future__ import annotations

import json
from pathlib import Path

from faers_signal_detection import (
    build_case_level_table,
    compute_disproportionality,
    load_table,
)

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "sample_data"
OUT = ROOT / "public" / "seminar-demo-data.js"


def contingency(row: dict, total_reports: int) -> dict:
    a = int(row["case_count_a"])
    drug_total = int(row["drug_total_reports"])
    event_total = int(row["event_total_reports"])
    b = drug_total - a
    c = event_total - a
    d = total_reports - drug_total - event_total + a
    return {"a": a, "b": b, "c": c, "d": d, "total_reports": total_reports}


def main() -> None:
    demo = load_table(str(SAMPLE / "DEMO_sample.csv"))
    drug = load_table(str(SAMPLE / "DRUG_sample.csv"))
    reac = load_table(str(SAMPLE / "REAC_sample.csv"))
    pairs = build_case_level_table(demo, drug, reac)
    signals = compute_disproportionality(pairs, min_cases=3)
    records = signals.to_dict(orient="records")
    for row in records:
        for key, value in list(row.items()):
            if hasattr(value, "item"):
                row[key] = value.item()

    total = int(demo["primaryid"].nunique())
    warfarin = sorted(
        [r for r in records if r["drug"] == "WARFARIN"],
        key=lambda r: -r["PRR"],
    )
    flagged = [r for r in records if r["signal_detected"]]
    featured = warfarin[0] if warfarin else (records[0] if records else {})

    bundle = {
        "dataset": {
            "source": "sample_data",
            "case_count": total,
            "demo_rows": len(demo),
            "drug_rows": len(drug),
            "reac_rows": len(reac),
            "pair_count": len(pairs),
            "drug_count": int(signals["drug"].nunique()),
        },
        "demo_drug": "WARFARIN",
        "warfarin_adrs": warfarin,
        "featured_contingency": contingency(featured, total) if featured else {},
        "featured_pair": featured,
        "all_flagged_signals": flagged,
        "all_results": records,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "/** Bundled sample FAERS disproportionality results for offline seminar demo */\n"
        f"window.SEMINAR_DEMO_DATA = {json.dumps(bundle, indent=2)};\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT} ({len(records)} pairs)")


if __name__ == "__main__":
    main()
