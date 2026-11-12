"""Hand-checked unit tests for all new pharmacovigilance statistical methods
with explicit step-by-step arithmetic documented in comments.
"""

from __future__ import annotations

import math
import pandas as pd

from bayesian_stats import (
    benjamini_hochberg,
    compute_mantel_haenszel,
    compute_omega_interaction,
    fit_weibull_tto,
)
from faers_signal_detection import (
    build_case_level_table,
    compute_disproportionality,
    compute_drug_interactions,
    compute_stratified_analysis,
    compute_temporal_signal_series,
    deduplicate_demo_by_caseid,
    detect_probable_duplicates,
)


def test_caseid_version_deduplication_and_probable_duplicates():
    """
    Hand-checked arithmetic for:
    1) DEMO caseid + caseversion deduplication:
       - caseid 100 has versions 1 (primaryid 1001) and 3 (primaryid 1003) -> keep 1003
       - caseid 200 has version 2 (primaryid 2002) -> keep 2002
       - caseid 300 has version 1 (primaryid 3001) -> keep 3001
       Total raw rows = 4, deduplicated = 3, superseded dropped = 1.

    2) Probable-duplicate score between primaryid 2002 (caseid 200) and primaryid 3001 (caseid 300):
       - Shared drugs: {"WARFARIN"} / {"WARFARIN"} -> drug_jaccard = 1 / 1 = 1.0
       - Shared reactions: {"GI BLEED"} / {"GI BLEED"} -> reac_jaccard = 1 / 1 = 1.0
       - Event date: "20240510" == "20240510" -> date_score = 1.0
       - Age: 68 YR vs 69 YR (diff = 1 <= 2) -> age_score = 0.7
       - Sex: "F" == "F" -> sex_score = 1.0
       - Country: "US" == "US" -> country_score = 1.0
       Weighted score:
         0.30*(1.0) + 0.25*(1.0) + 0.15*(1.0) + 0.12*(0.7) + 0.10*(1.0) + 0.08*(1.0)
         = 0.30 + 0.25 + 0.15 + 0.084 + 0.10 + 0.08
         = 0.964 >= 0.72 threshold.
    """
    demo = pd.DataFrame([
        {"primaryid": "1001", "caseid": "100", "caseversion": "1", "event_dt": "20240101", "age": "50", "age_cod": "YR", "sex": "M", "occr_country": "US"},
        {"primaryid": "1003", "caseid": "100", "caseversion": "3", "event_dt": "20240105", "age": "50", "age_cod": "YR", "sex": "M", "occr_country": "US"},
        {"primaryid": "2002", "caseid": "200", "caseversion": "2", "event_dt": "20240510", "age": "68", "age_cod": "YR", "sex": "F", "occr_country": "US"},
        {"primaryid": "3001", "caseid": "300", "caseversion": "1", "event_dt": "20240510", "age": "69", "age_cod": "YR", "sex": "F", "occr_country": "US"},
    ])
    drug = pd.DataFrame([
        {"primaryid": "1001", "drugname": "ASPIRIN", "role_cod": "PS"},
        {"primaryid": "1003", "drugname": "IBUPROFEN", "role_cod": "PS"},
        {"primaryid": "2002", "drugname": "WARFARIN", "role_cod": "PS"},
        {"primaryid": "3001", "drugname": "WARFARIN", "role_cod": "PS"},
    ])
    reac = pd.DataFrame([
        {"primaryid": "1001", "pt": "NAUSEA"},
        {"primaryid": "1003", "pt": "NAUSEA"},
        {"primaryid": "2002", "pt": "GI BLEED"},
        {"primaryid": "3001", "pt": "GI BLEED"},
    ])

    dedup, dropped = deduplicate_demo_by_caseid(demo)
    assert dropped == 1
    assert list(dedup["primaryid"]) == ["1003", "2002", "3001"]

    pairs = build_case_level_table(demo, drug, reac)
    assert "1001" not in set(pairs["primaryid"])
    assert "1003" in set(pairs["primaryid"])

    dup_res = detect_probable_duplicates(demo, drug, reac)
    assert len(dup_res["flagged_pairs"]) == 1
    pair = dup_res["flagged_pairs"][0]
    assert pair["primaryid_a"] == "2002"
    assert pair["primaryid_b"] == "3001"
    assert pair["score"] == 0.964
    assert "age (±2y)" in pair["matching_fields"]


def test_benjamini_hochberg_hand_computed():
    """
    Hand-checked Benjamini-Hochberg (1995) step-up FDR q-values for m = 4 p-values:
      Input p = [0.04, 0.001, 0.20, 0.012]
      Sorted ascending:
        rank 1 (orig idx 1): p_(1) = 0.001 -> raw = (4 / 1) * 0.001 = 0.004
        rank 2 (orig idx 3): p_(2) = 0.012 -> raw = (4 / 2) * 0.012 = 0.024
        rank 3 (orig idx 0): p_(3) = 0.040 -> raw = (4 / 3) * 0.040 = 0.0533333 -> min with rank 4 is 0.053333
        rank 4 (orig idx 2): p_(4) = 0.200 -> raw = (4 / 4) * 0.200 = 0.200
      Also check monotonicity enforcement when raw_q_(k) > raw_q_(k+1):
        For p = [0.01, 0.025, 0.026] (m = 3):
          rank 3: p_(3) = 0.026 -> (3/3)*0.026 = 0.026
          rank 2: p_(2) = 0.025 -> (3/2)*0.025 = 0.0375 -> capped at running_min = 0.026
          rank 1: p_(1) = 0.010 -> (3/1)*0.010 = 0.030  -> capped at running_min = 0.026
    """
    q = benjamini_hochberg([0.04, 0.001, 0.20, 0.012])
    assert q == [0.053333, 0.004, 0.2, 0.024]

    q_mono = benjamini_hochberg([0.01, 0.025, 0.026])
    assert q_mono == [0.026, 0.026, 0.026]


def test_mantel_haenszel_simpsons_paradox_hand_computed():
    """
    Hand-checked Mantel-Haenszel (1959) stratified PRR, ROR, and IC_stratified
    demonstrating confounding by age band:

    Stratum 1 (Young, N1 = 100):
      Drug exposed (a1 + b1 = 10): a1 = 1, b1 = 9   (risk = 1/10 = 10%)
      Unexposed    (c1 + d1 = 90): c1 = 9, d1 = 81  (risk = 9/90 = 10%)
      Stratum 1 PRR = (1/10) / (9/90) = 1.000, ROR = (1*81)/(9*9) = 1.000
      Expected E1 = (10 * 10) / 100 = 1.0

    Stratum 2 (Elderly, N2 = 100):
      Drug exposed (a2 + b2 = 90): a2 = 45, b2 = 45 (risk = 45/90 = 50%)
      Unexposed    (c2 + d2 = 10): c2 = 5,  d2 = 5  (risk = 5/10  = 50%)
      Stratum 2 PRR = (45/90) / (5/10) = 1.000, ROR = (45*5)/(45*5) = 1.000
      Expected E2 = (90 * 50) / 100 = 45.0

    Pooled (ignoring stratum):
      a = 46, b = 54 (a+b = 100), c = 14, d = 86 (c+d = 100)
      Pooled PRR = (46/100) / (14/100) = 46/14 = 3.2857 -> 3.286 (spurious signal!)

    Mantel-Haenszel Adjusted:
      prr_num = a1*(c1+d1)/N1 + a2*(c2+d2)/N2 = 1*90/100 + 45*10/100 = 0.90 + 4.50 = 5.40
      prr_den = c1*(a1+b1)/N1 + c2*(a2+b2)/N2 = 9*10/100 + 5*90/100  = 0.90 + 4.50 = 5.40
      PRR_MH  = 5.40 / 5.40 = 1.000

      ror_num = a1*d1/N1 + a2*d2/N2 = 81/100 + 225/100 = 3.06
      ror_den = b1*c1/N1 + b2*c2/N2 = 81/100 + 225/100 = 3.06
      ROR_MH  = 3.06 / 3.06 = 1.000

      IC_stratified = log2((obs_sum + 0.5) / (exp_sum + 0.5))
                    = log2((46 + 0.5) / (46.0 + 0.5)) = log2(1.0) = 0.0000
    """
    strata = [
        {"stratum": "18-44|F", "a": 1, "b": 9, "c": 9, "d": 81, "n_total": 100},
        {"stratum": "65+|F", "a": 45, "b": 45, "c": 5, "d": 5, "n_total": 100},
    ]
    mh = compute_mantel_haenszel(strata)
    assert mh["prr_mh"] == 1.0
    assert mh["ror_mh"] == 1.0
    assert mh["ic_stratified"] == 0.0


def test_weibull_tto_hand_computed():
    """
    Hand-checked Weibull TTO Maximum Likelihood fit:
    For exact exponential / constant-hazard quantiles generated with true k = 2.0, lambda = 30.0:
      t_i = 30 * (-ln(1 - p_i))^(1 / 2.0) for p_i = (i + 0.5) / 20, i = 0..19
    And for early-failure data (k < 1) vs wear-out data (k > 1):
      - Early-failure sample: [0.5, 0.5, 1, 1, 1, 2, 2, 3, 5, 10, 25, 60] (n = 12) -> k < 1, early_failure
      - Wear-out sample: [25, 27, 28, 29, 30, 30, 31, 31, 32, 33, 34, 35] (n = 12) -> k > 1, wear_out
      - Asymptotic SE of ln(k) is sqrt(6 / (pi^2 * n)):
        For n = 12: se_ln_k = sqrt(6 / (9.8696044 * 12)) = sqrt(0.05066059) = 0.225079
        95% CI multiplier = exp(±1.96 * 0.225079) = exp(±0.441155) = [0.6433 * k, 1.5545 * k]
    """
    early_days = [0.5, 0.5, 1, 1, 1, 2, 2, 3, 5, 10, 25, 60]
    early_fit = fit_weibull_tto("DRUG_A", "ANAPHYLAXIS", early_days)
    assert early_fit is not None
    assert early_fit["n_cases_with_tto"] == 12
    assert early_fit["shape_k"] < 1.0

    wear_days = [25, 27, 28, 29, 30, 30, 31, 31, 32, 33, 34, 35]
    wear_fit = fit_weibull_tto("DRUG_B", "FIBROSIS", wear_days)
    assert wear_fit is not None
    assert wear_fit["shape_k"] > 5.0
    assert wear_fit["regime"] == "wear_out"

    # Verify exact CI formula from Fisher information: ci_low = k * exp(-1.96 * sqrt(6 / (pi^2 * 12)))
    se_ln_k = math.sqrt(6.0 / (math.pi * math.pi * 12))
    expected_ci_low = round(wear_fit["shape_k"] * math.exp(-1.96 * se_ln_k), 3)
    assert abs(wear_fit["shape_ci_low"] - expected_ci_low) <= 0.01


def test_omega_interaction_hand_computed():
    """
    Hand-checked Norén et al. (2008) Omega (Ω) 3-way interaction shrinkage measure:
      4 mutually exclusive exposure cells:
        00 (neither A nor B): n001 = 10 events out of n00 = 1000 reports -> f00 = 10/1000 = 0.01
        10 (A without B):     n101 = 4  events out of n10 = 200  reports -> f10 = 4/200   = 0.02
        01 (B without A):     n011 = 4  events out of n01 = 200  reports -> f01 = 4/200   = 0.02
        11 (both A and B):    n111 = 12 events out of n11 = 100  reports -> f11 = 12/100  = 0.12

      Step-by-step arithmetic:
        odds00 = 0.01 / 0.99 = 0.01010101
        odds10 = 0.02 / 0.98 = 0.02040816
        odds01 = 0.02 / 0.98 = 0.02040816
        denom  = max(odds00, odds10) + max(odds00, odds01) - odds00 + 1
               = 0.02040816 + 0.02040816 - 0.01010101 + 1 = 1.03071531
        g11    = 1 - 1 / 1.03071531 = 0.029800
        expected_111 = g11 * n11 = 0.029800 * 100 = 2.9800
        omega  = log2((12 + 0.5) / (2.9800 + 0.5)) = log2(12.5 / 3.4800) = log2(3.591954) = 1.8448
        half_width = 1.96 / (ln(2) * sqrt(12.5)) = 1.96 / (0.693147 * 3.535534) = 0.7998
        omega025 = 1.8448 - 0.7998 = 1.0450 > 0 -> signal_omega = True
    """
    res = compute_omega_interaction(
        n111=12, n11=100,
        n101=4,  n10=200,
        n011=4,  n01=200,
        n001=10, n00=1000,
    )
    assert res["f00"] == 0.01
    assert res["f10"] == 0.02
    assert res["f01"] == 0.02
    assert res["f11"] == 0.12
    assert abs(res["expected_111"] - 2.98) < 0.001
    assert abs(res["omega"] - 1.8448) < 0.001
    assert abs(res["omega025"] - 1.045) < 0.001
    assert res["signal_omega"] is True


def test_temporal_signal_series_and_changepoint():
    """
    Hand-checked temporal cumulative IC and 2-segment Poisson LLR G^2 change-point detection:
    Suppose across 4 quarters (2024-Q1..2024-Q4), each quarter has 50 total reports and 10 reports for DRUG_X.
    Other drugs have 2 reports of EVENT_Y per quarter.
    DRUG_X has:
      Q1: 0 reports of EVENT_Y (out of 10 DRUG_X reports)
      Q2: 0 reports of EVENT_Y (out of 10 DRUG_X reports)
      Q3: 8 reports of EVENT_Y (out of 10 DRUG_X reports)
      Q4: 8 reports of EVENT_Y (out of 10 DRUG_X reports)
    Total DRUG_X reports M = 40, total pair reports A = 16, baseline rate = 16/40 = 0.40.
    At split before Q3 (pre = Q1+Q2, post = Q3+Q4):
      preA = 0, preM = 20, e1 = 16 * (20/40) = 8.0 -> term1 = 0
      postA = 16, postM = 20, e2 = 16 * (20/40) = 8.0 -> term2 = 16 * ln(16 / 8) = 16 * 0.693147 = 11.09035
      G^2 = 2 * 11.09035 = 22.1807 >= 6.63 -> changepoint_detected = True at "2024-Q3"!
    """
    rows = []
    quarters = [("20240201", 0), ("20240501", 0), ("20240801", 8), ("20241101", 8)]
    pid_counter = 1
    for q_dt, n_hit in quarters:
        # 10 DRUG_X reports
        for i in range(10):
            pid = f"P{pid_counter}"
            pid_counter += 1
            ev = "EVENT_Y" if i < n_hit else "OTHER_EV"
            rows.append({"primaryid": pid, "drugname": "DRUG_X", "pt": ev, "event_dt": q_dt})
        # 2 reports of EVENT_Y on OTHER_DRUG
        for _ in range(2):
            pid = f"P{pid_counter}"
            pid_counter += 1
            rows.append({"primaryid": pid, "drugname": "OTHER_DRUG", "pt": "EVENT_Y", "event_dt": q_dt})
        # 38 background reports
        for _ in range(38):
            pid = f"P{pid_counter}"
            pid_counter += 1
            rows.append({"primaryid": pid, "drugname": "OTHER_DRUG", "pt": "OTHER_EV", "event_dt": q_dt})

    pairs = pd.DataFrame(rows)
    series = compute_temporal_signal_series(pairs, "DRUG_X", "EVENT_Y", "quarter")
    # At 2024-Q3: cum_a=8, cum_b=22, cum_c=6, cum_d=114, N=150 -> IC=1.4552, SE=0.8220 -> IC025 = -0.1560 <= 0
    # At 2024-Q4: cum_a=16, cum_b=24, cum_c=8, cum_d=152, N=200 -> IC=1.6868, SE=0.6853 -> IC025 = +0.3437 > 0
    assert series["points"][2]["cum_ic025"] == -0.156
    assert series["points"][3]["cum_ic025"] == 0.3437
    assert series["first_ic025_gt0_period"] == "2024-Q4"
    assert series["changepoint_detected"] is True
    assert series["changepoint_period"] == "2024-Q3"
    assert abs(series["changepoint_llr"] - 22.1807) < 0.001
    assert series["pre_rate"] == 0.0
    assert series["post_rate"] == 0.8
