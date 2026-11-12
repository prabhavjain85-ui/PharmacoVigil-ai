"""FAERS Adverse Drug Reaction Signal Detection Pipeline
======================================================
Computes disproportionality signals (PRR, ROR, BCPNN IC, EBGM), Benjamini-Hochberg FDR
q-values, caseid version deduplication, probable-duplicate detection across caseids,
Mantel-Haenszel age x sex stratified estimates, Weibull time-to-onset shapes,
temporal cumulative IC + Poisson LLR / CUSUM change-points, and Norén et al. (2008)
Omega drug-drug interaction signals.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import math
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from bayesian_stats import (
    _js_round,
    bcpnn,
    benjamini_hochberg,
    compute_mantel_haenszel,
    compute_omega_interaction,
    ebgm_pair,
    expected_count,
    fit_gamma_poisson_prior,
    fit_weibull_tto,
)
from drug_mapping import canonicalize_drug

SERIOUS_ADVERSE_EVENTS = frozenset({
    "GASTROINTESTINAL HAEMORRHAGE",
    "ANAPHYLACTIC REACTION",
    "HEPATIC FAILURE",
    "RHABDOMYOLYSIS",
    "ANGIOEDEMA",
    "DYSPNOEA",
})

SIGNAL_COLUMNS = [
    "drug",
    "adverse_event",
    "case_count_a",
    "drug_total_reports",
    "event_total_reports",
    "PRR",
    "ROR",
    "ROR_95CI_low",
    "ROR_95CI_high",
    "chi_square",
    "p_value",
    "q_value",
    "signal_fdr",
    "IC",
    "IC025",
    "IC975",
    "signal_bcpnn",
    "EBGM",
    "EB05",
    "EB95",
    "signal_ebgm",
    "serious_event",
    "signal_detected",
    "priority_score",
    "priority_rank",
    "priority_explain",
]

AGE_UNIT_TO_YEARS: dict[str, float] = {
    "YR": 1.0,
    "DEC": 10.0,
    "MON": 1.0 / 12.0,
    "WK": 1.0 / 52.18,
    "DY": 1.0 / 365.25,
    "HR": 1.0 / 8766.0,
}


def load_table(path: str) -> pd.DataFrame:
    """Load a FAERS table, auto-detecting comma, dollar, pipe, or tab delimiters."""
    errors = []
    for sep in [",", "$", "|", "\t"]:
        try:
            df = pd.read_csv(path, sep=sep, dtype=str, low_memory=False)
            if df.shape[1] > 1:
                df.columns = [str(column).lstrip("\ufeff").strip().lower() for column in df.columns]
                return df
        except Exception as exc:
            errors.append(str(exc))

    detail = f": {errors[-1]}" if errors else ""
    raise ValueError(f"Could not parse {path} with any known FAERS delimiter{detail}")


def normalize_drug_name(name: str) -> str:
    """Apply salt/formulation stripping and alias-to-canonical drug mapping."""
    if pd.isna(name):
        return name
    return canonicalize_drug(str(name))


def normalize_pt(term: str) -> str:
    """Normalize MedDRA Preferred Term text."""
    if pd.isna(term):
        return term
    return " ".join(str(term).strip().upper().split())


def _require_columns(frame: pd.DataFrame, required: set[str], table_name: str) -> None:
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"{table_name} missing required columns: {', '.join(missing)}")


def deduplicate_demo_by_caseid(demo: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """
    Reuses the FAERS case-version deduplication rule from faers_loader.py:
    When DEMO has both caseid and caseversion, keep only the latest caseversion
    per caseid, then deduplicate on primaryid.
    """
    _require_columns(demo, {"primaryid"}, "DEMO")
    if demo.empty:
        return demo.copy(), 0

    before = len(demo)
    df = demo.copy()
    df["primaryid"] = df["primaryid"].astype("string").str.strip()
    df = df[df["primaryid"].notna() & (df["primaryid"] != "")].reset_index(drop=True)

    if {"caseid", "caseversion"} <= set(df.columns):
        df["_orig_idx"] = np.arange(len(df))
        caseid_clean = df["caseid"].fillna("").astype(str).str.strip()
        version = pd.to_numeric(df["caseversion"], errors="coerce").fillna(0)
        df = df.assign(_caseid=caseid_clean, _version=version)

        with_cid = df[df["_caseid"] != ""].sort_values(["_caseid", "_version", "_orig_idx"])
        with_cid = with_cid.drop_duplicates("_caseid", keep="last")
        without_cid = df[df["_caseid"] == ""]

        combined = pd.concat([with_cid, without_cid], ignore_index=True)
        combined = combined.sort_values("_orig_idx").drop(columns=["_orig_idx", "_caseid", "_version"])
        df = combined.reset_index(drop=True)

    df = df.drop_duplicates("primaryid", keep="first").reset_index(drop=True)
    dropped = max(0, before - len(df))
    return df, dropped


def build_case_level_table(
    demo: pd.DataFrame,
    drug: pd.DataFrame,
    reac: pd.DataFrame,
    *,
    deduplicate_cases: bool = True,
    exclude_primaryids: set[str] | None = None,
) -> pd.DataFrame:
    """Collapse input tables to one row per case, canonical drug, and reaction."""
    _require_columns(demo, {"primaryid"}, "DEMO")
    _require_columns(drug, {"primaryid", "drugname"}, "DRUG")
    _require_columns(reac, {"primaryid", "pt"}, "REAC")

    demo_clean = deduplicate_demo_by_caseid(demo)[0] if deduplicate_cases else demo.copy()
    drug = drug.copy()
    reac = reac.copy()

    for frame in (demo_clean, drug, reac):
        frame["primaryid"] = frame["primaryid"].astype("string").str.strip()

    if exclude_primaryids:
        demo_clean = demo_clean[~demo_clean["primaryid"].isin(exclude_primaryids)]

    valid_cases = set(demo_clean["primaryid"].dropna())
    drug = drug[drug["primaryid"].isin(valid_cases)].copy()
    reac = reac[reac["primaryid"].isin(valid_cases)].copy()

    drug["drugname"] = drug["drugname"].apply(normalize_drug_name)
    reac["pt"] = reac["pt"].apply(normalize_pt)

    drug = drug.dropna(subset=["primaryid", "drugname"])
    reac = reac.dropna(subset=["primaryid", "pt"])
    drug = drug[drug["drugname"] != ""]
    reac = reac[reac["pt"] != ""]

    if "role_cod" in drug.columns:
        roles = drug["role_cod"].astype("string").str.strip().str.upper()
        drug = drug[roles.isin(["PS", "SS"])]

    merged = drug.merge(reac, on="primaryid", how="inner", suffixes=("_drug", "_reac"))
    deduped = merged.drop_duplicates(subset=["primaryid", "drugname", "pt"]).copy()
    if "event_dt" in demo_clean.columns:
        ev_map = demo_clean.set_index("primaryid")["event_dt"].to_dict()
        deduped["event_dt"] = deduped["primaryid"].map(ev_map)
    return deduped


def _parse_faers_date_ms(raw: Any) -> int | None:
    if pd.isna(raw):
        return None
    text = str(raw).strip()
    if len(text) != 8 or not text.isdigit():
        return None
    y = int(text[:4])
    m = int(text[4:6])
    d = int(text[6:8])
    if m < 1 or m > 12 or d < 1 or d > 31:
        return None
    try:
        dt = datetime(y, m, d, tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def _parse_age_years(row: dict[str, Any]) -> float | None:
    raw = str(row.get("age") or "").strip()
    if not raw or raw.lower() == "nan":
        return None
    try:
        num = float(raw)
    except ValueError:
        return None
    if not math.isfinite(num):
        return None
    unit = str(row.get("age_cod") or "YR").strip().upper() or "YR"
    mult = AGE_UNIT_TO_YEARS.get(unit, 1.0)
    yrs = num * mult
    return _js_round(yrs, 2) if 0 <= yrs <= 120 else None


def detect_probable_duplicates(
    demo: pd.DataFrame,
    drug: pd.DataFrame,
    reac: pd.DataFrame,
    *,
    threshold: float = 0.72,
) -> dict[str, Any]:
    """
    Probable-duplicate detection across different caseids.
    Scores pairs of reports on suspect drugs, reactions, event_dt, age, sex, and country.
    """
    dedup_demo, _ = deduplicate_demo_by_caseid(demo)
    if len(dedup_demo) < 2:
        return {"flagged_pairs": [], "flagged_secondary_primaryids": []}

    valid_pids = set(dedup_demo["primaryid"].astype(str).str.strip())
    drugs_by_pid: dict[str, set[str]] = {}
    reacs_by_pid: dict[str, set[str]] = {}

    for r in drug.to_dict(orient="records"):
        pid = str(r.get("primaryid") or "").strip()
        raw_name = str(r.get("drugname") or "").strip()
        if not pid or not raw_name or pid not in valid_pids:
            continue
        role = str(r.get("role_cod") or "").strip().upper()
        if role and role not in ("PS", "SS"):
            continue
        canonical = canonicalize_drug(raw_name)
        if canonical:
            drugs_by_pid.setdefault(pid, set()).add(canonical)

    for r in reac.to_dict(orient="records"):
        pid = str(r.get("primaryid") or "").strip()
        pt = normalize_pt(str(r.get("pt") or ""))
        if pid and pt and pid in valid_pids:
            reacs_by_pid.setdefault(pid, set()).add(pt)

    profiles: list[dict[str, Any]] = []
    by_drug: dict[str, list[int]] = {}

    for row in dedup_demo.to_dict(orient="records"):
        pid = str(row.get("primaryid") or "").strip()
        d_set = drugs_by_pid.get(pid)
        r_set = reacs_by_pid.get(pid)
        if not d_set or not r_set:
            continue
        drugs_list = sorted(d_set)
        reacs_list = sorted(r_set)
        idx = len(profiles)
        cid_raw = str(row.get("caseid") or "").strip()
        cid = cid_raw if (cid_raw and cid_raw.lower() != "nan") else pid
        ev_str = str(row.get("event_dt") or "").strip()
        if ev_str.lower() == "nan":
            ev_str = ""
        age_str = str(row.get("age") or "").strip()
        if age_str.lower() == "nan":
            age_str = ""
        sex_str = str(row.get("sex") or "").strip().upper()
        if sex_str.lower() == "nan":
            sex_str = ""
        country_str = str(
            row.get("occr_country") or row.get("reporter_country") or row.get("country") or ""
        ).strip().upper()
        if country_str.lower() == "nan":
            country_str = ""

        profiles.append({
            "pid": pid,
            "caseid": cid,
            "eventDtStr": ev_str,
            "eventMs": _parse_faers_date_ms(ev_str),
            "ageStr": age_str,
            "ageYrs": _parse_age_years(row),
            "sex": sex_str,
            "country": country_str,
            "drugs": drugs_list,
            "reacs": reacs_list,
        })

        for d_name in drugs_list:
            bucket = by_drug.setdefault(d_name, [])
            if len(bucket) < 500:
                bucket.append(idx)

    compared: set[str] = set()
    flagged_pairs: list[dict[str, Any]] = []

    for indices in by_drug.values():
        length = len(indices)
        for i in range(length):
            a = profiles[indices[i]]
            for j in range(i + 1, length):
                b = profiles[indices[j]]
                if a["caseid"] == b["caseid"]:
                    continue
                first, second = (a, b) if a["pid"] < b["pid"] else (b, a)
                pair_key = f"{first['pid']}|{second['pid']}"
                if pair_key in compared:
                    continue
                compared.add(pair_key)

                shared_reactions = [pt for pt in first["reacs"] if pt in second["reacs"]]
                if not shared_reactions:
                    continue
                shared_drugs = [d for d in first["drugs"] if d in second["drugs"]]
                if not shared_drugs:
                    continue

                union_drugs = len(set(first["drugs"]) | set(second["drugs"]))
                union_reacs = len(set(first["reacs"]) | set(second["reacs"]))
                drug_jaccard = len(shared_drugs) / union_drugs
                reac_jaccard = len(shared_reactions) / union_reacs

                matching_fields: list[str] = []
                if drug_jaccard >= 0.5:
                    matching_fields.append("suspect_drugs")
                if reac_jaccard >= 0.5:
                    matching_fields.append("reactions")

                date_score = 0.0
                if first["eventDtStr"] and first["eventDtStr"] == second["eventDtStr"]:
                    date_score = 1.0
                    matching_fields.append("event_dt")
                elif first["eventMs"] is not None and second["eventMs"] is not None:
                    diff_days = abs(first["eventMs"] - second["eventMs"]) / 86_400_000.0
                    if diff_days <= 7:
                        date_score = 0.7
                        matching_fields.append("event_dt (±7d)")
                    elif diff_days <= 30:
                        date_score = 0.3

                age_score = 0.0
                if first["ageYrs"] is not None and second["ageYrs"] is not None:
                    diff_age = abs(first["ageYrs"] - second["ageYrs"])
                    if diff_age == 0:
                        age_score = 1.0
                        matching_fields.append("age")
                    elif diff_age <= 2:
                        age_score = 0.7
                        matching_fields.append("age (±2y)")

                sex_score = 0.0
                if first["sex"] in ("M", "F") and first["sex"] == second["sex"]:
                    sex_score = 1.0
                    matching_fields.append("sex")

                country_score = 0.0
                if first["country"] and first["country"] == second["country"]:
                    country_score = 1.0
                    matching_fields.append("country")

                total_score = (
                    0.3 * drug_jaccard
                    + 0.25 * reac_jaccard
                    + 0.15 * date_score
                    + 0.12 * age_score
                    + 0.1 * sex_score
                    + 0.08 * country_score
                )

                if total_score >= threshold:
                    flagged_pairs.append({
                        "primaryid_a": first["pid"],
                        "primaryid_b": second["pid"],
                        "caseid_a": first["caseid"],
                        "caseid_b": second["caseid"],
                        "score": _js_round(total_score, 4),
                        "matching_fields": matching_fields,
                        "shared_drugs": shared_drugs,
                        "shared_reactions": shared_reactions,
                        "event_dt_a": first["eventDtStr"] or None,
                        "event_dt_b": second["eventDtStr"] or None,
                        "age_a": first["ageStr"] or None,
                        "age_b": second["ageStr"] or None,
                        "sex_a": first["sex"] or None,
                        "sex_b": second["sex"] or None,
                        "country_a": first["country"] or None,
                        "country_b": second["country"] or None,
                    })

    flagged_pairs.sort(
        key=lambda x: (-x["score"], x["primaryid_a"], x["primaryid_b"])
    )
    capped = flagged_pairs[:200]
    secondary_ids = sorted({p["primaryid_b"] for p in capped})
    return {
        "flagged_pairs": capped,
        "flagged_secondary_primaryids": secondary_ids,
    }


def compute_disproportionality(
    pairs: pd.DataFrame,
    min_cases: int = 3,
    *,
    case_context: "CaseContext | None" = None,
    restrict_to: "set[tuple[str, str]] | None" = None,
    score: bool = True,
) -> pd.DataFrame:
    """
    Compute PRR, ROR, chi-square, p_value, Benjamini-Hochberg q_value,
    BCPNN, EBGM, signal flags and ML priority.
    """
    if min_cases < 1:
        raise ValueError("min_cases must be at least 1")

    if pairs.empty:
        return pd.DataFrame(columns=SIGNAL_COLUMNS)

    total_reports = pairs["primaryid"].nunique()
    drug_totals = pairs.groupby("drugname")["primaryid"].nunique()
    event_totals = pairs.groupby("pt")["primaryid"].nunique()

    pair_counts = (
        pairs.groupby(["drugname", "pt"])["primaryid"]
        .nunique()
        .reset_index(name="a")
    )
    pair_counts = pair_counts[pair_counts["a"] >= min_cases].copy()
    pair_counts["drug_total"] = pair_counts["drugname"].map(drug_totals).astype(int)
    pair_counts["event_total"] = pair_counts["pt"].map(event_totals).astype(int)
    pair_counts["b"] = pair_counts["drug_total"] - pair_counts["a"]
    pair_counts["c"] = pair_counts["event_total"] - pair_counts["a"]
    pair_counts["d"] = (
        total_reports - pair_counts["drug_total"] - pair_counts["event_total"] + pair_counts["a"]
    )
    pair_counts = pair_counts[(pair_counts["b"] > 0) & (pair_counts["c"] > 0) & (pair_counts["d"] > 0)]

    if pair_counts.empty:
        return pd.DataFrame(columns=SIGNAL_COLUMNS)

    observed = pair_counts["a"].to_numpy(dtype=float)
    expected = (
        pair_counts["drug_total"].to_numpy(dtype=float)
        * pair_counts["event_total"].to_numpy(dtype=float)
        / total_reports
    )
    prior = fit_gamma_poisson_prior(observed, expected)

    if restrict_to is not None:
        wanted = pd.MultiIndex.from_tuples(sorted(restrict_to), names=["drugname", "pt"])
        index = pd.MultiIndex.from_frame(pair_counts[["drugname", "pt"]])
        pair_counts = pair_counts[index.isin(wanted)]
        if pair_counts.empty:
            return pd.DataFrame(columns=SIGNAL_COLUMNS)

    strata = [
        {
            "drug": row.drugname,
            "adverse_event": row.pt,
            "a": int(row.a),
            "b": int(row.b),
            "c": int(row.c),
            "d": int(row.d),
            "drug_total_reports": int(row.drug_total),
            "event_total_reports": int(row.event_total),
        }
        for row in pair_counts.itertuples(index=False)
    ]

    results = []
    for s in strata:
        a, b, c, d = s["a"], s["b"], s["c"], s["d"]
        drug_name, pt = s["drug"], s["adverse_event"]

        prr = (a / (a + b)) / (c / (c + d))
        ror = (a * d) / (b * c)

        contingency = np.array([[a, b], [c, d]])
        chi2, p_value, _, _ = stats.chi2_contingency(contingency, correction=True)

        se_log_ror = np.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
        log_ror = np.log(ror)
        ror_ci_low = np.exp(log_ror - 1.96 * se_log_ror)
        ror_ci_high = np.exp(log_ror + 1.96 * se_log_ror)

        bcp = bcpnn(a, b, c, d, total_reports)
        exp_a = expected_count(a, b, c, d, total_reports)
        ebg = ebgm_pair(a, exp_a, prior)

        results.append({
            "drug": drug_name,
            "adverse_event": pt,
            "case_count_a": a,
            "drug_total_reports": s["drug_total_reports"],
            "event_total_reports": s["event_total_reports"],
            "PRR": _js_round(prr, 3),
            "ROR": _js_round(ror, 3),
            "ROR_95CI_low": _js_round(float(ror_ci_low), 3),
            "ROR_95CI_high": _js_round(float(ror_ci_high), 3),
            "chi_square": _js_round(float(chi2), 3),
            "p_value": _js_round(float(p_value), 6),
            "q_value": 1.0,
            "signal_fdr": False,
            "IC": bcp.ic,
            "IC025": bcp.ic025,
            "IC975": bcp.ic975,
            "signal_bcpnn": bcp.signal_bcpnn,
            "EBGM": ebg.ebgm,
            "EB05": ebg.eb05,
            "EB95": ebg.eb95,
            "signal_ebgm": ebg.signal_ebgm,
            "serious_event": pt in SERIOUS_ADVERSE_EVENTS,
            "signal_detected": bool((prr >= 2) and (chi2 >= 4) and (a >= min_cases)),
            "priority_score": None,
            "priority_rank": None,
            "priority_explain": None,
        })

    q_vals = benjamini_hochberg([r["p_value"] for r in results])
    for idx, qv in enumerate(q_vals):
        results[idx]["q_value"] = qv
        results[idx]["signal_fdr"] = bool(
            (qv < 0.05) and (results[idx]["PRR"] >= 2.0) and (results[idx]["case_count_a"] >= min_cases)
        )

    output = pd.DataFrame(results)
    if score:
        from ml_prioritization import apply_prioritization, load_model
        from pair_features import case_level_features

        case_features = case_level_features(pairs, case_context) if case_context is not None else None
        output = apply_prioritization(output, load_model(), total_reports, case_features)

    return output.reindex(columns=SIGNAL_COLUMNS)


def _get_age_band(row: dict[str, Any]) -> str:
    yrs = _parse_age_years(row)
    if yrs is None:
        return "UNK"
    if yrs < 18:
        return "0-17"
    if yrs < 45:
        return "18-44"
    if yrs < 65:
        return "45-64"
    return "65+"


def _get_sex_band(row: dict[str, Any]) -> str:
    s = str(row.get("sex") or "").strip().upper()
    return s if s in ("F", "M") else "UNK"


def compute_stratified_analysis(
    demo: pd.DataFrame,
    pairs: pd.DataFrame,
    signals: pd.DataFrame,
) -> dict[str, dict[str, Any]]:
    """
    Computes age-band, sex, and joint (age_band x sex) stratified PRR/IC and
    Mantel-Haenszel adjusted estimates for each eligible drug-event signal.
    """
    dedup_demo, _ = deduplicate_demo_by_caseid(demo)
    case_age: dict[str, str] = {}
    case_sex: dict[str, str] = {}

    for r in dedup_demo.to_dict(orient="records"):
        pid = str(r.get("primaryid") or "").strip()
        if not pid:
            continue
        case_age[pid] = _get_age_band(r)
        case_sex[pid] = _get_sex_band(r)

    active_pids = set(pairs["primaryid"].astype(str))
    age_strata_cases: dict[str, set[str]] = {}
    sex_strata_cases: dict[str, set[str]] = {}
    joint_strata_cases: dict[str, set[str]] = {}

    for pid in active_pids:
        ab = case_age.get(pid, "UNK")
        sx = case_sex.get(pid, "UNK")
        if ab != "UNK":
            age_strata_cases.setdefault(ab, set()).add(pid)
        if sx != "UNK":
            sex_strata_cases.setdefault(sx, set()).add(pid)
        if ab != "UNK" and sx != "UNK":
            joint_strata_cases.setdefault(f"{ab}|{sx}", set()).add(pid)

    drug_cases: dict[str, set[str]] = {}
    event_cases: dict[str, set[str]] = {}
    pair_cases: dict[str, set[str]] = {}

    for row in pairs.itertuples(index=False):
        pid = str(row.primaryid)
        d = str(row.drugname)
        ev = str(row.pt)
        drug_cases.setdefault(d, set()).add(pid)
        event_cases.setdefault(ev, set()).add(pid)
        pair_cases.setdefault(f"{d}|{ev}", set()).add(pid)

    def eval_strata_group(
        strata_map: dict[str, set[str]],
        ordered_keys: list[str],
        d_set: set[str],
        e_set: set[str],
        p_set: set[str],
    ) -> list[dict[str, Any]]:
        out_list: list[dict[str, Any]] = []
        for sk in ordered_keys:
            s_cases = strata_map.get(sk)
            if not s_cases:
                continue
            n_total = len(s_cases)
            a = 0
            d_tot = 0
            e_tot = 0
            for pid in s_cases:
                has_d = pid in d_set
                has_e = pid in e_set
                if has_d:
                    d_tot += 1
                if has_e:
                    e_tot += 1
                if has_d and has_e and pid in p_set:
                    a += 1
            b = d_tot - a
            c = e_tot - a
            d_cnt = n_total - d_tot - e_tot + a
            prr = (
                _js_round((a / (a + b)) / (c / (c + d_cnt)), 3)
                if (a + b > 0 and c + d_cnt > 0 and c > 0)
                else None
            )
            bcp = bcpnn(max(0, a), max(0, b), max(0, c), max(0, d_cnt), n_total)
            out_list.append({
                "stratum": sk,
                "a": a,
                "b": b,
                "c": c,
                "d": d_cnt,
                "n_total": n_total,
                "PRR": prr,
                "IC": bcp.ic,
                "IC025": bcp.ic025,
            })
        return out_list

    age_order = ["0-17", "18-44", "45-64", "65+"]
    sex_order = ["F", "M"]
    joint_order = [f"{ab}|{sx}" for ab in age_order for sx in sex_order]

    out: dict[str, dict[str, Any]] = {}
    for row in signals.to_dict(orient="records"):
        d_name = str(row["drug"])
        e_name = str(row["adverse_event"])
        pk = f"{d_name}|{e_name}"
        d_set = drug_cases.get(d_name, set())
        e_set = event_cases.get(e_name, set())
        p_set = pair_cases.get(pk, set())

        by_age_band = eval_strata_group(age_strata_cases, age_order, d_set, e_set, p_set)
        by_sex = eval_strata_group(sex_strata_cases, sex_order, d_set, e_set, p_set)
        by_age_sex = eval_strata_group(joint_strata_cases, joint_order, d_set, e_set, p_set)

        mh = compute_mantel_haenszel(by_age_sex)
        pooled_prr = float(row["PRR"])
        prr_change_pct = (
            _js_round(((mh["prr_mh"] - pooled_prr) / pooled_prr) * 100.0, 3)
            if (mh["prr_mh"] is not None and pooled_prr > 0)
            else None
        )
        log_ratio_diff = (
            abs(math.log(mh["prr_mh"] / pooled_prr))
            if (mh["prr_mh"] is not None and mh["prr_mh"] > 0 and pooled_prr > 0)
            else 0.0
        )
        threshold_flip = mh["prr_mh"] is not None and (
            (pooled_prr >= 2.0 and mh["prr_mh"] < 2.0)
            or (pooled_prr < 2.0 and mh["prr_mh"] >= 2.0)
        )
        confounding_flagged = bool(log_ratio_diff >= math.log(1.2) or threshold_flip)

        direction = "consistent"
        if confounding_flagged and prr_change_pct is not None:
            direction = "inflated_pooled" if prr_change_pct < 0 else "masked_pooled"

        out[pk] = {
            "drug": d_name,
            "adverse_event": e_name,
            "case_count_a": int(row["case_count_a"]),
            "pooled_PRR": pooled_prr,
            "adjusted_PRR_MH": mh["prr_mh"],
            "pooled_ROR": float(row["ROR"]),
            "adjusted_ROR_MH": mh["ror_mh"],
            "pooled_IC": float(row["IC"]),
            "stratified_IC": mh["ic_stratified"],
            "prr_change_pct": prr_change_pct,
            "confounding_flagged": confounding_flagged,
            "direction": direction,
            "by_age_band": by_age_band,
            "by_sex": by_sex,
            "by_age_sex": by_age_sex,
        }
    return out


def compute_weibull_for_pairs(
    demo: pd.DataFrame,
    pairs: pd.DataFrame,
    ther: pd.DataFrame | None,
    min_cases: int = 10,
) -> dict[str, dict[str, Any]]:
    """
    Fits Weibull distributions across all drug-event pairs that have >= min_cases (default 10)
    valid time-to-onset observations from THER.start_dt and DEMO.event_dt.
    """
    out: dict[str, dict[str, Any]] = {}
    if ther is None or ther.empty:
        return out

    dedup_demo, _ = deduplicate_demo_by_caseid(demo)
    event_date_by_pid: dict[str, int] = {}
    for r in dedup_demo.to_dict(orient="records"):
        pid = str(r.get("primaryid") or "").strip()
        ms = _parse_faers_date_ms(r.get("event_dt"))
        if pid and ms is not None:
            event_date_by_pid[pid] = ms

    per_case_start: dict[str, int] = {}
    per_drug_start: dict[str, int] = {}
    for r in ther.to_dict(orient="records"):
        pid = str(r.get("primaryid") or "").strip()
        start_ms = _parse_faers_date_ms(r.get("start_dt"))
        if not pid or start_ms is None:
            continue
        prev_case = per_case_start.get(pid)
        if prev_case is None or start_ms < prev_case:
            per_case_start[pid] = start_ms
        seq = str(r.get("dsg_drug_seq") or "").strip()
        if seq and seq.lower() != "nan":
            dk = f"{pid}|{seq}"
            prev_drug = per_drug_start.get(dk)
            if prev_drug is None or start_ms < prev_drug:
                per_drug_start[dk] = start_ms

    tto_by_pair: dict[str, list[float]] = {}
    for r in pairs.to_dict(orient="records"):
        pid = str(r.get("primaryid") or "").strip()
        ev_ms = event_date_by_pid.get(pid)
        if ev_ms is None:
            continue
        start_ms = per_case_start.get(pid)
        drug_seq = str(r.get("drug_seq") or "").strip()
        if drug_seq and drug_seq.lower() != "nan":
            d_start = per_drug_start.get(f"{pid}|{drug_seq}")
            if d_start is not None:
                start_ms = d_start
        if start_ms is None:
            continue
        days = round((ev_ms - start_ms) / 86_400_000.0)
        if 0 <= days <= 3650:
            pk = f"{r['drugname']}|{r['pt']}"
            tto_by_pair.setdefault(pk, []).append(float(days))

    for pk, days_list in tto_by_pair.items():
        if len(days_list) < min_cases:
            continue
        drug_name, adverse_event = pk.split("|", 1)
        fitted = fit_weibull_tto(drug_name, adverse_event, days_list, min_cases)
        if fitted is not None:
            out[pk] = fitted

    return out


def compute_temporal_signal_series(
    pairs: pd.DataFrame,
    drug: str,
    adverse_event: str,
    granularity: str = "month",
) -> dict[str, Any]:
    """
    Computes cumulative IC with 95% intervals by month or quarter for a selected (drug, event) pair,
    the date IC025 first exceeded zero, and Poisson Log-Likelihood Ratio + Page's CUSUM change-point
    detection on the reporting rate.
    """
    def period_of(event_dt: Any) -> str | None:
        if pd.isna(event_dt):
            return None
        clean = str(event_dt).strip()
        if len(clean) < 6 or not clean[:6].isdigit():
            return None
        y = clean[:4]
        m = int(clean[4:6])
        if m < 1 or m > 12:
            return None
        if granularity == "quarter":
            q = (m - 1) // 3 + 1
            return f"{y}-Q{q}"
        return f"{y}-{m:02d}"

    case_period: dict[str, str] = {}
    case_drugs: dict[str, set[str]] = {}
    case_events: dict[str, set[str]] = {}

    for r in pairs.to_dict(orient="records"):
        per = period_of(r.get("event_dt"))
        if not per:
            continue
        pid = str(r["primaryid"])
        case_period[pid] = per
        case_drugs.setdefault(pid, set()).add(str(r["drugname"]))
        case_events.setdefault(pid, set()).add(str(r["pt"]))

    all_periods = sorted(set(case_period.values()))
    if not all_periods:
        return {
            "drug": drug,
            "adverse_event": adverse_event,
            "granularity": granularity,
            "first_ic025_gt0_period": None,
            "changepoint_period": None,
            "changepoint_llr": 0.0,
            "changepoint_p_value": 1.0,
            "changepoint_detected": False,
            "pre_rate": 0.0,
            "post_rate": 0.0,
            "points": [],
        }

    period_buckets = {
        per: {"n": 0, "drugCount": 0, "eventCount": 0, "pairCount": 0}
        for per in all_periods
    }
    for pid, per in case_period.items():
        b = period_buckets[per]
        b["n"] += 1
        has_d = drug in case_drugs.get(pid, set())
        has_e = adverse_event in case_events.get(pid, set())
        if has_d:
            b["drugCount"] += 1
        if has_e:
            b["eventCount"] += 1
        if has_d and has_e:
            b["pairCount"] += 1

    total_drug_reports = sum(b["drugCount"] for b in period_buckets.values())
    total_pair_reports = sum(b["pairCount"] for b in period_buckets.values())
    baseline_rate = total_pair_reports / max(1, total_drug_reports)

    k_len = len(all_periods)
    llr_by_idx = [0.0] * k_len
    best_split_idx = -1
    max_llr = 0.0
    best_pre_rate = baseline_rate
    best_post_rate = baseline_rate

    pre_a = 0
    pre_m = 0
    for m in range(k_len - 1):
        b = period_buckets[all_periods[m]]
        pre_a += b["pairCount"]
        pre_m += b["drugCount"]
        post_a = total_pair_reports - pre_a
        post_m = total_drug_reports - pre_m

        if pre_m > 0 and post_m > 0 and total_pair_reports > 0:
            e1 = total_pair_reports * (pre_m / total_drug_reports)
            e2 = total_pair_reports * (post_m / total_drug_reports)
            term1 = pre_a * math.log(pre_a / e1) if (pre_a > 0 and e1 > 0) else 0.0
            term2 = post_a * math.log(post_a / e2) if (post_a > 0 and e2 > 0) else 0.0
            g2 = max(0.0, 2.0 * (term1 + term2))
            llr_by_idx[m + 1] = _js_round(g2, 4)
            if g2 > max_llr:
                max_llr = g2
                best_split_idx = m + 1
                best_pre_rate = pre_a / pre_m
                best_post_rate = post_a / post_m

    cum_n = 0
    cum_drug = 0
    cum_event = 0
    cum_a = 0
    cusum = 0.0
    first_signal_period: str | None = None
    points: list[dict[str, Any]] = []

    for i in range(k_len):
        per = all_periods[i]
        b = period_buckets[per]
        cum_n += b["n"]
        cum_drug += b["drugCount"]
        cum_event += b["eventCount"]
        cum_a += b["pairCount"]

        cum_b = max(0, cum_drug - cum_a)
        cum_c = max(0, cum_event - cum_a)
        cum_d = max(0, cum_n - cum_drug - cum_event + cum_a)

        bcp = bcpnn(cum_a, cum_b, cum_c, cum_d, cum_n)
        if first_signal_period is None and bcp.ic025 > 0:
            first_signal_period = per

        expected_period_a = b["drugCount"] * baseline_rate
        k_ref = expected_period_a * 1.15 + 0.05
        cusum = max(0.0, cusum + (b["pairCount"] - k_ref))

        points.append({
            "period": per,
            "period_cases_a": b["pairCount"],
            "period_drug_reports": b["drugCount"],
            "period_rate": _js_round(b["pairCount"] / b["drugCount"], 4) if b["drugCount"] > 0 else 0.0,
            "cum_a": cum_a,
            "cum_b": cum_b,
            "cum_c": cum_c,
            "cum_d": cum_d,
            "cum_n": cum_n,
            "cum_ic": bcp.ic,
            "cum_ic025": bcp.ic025,
            "cum_ic975": bcp.ic975,
            "cusum_stat": _js_round(cusum, 4),
            "llr_stat": llr_by_idx[i],
        })

    cp_pval = _js_round(float(stats.chi2.sf(max_llr, df=1)) if max_llr > 0 else 1.0, 6)
    cp_detected = bool(max_llr >= 6.63 and best_split_idx > 0)

    return {
        "drug": drug,
        "adverse_event": adverse_event,
        "granularity": granularity,
        "first_ic025_gt0_period": first_signal_period,
        "changepoint_period": all_periods[best_split_idx] if best_split_idx > 0 else None,
        "changepoint_llr": _js_round(max_llr, 4),
        "changepoint_p_value": cp_pval,
        "changepoint_detected": cp_detected,
        "pre_rate": _js_round(best_pre_rate, 4),
        "post_rate": _js_round(best_post_rate, 4),
        "points": points,
    }


def compute_drug_interactions(
    pairs: pd.DataFrame,
    total_reports: int | None = None,
    min_co_cases: int = 3,
    max_triplets: int = 200,
) -> list[dict[str, Any]]:
    """
    Computes Norén et al. (2008) Omega (Ω) shrinkage drug-drug interaction signals
    across triplets (drug_a, drug_b, adverse_event).
    """
    if pairs.empty:
        return []
    if total_reports is None:
        total_reports = int(pairs["primaryid"].nunique())
    if total_reports <= 0:
        return []

    case_drugs: dict[str, set[str]] = {}
    case_events: dict[str, set[str]] = {}
    drug_cases: dict[str, set[str]] = {}
    event_cases: dict[str, set[str]] = {}
    single_pair_cases: dict[str, set[str]] = {}

    for r in pairs.to_dict(orient="records"):
        pid = str(r["primaryid"])
        d_name = str(r["drugname"])
        ev_name = str(r["pt"])
        case_drugs.setdefault(pid, set()).add(d_name)
        case_events.setdefault(pid, set()).add(ev_name)
        drug_cases.setdefault(d_name, set()).add(pid)
        event_cases.setdefault(ev_name, set()).add(pid)
        single_pair_cases.setdefault(f"{d_name}|{ev_name}", set()).add(pid)

    drug_pair_count: dict[str, int] = {}
    triplet_count: dict[str, int] = {}

    for pid, d_set in case_drugs.items():
        if len(d_set) < 2:
            continue
        drugs = sorted(d_set)[:12]
        events = sorted(case_events.get(pid, set()))
        for i in range(len(drugs)):
            for j in range(i + 1, len(drugs)):
                dp_key = f"{drugs[i]}|{drugs[j]}"
                drug_pair_count[dp_key] = drug_pair_count.get(dp_key, 0) + 1
                for ev in events:
                    t_key = f"{drugs[i]}|{drugs[j]}|{ev}"
                    triplet_count[t_key] = triplet_count.get(t_key, 0) + 1

    eligible_triplets = sorted(
        [(k, v) for k, v in triplet_count.items() if v >= min_co_cases],
        key=lambda x: (-x[1], x[0]),
    )[:max_triplets]

    results: list[dict[str, Any]] = []
    for t_key, n111 in eligible_triplets:
        drug_a, drug_b, adverse_event = t_key.split("|")
        dp_key = f"{drug_a}|{drug_b}"
        n11 = drug_pair_count.get(dp_key, n111)

        n_a = len(drug_cases.get(drug_a, set()))
        n_b = len(drug_cases.get(drug_b, set()))
        n_e = len(event_cases.get(adverse_event, set()))

        n_ae = len(single_pair_cases.get(f"{drug_a}|{adverse_event}", set()))
        n_be = len(single_pair_cases.get(f"{drug_b}|{adverse_event}", set()))

        n10 = max(0, n_a - n11)
        n01 = max(0, n_b - n11)
        n00 = max(0, total_reports - n11 - n10 - n01)

        n101 = max(0, n_ae - n111)
        n011 = max(0, n_be - n111)
        n001 = max(0, n_e - n111 - n101 - n011)

        omega_res = compute_omega_interaction(n111, n11, n101, n10, n011, n01, n001, n00)

        def calc_simple_prr(a_count: int, tot_drug: int) -> float | None:
            b_count = tot_drug - a_count
            c_count = n_e - a_count
            d_count = total_reports - tot_drug - n_e + a_count
            if a_count + b_count <= 0 or c_count + d_count <= 0 or c_count <= 0:
                return None
            return _js_round((a_count / (a_count + b_count)) / (c_count / (c_count + d_count)), 3)

        prr_a = calc_simple_prr(n_ae, n_a)
        prr_b = calc_simple_prr(n_be, n_b)
        prr_ab = calc_simple_prr(n111, n11) or 0.0

        results.append({
            "drug_a": drug_a,
            "drug_b": drug_b,
            "adverse_event": adverse_event,
            "n111": n111,
            "n11": n11,
            "n101": n101,
            "n10": n10,
            "n011": n011,
            "n01": n01,
            "n001": n001,
            "n00": n00,
            **omega_res,
            "prr_a": prr_a,
            "prr_b": prr_b,
            "prr_ab": prr_ab,
        })

    results.sort(
        key=lambda x: (-x["omega025"], -x["omega"], -x["n111"], x["drug_a"])
    )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="FAERS drug-ADR signal detection (PRR/ROR)")
    parser.add_argument("--demo", required=True, help="Path to DEMO table")
    parser.add_argument("--drug", required=True, help="Path to DRUG table")
    parser.add_argument("--reac", required=True, help="Path to REAC table")
    parser.add_argument("--min-cases", type=int, default=3)
    parser.add_argument("--out", default="signals.csv")
    parser.add_argument("--drug-filter", default=None)
    args = parser.parse_args()

    print("Loading tables...")
    demo = load_table(args.demo)
    drug = load_table(args.drug)
    reac = load_table(args.reac)
    print(f"  DEMO: {len(demo)} rows | DRUG: {len(drug)} rows | REAC: {len(reac)} rows")

    pairs = build_case_level_table(demo, drug, reac)
    signals = compute_disproportionality(pairs, min_cases=args.min_cases)

    if args.drug_filter:
        signals = signals[signals["drug"] == normalize_drug_name(args.drug_filter)]

    signals.to_csv(args.out, index=False)
    print(f"Wrote {len(signals)} drug-event pairs to {args.out}")

    flagged = signals[signals["signal_detected"]]
    print(f"{len(flagged)} pairs meet the configured signal threshold")
    if len(flagged):
        print(
            flagged[["drug", "adverse_event", "case_count_a", "PRR", "ROR", "chi_square", "q_value"]]
            .head(20)
            .to_string(index=False)
        )


if __name__ == "__main__":
    main()
