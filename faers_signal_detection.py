"""
FAERS Adverse Drug Reaction Signal Detection Pipeline
======================================================

Computes disproportionality signals (PRR, ROR) for drug-adverse event pairs
from FDA FAERS-style DEMO / DRUG / REAC tables joined on ``primaryid``.
"""
import argparse

import numpy as np
import pandas as pd
from scipy import stats

from bayesian_stats import bcpnn, ebgm_pair, expected_count, fit_gamma_poisson_prior
from drug_mapping import canonicalize_drug

# MedDRA PTs flagged as clinically serious in the signals table (display only; not a model feature)
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


def load_table(path: str) -> pd.DataFrame:
    """Load a FAERS table, auto-detecting comma, dollar, pipe, or tab delimiters."""
    errors = []
    for sep in [",", "$", "|", "\t"]:
        try:
            df = pd.read_csv(path, sep=sep, dtype=str, low_memory=False)
            if df.shape[1] > 1:
                # Real FAERS releases are normally lowercase, but accepting mixed
                # case/BOM/whitespace makes uploads considerably less brittle.
                df.columns = [str(column).lstrip("\ufeff").strip().lower() for column in df.columns]
                return df
        except Exception as exc:  # retain context without stopping delimiter detection
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


def build_case_level_table(
    demo: pd.DataFrame,
    drug: pd.DataFrame,
    reac: pd.DataFrame,
) -> pd.DataFrame:
    """Collapse input tables to one row per case, canonical drug, and reaction."""
    _require_columns(demo, {"primaryid"}, "DEMO")
    _require_columns(drug, {"primaryid", "drugname"}, "DRUG")
    _require_columns(reac, {"primaryid", "pt"}, "REAC")

    demo = demo.copy()
    drug = drug.copy()
    reac = reac.copy()
    for frame in (demo, drug, reac):
        frame["primaryid"] = frame["primaryid"].astype("string").str.strip()

    # Restrict computation to reports represented in DEMO, matching the documented
    # three-table join rather than accidentally retaining orphan DRUG/REAC rows.
    valid_cases = set(demo["primaryid"].dropna())
    drug = drug[drug["primaryid"].isin(valid_cases)]
    reac = reac[reac["primaryid"].isin(valid_cases)]

    drug["drugname"] = drug["drugname"].apply(normalize_drug_name)
    reac["pt"] = reac["pt"].apply(normalize_pt)
    drug = drug.dropna(subset=["primaryid", "drugname"])
    reac = reac.dropna(subset=["primaryid", "pt"])
    drug = drug[drug["drugname"] != ""]
    reac = reac[reac["pt"] != ""]

    # role_cod is optional. If supplied, only primary/secondary suspects are used.
    if "role_cod" in drug.columns:
        roles = drug["role_cod"].astype("string").str.strip().str.upper()
        drug = drug[roles.isin(["PS", "SS"])]

    merged = drug.merge(reac, on="primaryid", how="inner", suffixes=("_drug", "_reac"))
    return merged.drop_duplicates(subset=["primaryid", "drugname", "pt"])


def compute_disproportionality(
    pairs: pd.DataFrame,
    min_cases: int = 3,
    *,
    case_context: "CaseContext | None" = None,
    restrict_to: "set[tuple[str, str]] | None" = None,
    score: bool = True,
) -> pd.DataFrame:
    """
    Compute PRR, ROR, chi-square, BCPNN, EBGM, signal flags and ML priority.

    ``case_context`` supplies the optional report-level tables used by the ML
    model's case features.  ``restrict_to`` limits the output to the given
    (drug, event) pairs while still using every report for the 2x2 margins and
    the EBGM prior; the training script uses it so that a full FAERS extract
    does not need a row per pair.  ``score=False`` skips ML prioritisation.
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

    # The shrinkage prior is fitted on every eligible pair, even when the output is restricted.
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
            "PRR": round(prr, 3),
            "ROR": round(ror, 3),
            "ROR_95CI_low": round(ror_ci_low, 3),
            "ROR_95CI_high": round(ror_ci_high, 3),
            "chi_square": round(chi2, 3),
            "p_value": round(p_value, 6),
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

    output = pd.DataFrame(results)
    if score:
        from ml_prioritization import apply_prioritization, load_model
        from pair_features import case_level_features

        case_features = case_level_features(pairs, case_context) if case_context is not None else None
        output = apply_prioritization(output, load_model(), total_reports, case_features)
    return output.reindex(columns=SIGNAL_COLUMNS)


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
        print(flagged[["drug", "adverse_event", "case_count_a", "PRR", "ROR", "chi_square"]]
              .head(20).to_string(index=False))


if __name__ == "__main__":
    main()
