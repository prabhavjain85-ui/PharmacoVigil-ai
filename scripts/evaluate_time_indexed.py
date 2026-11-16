"""
Time-indexed historical pharmacovigilance evaluation (`scripts/evaluate_time_indexed.py`).

Evaluates disproportionality (`PRR`, `ROR`, `IC025`, `EB05`) and the trained ML prioritizer
strictly on FAERS reports whose `DEMO.event_dt` precedes a sequence of historical cutoff dates
(`20231231`, `20240331`, `20240515`, `20240630`) against `reference_data/time_indexed_reference_set.csv`
(Harpaz et al., Clin Pharmacol Ther 2014;96(2):239-246 / OMOP / EU-ADR / FDA SrLC).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from drug_mapping import canonicalize_drug
from faers_loader import load_faers
from faers_signal_detection import (
    build_case_level_table,
    compute_disproportionality,
    normalize_pt,
)
from pair_features import CaseContext
from reference_sets import FAERS_TO_REFERENCE_DRUG


def map_to_ref_drug(raw_drug: str) -> str:
    c = canonicalize_drug(raw_drug)
    return FAERS_TO_REFERENCE_DRUG.get(c, c)


def evaluate_at_cutoff(
    demo: pd.DataFrame,
    drug: pd.DataFrame,
    reac: pd.DataFrame,
    outc: pd.DataFrame | None,
    indi: pd.DataFrame | None,
    ther: pd.DataFrame | None,
    ref_df: pd.DataFrame,
    cutoff_date: str,
    min_cases: int = 3,
) -> dict[str, Any]:
    """Filter FAERS reports strictly to valid 8-digit event_dt <= cutoff_date and score reference set."""
    ev_dt = demo["event_dt"].astype(str).str.strip()
    valid_mask = ev_dt.str.match(r"^\d{8}$") & (ev_dt <= cutoff_date) & (ev_dt >= "20000101")
    demo_sub = demo[valid_mask].copy()
    valid_pids = set(demo_sub["primaryid"].astype(str))

    drug_sub = drug[drug["primaryid"].isin(valid_pids)].copy()
    reac_sub = reac[reac["primaryid"].isin(valid_pids)].copy()
    outc_sub = outc[outc["primaryid"].isin(valid_pids)].copy() if outc is not None else None
    indi_sub = indi[indi["primaryid"].isin(valid_pids)].copy() if indi is not None else None
    ther_sub = ther[ther["primaryid"].isin(valid_pids)].copy() if ther is not None else None

    pairs = build_case_level_table(demo_sub, drug_sub, reac_sub)
    if not pairs.empty:
        pairs["drugname"] = pairs["drugname"].map(map_to_ref_drug)
        pairs = pairs.drop_duplicates(subset=["primaryid", "drugname", "pt"])

    ref_pairs: set[tuple[str, str]] = {
        (map_to_ref_drug(str(r["drug"])), normalize_pt(str(r["adverse_event"])))
        for r in ref_df.to_dict(orient="records")
    }
    pairs_for_features = pairs[
        pairs.set_index(["drugname", "pt"]).index.isin(ref_pairs)
    ].copy()

    ctx = CaseContext(
        demo=demo_sub,
        drug=drug_sub,
        outc=outc_sub,
        indi=indi_sub,
        ther=ther_sub,
    )
    from ml_prioritization import apply_prioritization, load_model
    from pair_features import case_level_features

    signals = compute_disproportionality(
        pairs,
        min_cases=min_cases,
        case_context=None,
        restrict_to=ref_pairs,
        score=False,
    )
    if not signals.empty:
        total_reports = int(pairs["primaryid"].nunique())
        case_feats = case_level_features(pairs_for_features, ctx)
        signals = apply_prioritization(signals, load_model(), total_reports, case_feats)

    # Total eligible signals across the entire pre-cutoff cohort (for reporting):
    total_eligible_signals = int(
        (pairs.groupby(["drugname", "pt"])["primaryid"].nunique() >= min_cases).sum()
    ) if not pairs.empty else 0
    del pairs_for_features
    sig_map: dict[tuple[str, str], dict[str, Any]] = {}
    for row in signals.to_dict(orient="records"):
        sig_map[(str(row["drug"]), str(row["adverse_event"]))] = row

    scored_rows: list[dict[str, Any]] = []
    for ref in ref_df.to_dict(orient="records"):
        d = map_to_ref_drug(str(ref["drug"]))
        ev = normalize_pt(str(ref["adverse_event"]))
        lbl = int(ref["label"])
        hit = sig_map.get((d, ev))
        if hit is None:
            scored_rows.append({
                "drug": d,
                "adverse_event": ev,
                "label": lbl,
                "source": ref["source"],
                "present_ge_min_cases": False,
                "case_count_a": 0,
                "PRR": None,
                "IC025": None,
                "EB05": None,
                "priority_score": None,
                "flagged_prr": False,
                "flagged_bcpnn": False,
                "flagged_ebgm": False,
            })
        else:
            scored_rows.append({
                "drug": d,
                "adverse_event": ev,
                "label": lbl,
                "source": ref["source"],
                "present_ge_min_cases": True,
                "case_count_a": int(hit["case_count_a"]),
                "PRR": float(hit["PRR"]),
                "IC025": float(hit["IC025"]),
                "EB05": float(hit["EB05"]),
                "priority_score": float(hit["priority_score"]) if hit.get("priority_score") is not None else None,
                "flagged_prr": bool(hit["signal_detected"]),
                "flagged_bcpnn": bool(hit["signal_bcpnn"]),
                "flagged_ebgm": bool(hit["signal_ebgm"]),
            })

    present = [r for r in scored_rows if r["present_ge_min_cases"]]
    pos_total = sum(1 for r in scored_rows if r["label"] == 1)
    neg_total = sum(1 for r in scored_rows if r["label"] == 0)
    pos_present = [r for r in present if r["label"] == 1]
    neg_present = [r for r in present if r["label"] == 0]

    def calc_detector_metrics(flag_key: str) -> dict[str, Any]:
        tp = sum(1 for r in pos_present if r[flag_key])
        fn_scored = sum(1 for r in pos_present if not r[flag_key])
        fp = sum(1 for r in neg_present if r[flag_key])
        tn = sum(1 for r in neg_present if not r[flag_key])
        sens_scored = round(tp / len(pos_present), 4) if pos_present else 0.0
        sens_all = round(tp / pos_total, 4) if pos_total else 0.0
        spec_scored = round(tn / len(neg_present), 4) if neg_present else 0.0
        ppv = round(tp / (tp + fp), 4) if (tp + fp) > 0 else 0.0
        return {
            "tp": tp,
            "fp": fp,
            "tn": tn,
            "fn_among_scored": fn_scored,
            "sensitivity_among_scored": sens_scored,
            "sensitivity_all_reference_positives": sens_all,
            "specificity_among_scored": spec_scored,
            "ppv": ppv,
        }

    auc_ml = None
    ap_ml = None
    auc_ic025 = None
    if len(pos_present) >= 2 and len(neg_present) >= 2:
        y_true = [r["label"] for r in present]
        y_ml = [r["priority_score"] or 0.0 for r in present]
        y_ic = [r["IC025"] or 0.0 for r in present]
        auc_ml = round(float(roc_auc_score(y_true, y_ml)), 4)
        ap_ml = round(float(average_precision_score(y_true, y_ml)), 4)
        auc_ic025 = round(float(roc_auc_score(y_true, y_ic)), 4)

    return {
        "cutoff_date": cutoff_date,
        "cases_with_event_dt_le_cutoff": int(len(demo_sub)),
        "total_pair_rows": int(len(pairs)),
        "total_signals_evaluated": total_eligible_signals,
        "reference_controls_total": len(scored_rows),
        "reference_positives_total": pos_total,
        "reference_negatives_total": neg_total,
        "reference_controls_scored_ge_min_cases": len(present),
        "reference_positives_scored": len(pos_present),
        "reference_negatives_scored": len(neg_present),
        "ranking_metrics_on_scored": {
            "ml_prioritizer_auc": auc_ml,
            "ml_prioritizer_ap": ap_ml,
            "bcpnn_ic025_auc": auc_ic025,
        },
        "detectors": {
            "PRR_ge_2_chi2_ge_4": calc_detector_metrics("flagged_prr"),
            "BCPNN_IC025_gt_0": calc_detector_metrics("flagged_bcpnn"),
            "MGPS_EB05_ge_2": calc_detector_metrics("flagged_ebgm"),
        },
        "pairs": scored_rows if cutoff_date == "20240515" else None,
    }


def main() -> None:
    faers_dir = Path("/tmp/faers_raw/2024q2/ASCII")
    if not faers_dir.exists():
        raise FileNotFoundError(f"Expected FAERS directory at {faers_dir}")

    print(f"Loading FAERS data from {faers_dir}...")
    tables = load_faers([faers_dir])
    ref_path = ROOT / "reference_data" / "time_indexed_reference_set.csv"
    ref_df = pd.read_csv(ref_path)

    cutoffs = ["20231231", "20240331", "20240515", "20240630"]
    cutoff_results = []
    for c_dt in cutoffs:
        print(f"Evaluating historical cutoff event_dt <= {c_dt}...")
        res = evaluate_at_cutoff(
            tables.demo,
            tables.drug,
            tables.reac,
            tables.outc,
            tables.indi,
            tables.ther,
            ref_df,
            c_dt,
            min_cases=3,
        )
        cutoff_results.append(res)
        print(
            f"  cutoff={c_dt}: cases={res['cases_with_event_dt_le_cutoff']:,}, "
            f"scored={res['reference_controls_scored_ge_min_cases']}/{res['reference_controls_total']} "
            f"(+{res['reference_positives_scored']}/-{res['reference_negatives_scored']}), "
            f"IC025 sens={res['detectors']['BCPNN_IC025_gt_0']['sensitivity_among_scored']} "
            f"spec={res['detectors']['BCPNN_IC025_gt_0']['specificity_among_scored']}, "
            f"ML AUC={res['ranking_metrics_on_scored']['ml_prioritizer_auc']}"
        )

    out_payload = {
        "benchmark": "Time-Indexed Historical Pharmacovigilance Evaluation",
        "reference_set_file": "reference_data/time_indexed_reference_set.csv",
        "methodology": (
            "FAERS 2024Q2 reports are filtered strictly by 8-digit DEMO.event_dt <= cutoff_date "
            "(excluding reports with missing, partial, or post-cutoff event dates). "
            "Disproportionality (PRR, ROR, BCPNN IC025, MGPS EB05) and ML priority scores are "
            "computed strictly on pre-cutoff reports and evaluated against 60 published time-indexed "
            "positive and negative drug-event controls (Harpaz et al. CPT 2014 / OMOP / EU-ADR / FDA SrLC)."
        ),
        "cutoffs": cutoff_results,
    }
    out_file = ROOT / "evaluation" / "time_indexed_evaluation.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(out_payload, indent=2) + "\n", encoding="utf-8")
    print(f"Saved time-indexed evaluation results to {out_file}")


if __name__ == "__main__":
    main()
