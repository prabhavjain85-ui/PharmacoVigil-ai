#!/usr/bin/env python3
"""Export precomputed FAERS stats + ML outputs for the static Next.js site."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bayesian_stats import fit_gamma_poisson_prior, expected_count
from faers_signal_detection import (
    build_case_level_table,
    compute_disproportionality,
    load_table,
)
from ml_prioritization import DISPLAY_NAMES, FEATURE_COLUMNS, train_prioritization_model
from reference_signals import REFERENCE_POSITIVE_PAIRS

SAMPLE = ROOT / "sample_data"
OUT = ROOT / "web" / "public" / "data" / "site-bundle.json"


def contingency(row: dict, total_reports: int) -> dict:
    a = int(row["case_count_a"])
    drug_total = int(row["drug_total_reports"])
    event_total = int(row["event_total_reports"])
    b = drug_total - a
    c = event_total - a
    d = total_reports - drug_total - event_total + a
    return {"a": a, "b": b, "c": c, "d": d, "total_reports": total_reports}


def json_safe(records: list[dict]) -> list[dict]:
    for row in records:
        for key, value in list(row.items()):
            if hasattr(value, "item"):
                row[key] = value.item()
            elif isinstance(value, bool):
                row[key] = bool(value)
    return records


def main() -> None:
    demo = load_table(str(SAMPLE / "DEMO_sample.csv"))
    drug = load_table(str(SAMPLE / "DRUG_sample.csv"))
    reac = load_table(str(SAMPLE / "REAC_sample.csv"))
    pairs = build_case_level_table(demo, drug, reac)
    signals = compute_disproportionality(pairs, min_cases=3)
    records = json_safe(signals.to_dict(orient="records"))
    total = int(demo["primaryid"].nunique())

    observed = []
    expected = []
    for row in records:
        cells = contingency(row, total)
        observed.append(float(cells["a"]))
        expected.append(expected_count(cells["a"], cells["b"], cells["c"], cells["d"], total))
    prior = fit_gamma_poisson_prior(
        __import__("numpy").array(observed),
        __import__("numpy").array(expected),
    )

    by_drug: dict[str, list] = {}
    for row in records:
        by_drug.setdefault(row["drug"], []).append(row)

    drug_summaries = []
    for drug_name, rows in sorted(by_drug.items()):
        drug_summaries.append({
            "drug": drug_name,
            "report_count": int(rows[0]["drug_total_reports"]),
            "pair_count": len(rows),
            "signal_count": sum(1 for r in rows if r["signal_detected"]),
            "bcpnn_count": sum(1 for r in rows if r.get("signal_bcpnn")),
            "ebgm_count": sum(1 for r in rows if r.get("signal_ebgm")),
        })

    warfarin = sorted(by_drug.get("WARFARIN", []), key=lambda r: -r["PRR"])
    featured = warfarin[0] if warfarin else records[0]
    model = train_prioritization_model(signals, total)

    bundle = {
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "disclaimer": {
            "data": "Synthetic FAERS-style sample (~200 cases) committed in sample_data/. Not real post-marketing data.",
            "ml": "Gradient boosting trained on weak labels (planted demo pairs + small literature reference set). Triage aid only.",
            "nlp": "Rule-based keyword demo — not a validated clinical NLP model.",
        },
        "dataset": {
            "source": "sample_data",
            "case_count": total,
            "demo_rows": len(demo),
            "drug_rows": len(drug),
            "reac_rows": len(reac),
            "pair_count": len(pairs),
            "drug_count": len(drug_summaries),
        },
        "ebgm_prior": {"alpha": round(prior.alpha, 6), "beta": round(prior.beta, 6)},
        "featured_contingency": contingency(featured, total),
        "featured_pair": featured,
        "default_drug": "WARFARIN",
        "drugs": drug_summaries,
        "signals_by_drug": by_drug,
        "all_signals": records,
        "priority_top": sorted(records, key=lambda r: -(r.get("priority_score") or 0))[:12],
        "ml_meta": {
            "model": "GradientBoostingClassifier (scikit-learn)",
            "weak_label_count": len(REFERENCE_POSITIVE_PAIRS),
            "weak_labels_note": "Planted boosted_pairs in make_sample_data.py plus literature-aligned pairs in reference_signals.py.",
            "global_importance": [
                {
                    "feature": name,
                    "label": DISPLAY_NAMES.get(name, name),
                    "importance": round(float(model.global_importance[name]), 4),
                }
                for name in FEATURE_COLUMNS
            ],
        },
        "nlp_samples": [
            {
                "id": "case-1",
                "text": (
                    "65-year-old female on COUMADIN for atrial fibrillation. "
                    "Presented with melena and hemoglobin drop; endoscopy showed "
                    "gastrointestinal hemorrhage. Warfarin held. Onset ~10 days after dose increase."
                ),
                "note": "Fictional narrative for demo; brand maps to WARFARIN in the pipeline.",
            },
            {
                "id": "case-2",
                "text": (
                    "Patient taking LIPITOR 40mg developed severe muscle pain and weakness; "
                    "CK markedly elevated consistent with rhabdomyolysis. Simvastatin interaction suspected."
                ),
                "note": "Illustrates brand names and serious ADR keywords.",
            },
            {
                "id": "case-3",
                "text": (
                    "After amoxicillin for otitis, patient developed lip swelling and difficulty breathing "
                    "within 2 hours — treated as anaphylactic reaction. No prior penicillin allergy documented."
                ),
                "note": "Onset phrase and reaction terms for rule-based extraction.",
            },
        ],
        "references": [
            {
                "title": "FDA FAERS quarterly data files",
                "url": "https://www.fda.gov/drugs/questions-and-answers-fdas-adverse-event-reporting-system-faers/fda-adverse-event-reporting-system-faers-latest-quarterly-data-files",
            },
            {
                "title": "Evans et al. — Bayesian confidence propagation (BCPNN)",
                "url": "https://www.who-umc.org/",
            },
            {
                "title": "DuMouchel — Bayesian data mining in large frequency tables (EBGM/MGPS)",
                "url": "https://doi.org/10.1002/(SICI)1097-0258(19991215)18:23%3C3221::AID-SIM378%3E3.0.CO;2-L",
            },
            {
                "title": "ICH E2E — Pharmacovigilance planning",
                "url": "https://www.ich.org/",
            },
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    print(f"Wrote {OUT} ({len(records)} signals, {len(drug_summaries)} drugs)")


if __name__ == "__main__":
    main()
