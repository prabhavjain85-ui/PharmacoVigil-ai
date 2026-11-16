"""
Feature engineering for ML prioritisation of drug-event pairs.

Two feature groups:

* ``disproportionality`` - transforms of the closed-form 2x2 statistics that
  ``compute_disproportionality`` already produces.  Always available.
* ``case`` - aggregates over the reports behind a pair, read from the optional
  FAERS tables (OUTC, INDI, THER) and optional DEMO / DRUG columns.  A feature
  is NaN when its source table or column was not supplied; the model then
  imputes the training mean, so a missing feature contributes nothing.

The browser pipeline mirrors this file in ``web/lib/pipeline/pairFeatures.ts``.
Keep the two in step; ``scripts/export_parity_fixture.py`` checks them.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np
import pandas as pd

DISPROPORTIONALITY_FEATURES: list[tuple[str, str]] = [
    ("ic", "IC (BCPNN)"),
    ("ic025", "IC025 (lower bound)"),
    ("log_prr", "log PRR"),
    ("log_ror_ci_low", "log ROR lower 95% bound"),
    ("log_chi2", "log(1 + chi-square)"),
    ("log_cases", "log(1 + case count)"),
]

CASE_FEATURES: list[tuple[str, str]] = [
    ("frac_death", "Fatal outcome fraction"),
    ("frac_hosp_lt", "Hospitalised / life-threatening fraction"),
    ("frac_serious", "Any serious outcome fraction"),
    ("frac_hcp", "Health-professional reporter fraction"),
    ("frac_female", "Female fraction"),
    ("mean_age", "Mean age (years)"),
    ("log_median_tto", "log(1 + median days to onset)"),
    ("frac_tto_30d", "Onset within 30 days fraction"),
    ("log_mean_drugs", "log mean drugs per report"),
    ("frac_primary_suspect", "Primary-suspect fraction"),
    ("frac_event_is_indication", "Event reported as indication fraction"),
]

FEATURE_GROUPS: dict[str, list[str]] = {
    "disproportionality": [name for name, _ in DISPROPORTIONALITY_FEATURES],
    "case": [name for name, _ in CASE_FEATURES],
}
ALL_FEATURES: list[str] = FEATURE_GROUPS["disproportionality"] + FEATURE_GROUPS["case"]
FEATURE_LABELS: dict[str, str] = dict(DISPROPORTIONALITY_FEATURES + CASE_FEATURES)
FEATURE_GROUP_OF: dict[str, str] = {
    name: group for group, names in FEATURE_GROUPS.items() for name in names
}

# The drug's and the event's share of all reports are deliberately not features.
# The reference sets cover ten outcomes with very different positive/negative
# ratios, and either share (the drug share via cases / drug total) lets the model
# work out which outcome a row belongs to instead of how strong the signal is.
LOG_FLOOR = 1e-3  # guards log() against ratios that round to zero
SERIOUS_OUTCOMES = {"DE", "LT", "HO", "DS", "CA", "RI"}
HCP_REPORTERS = {"MD", "PH", "OT", "HP", "RN"}
MAX_TTO_DAYS = 3650
AGE_UNIT_TO_YEARS = {
    "YR": 1.0, "DEC": 10.0, "MON": 1 / 12, "WK": 1 / 52.18, "DY": 1 / 365.25, "HR": 1 / 8766,
}


@dataclass
class CaseContext:
    """Optional report-level tables. Any of them may be None."""

    demo: Optional[pd.DataFrame] = None
    drug: Optional[pd.DataFrame] = None
    outc: Optional[pd.DataFrame] = None
    indi: Optional[pd.DataFrame] = None
    ther: Optional[pd.DataFrame] = None


def disproportionality_features(signals: pd.DataFrame, total_reports: int) -> pd.DataFrame:
    """Derive the always-available feature group from a signals table."""
    def col(name: str) -> np.ndarray:
        return signals[name].astype(float).to_numpy()

    return pd.DataFrame({
        "ic": col("IC"),
        "ic025": col("IC025"),
        "log_prr": np.log(np.maximum(col("PRR"), LOG_FLOOR)),
        "log_ror_ci_low": np.log(np.maximum(col("ROR_95CI_low"), LOG_FLOOR)),
        "log_chi2": np.log1p(np.maximum(col("chi_square"), 0.0)),
        "log_cases": np.log1p(col("case_count_a")),
    }, index=signals.index)


def _clean_id(series: pd.Series) -> pd.Series:
    return series.fillna("").astype(str).str.strip()


def _clean_code(series: pd.Series) -> pd.Series:
    return series.fillna("").astype(str).str.strip().str.upper()


def _parse_date(series: pd.Series) -> pd.Series:
    """FAERS dates are YYYYMMDD; partial dates (YYYY, YYYYMM) are treated as missing."""
    text = series.fillna("").astype(str).str.strip()
    text = text.where(text.str.fullmatch(r"\d{8}").fillna(False))
    return pd.to_datetime(text, format="%Y%m%d", errors="coerce")


def _case_table(context: CaseContext, active_pids: Optional[set[str]] = None) -> pd.DataFrame:
    """One row per report with the report-level attributes that are available."""
    parts: list[pd.DataFrame] = []

    demo = context.demo
    if demo is not None and "primaryid" in demo.columns:
        pids = _clean_id(demo["primaryid"])
        if active_pids is not None:
            mask = pids.isin(active_pids)
            demo = demo.loc[mask]
            pids = pids.loc[mask]
        d = pd.DataFrame({"primaryid": pids})
        if "sex" in demo.columns:
            sex = _clean_code(demo["sex"])
            d["female"] = sex.map({"F": 1.0, "M": 0.0}).astype(float)
        if "age" in demo.columns:
            age = pd.to_numeric(demo["age"], errors="coerce")
            if "age_cod" in demo.columns:
                unit = _clean_code(demo["age_cod"]).map(AGE_UNIT_TO_YEARS).astype(float).fillna(1.0)
                age = age * unit.to_numpy()
            d["age_years"] = age.where((age >= 0) & (age <= 120)).to_numpy()
        if "occp_cod" in demo.columns:
            occp = _clean_code(demo["occp_cod"])
            hcp = occp.isin(HCP_REPORTERS).astype(float)
            d["hcp"] = hcp.where(occp.notna() & (occp != "")).to_numpy()
        if "event_dt" in demo.columns:
            d["event_date"] = _parse_date(demo["event_dt"]).to_numpy()
        parts.append(d.dropna(subset=["primaryid"]).drop_duplicates("primaryid").set_index("primaryid"))

    outc = context.outc
    has_outc_table = outc is not None and {"primaryid", "outc_cod"} <= set(outc.columns) and not outc.empty
    if has_outc_table:
        pids = _clean_id(outc["primaryid"])
        if active_pids is not None:
            mask = pids.isin(active_pids)
            outc = outc.loc[mask]
            pids = pids.loc[mask]
        o = pd.DataFrame({
            "primaryid": pids,
            "code": _clean_code(outc["outc_cod"]),
        }).dropna()
        flags = pd.DataFrame({
            "primaryid": o["primaryid"],
            "death": (o["code"] == "DE").astype(float),
            "hosp_lt": o["code"].isin({"HO", "LT"}).astype(float),
            "serious": o["code"].isin(SERIOUS_OUTCOMES).astype(float),
        }).groupby("primaryid").max()
        parts.append(flags)

    drug = context.drug
    if drug is not None and {"primaryid", "drugname"} <= set(drug.columns):
        pids = _clean_id(drug["primaryid"])
        if active_pids is not None:
            mask = pids.isin(active_pids)
            drug = drug.loc[mask]
            pids = pids.loc[mask]
        g = pd.DataFrame({
            "primaryid": pids,
            "name": _clean_code(drug["drugname"]),
        }).dropna()
        parts.append(g.groupby("primaryid")["name"].nunique().astype(float).rename("n_drugs").to_frame())

    if not parts:
        return pd.DataFrame()
    table = pd.concat(parts, axis=1)
    if has_outc_table:
        # A report absent from a supplied OUTC table had no serious outcome recorded.
        for name in ("death", "hosp_lt", "serious"):
            if name not in table.columns:
                table[name] = 0.0
            else:
                table[name] = table[name].fillna(0.0)
    return table


def _therapy_start(
    context: CaseContext, active_pids: Optional[set[str]] = None
) -> tuple[Optional[pd.DataFrame], Optional[pd.Series]]:
    """Earliest therapy start per (report, drug_seq) and per report."""
    ther = context.ther
    if ther is None or not {"primaryid", "start_dt"} <= set(ther.columns):
        return None, None
    pids = _clean_id(ther["primaryid"])
    if active_pids is not None:
        mask = pids.isin(active_pids)
        ther = ther.loc[mask]
        pids = pids.loc[mask]
    t = pd.DataFrame({
        "primaryid": pids,
        "start": _parse_date(ther["start_dt"]),
    })
    if "dsg_drug_seq" in ther.columns:
        t["drug_seq"] = _clean_id(ther["dsg_drug_seq"])
    t = t.dropna(subset=["primaryid", "start"])
    per_case = t.groupby("primaryid")["start"].min()
    per_drug = None
    if "drug_seq" in t.columns:
        per_drug = (
            t.dropna(subset=["drug_seq"])
            .groupby(["primaryid", "drug_seq"])["start"].min()
            .rename("start_drug").reset_index()
        )
    return per_drug, per_case


def case_level_features(
    pairs: pd.DataFrame,
    context: Optional[CaseContext],
    event_mapper: Optional[Callable[[str], str]] = None,
) -> pd.DataFrame:
    """
    Aggregate report attributes over the reports behind each drug-event pair.

    ``pairs`` is the output of ``build_case_level_table`` (one row per report,
    canonical drug and event).  Returns one row per (drugname, pt) with the
    ``case`` feature group; unavailable features are NaN.  ``event_mapper`` must
    be the same function that was applied to ``pairs['pt']`` so that indication
    terms are compared on the same vocabulary.
    """
    keys = ["drugname", "pt"]
    names = FEATURE_GROUPS["case"]
    if pairs.empty:
        return pd.DataFrame(columns=keys + names)

    work = pairs[["primaryid", "drugname", "pt"]].copy()
    work["primaryid"] = _clean_id(work["primaryid"])
    active_pids = set(work["primaryid"].dropna())
    if "role_cod" in pairs.columns:
        role = _clean_code(pairs["role_cod"])
        work["primary"] = (role == "PS").astype(float).where(role.notna() & (role != "")).to_numpy()
    if "drug_seq" in pairs.columns:
        work["drug_seq"] = _clean_id(pairs["drug_seq"]).to_numpy()

    context = context or CaseContext()
    cases = _case_table(context, active_pids)
    if not cases.empty:
        work = work.join(cases, on="primaryid")

    per_drug, per_case = _therapy_start(context, active_pids)
    if per_case is not None and "event_date" in work.columns:
        work = work.join(per_case.rename("start_case"), on="primaryid")
        start = work["start_case"]
        if per_drug is not None and "drug_seq" in work.columns:
            work = work.merge(per_drug, on=["primaryid", "drug_seq"], how="left")
            start = work["start_drug"].fillna(work["start_case"])
        tto = (work["event_date"] - start).dt.days.astype(float)
        work["tto"] = tto.where((tto >= 0) & (tto <= MAX_TTO_DAYS))
        work["tto_30d"] = (work["tto"] <= 30).astype(float).where(work["tto"].notna())

    indi = context.indi
    if indi is not None and {"primaryid", "indi_pt"} <= set(indi.columns):
        indi_pids = _clean_id(indi["primaryid"])
        mask = indi_pids.isin(active_pids)
        indi_sub = indi.loc[mask]
        indi_pids = indi_pids.loc[mask]
        terms = indi_sub["indi_pt"].fillna("").astype(str).str.strip().str.upper().str.split().str.join(" ")
        if event_mapper is not None:
            lookup = {t: event_mapper(t) for t in terms[terms != ""].unique()}
            terms = terms.map(lookup)
        ind = pd.DataFrame({"primaryid": indi_pids, "pt": terms}).dropna()
        ind = ind[(ind["primaryid"] != "") & (ind["pt"] != "")].drop_duplicates().assign(event_is_indication=1.0)
        work = work.merge(ind, on=["primaryid", "pt"], how="left")
        work["event_is_indication"] = work["event_is_indication"].fillna(0.0)

    grouped = work.groupby(keys, sort=False)
    out = grouped.size().rename("_n").reset_index()

    def mean_of(column: str) -> pd.Series:
        if column not in work.columns:
            return pd.Series(np.nan, index=out.index)
        return grouped[column].mean().reset_index(drop=True)

    out["frac_death"] = mean_of("death")
    out["frac_hosp_lt"] = mean_of("hosp_lt")
    out["frac_serious"] = mean_of("serious")
    out["frac_hcp"] = mean_of("hcp")
    out["frac_female"] = mean_of("female")
    out["mean_age"] = mean_of("age_years")
    if "tto" in work.columns:
        out["log_median_tto"] = np.log1p(grouped["tto"].median().reset_index(drop=True))
    else:
        out["log_median_tto"] = np.nan
    out["frac_tto_30d"] = mean_of("tto_30d")
    mean_drugs = mean_of("n_drugs")
    out["log_mean_drugs"] = np.log(mean_drugs.where(mean_drugs > 0))
    out["frac_primary_suspect"] = mean_of("primary")
    out["frac_event_is_indication"] = mean_of("event_is_indication")
    return out[keys + names]


def build_feature_frame(
    signals: pd.DataFrame,
    total_reports: int,
    case_features: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Full feature matrix (``ALL_FEATURES`` columns) aligned to ``signals`` rows."""
    frame = disproportionality_features(signals, total_reports)
    case_names = FEATURE_GROUPS["case"]
    if case_features is not None and not case_features.empty:
        lookup = case_features.set_index(["drugname", "pt"])[case_names]
        index = pd.MultiIndex.from_arrays([signals["drug"], signals["adverse_event"]])
        aligned = lookup.reindex(index)
        for name in case_names:
            frame[name] = aligned[name].astype(float).to_numpy()
    else:
        for name in case_names:
            frame[name] = np.nan
    return frame[ALL_FEATURES]
