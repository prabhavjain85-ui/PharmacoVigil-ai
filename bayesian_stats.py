"""Bayesian and advanced statistical measures used in pharmacovigilance:
- BCPNN: Information Component (IC) with 95% credibility interval (Bate et al., 1998).
- EBGM / MGPS: Gamma-Poisson empirical Bayes shrinkage (DuMouchel, 1999).
- Benjamini-Hochberg (1995) step-up False Discovery Rate (FDR) q-values.
- Mantel-Haenszel (1959) stratified PRR / ROR and stratified IC across DEMO age x sex strata.
- Weibull time-to-onset (TTO) shape parameter MLE and hazard profile classification (Sauzet et al., 2013).
- Omega (Ω) shrinkage measure for 3-way drug-drug-event interactions (Norén et al., 2008).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np
from scipy import optimize, stats
from scipy.special import gammaln

LN2 = math.log(2)
CC = 0.5  # continuity correction for sparse cells


def _js_round(val: float, decimals: int) -> float:
    """Match JavaScript Math.round(val * 10**decimals) / 10**decimals."""
    scale = 10 ** decimals
    return math.floor(val * scale + 0.5) / scale if val >= 0 else math.ceil(val * scale - 0.5) / scale


@dataclass(frozen=True)
class BcpnnResult:
    ic: float
    ic025: float
    ic975: float
    signal_bcpnn: bool


@dataclass(frozen=True)
class EbgmResult:
    ebgm: float
    eb05: float
    eb95: float
    signal_ebgm: bool


def bcpnn(a: int, b: int, c: int, d: int, n_total: int) -> BcpnnResult:
    """Information Component with normal approximation to the posterior (log2 scale)."""
    ac = a + CC
    bc = b + CC
    cc = c + CC
    dc = d + CC
    n_c = n_total
    ic = math.log2((ac * n_c) / ((ac + bc) * (ac + cc)))
    variance = (1 / (LN2 ** 2)) * (1 / ac + 1 / bc + 1 / cc + 1 / dc)
    se = math.sqrt(variance)
    ic025 = ic - 1.96 * se
    ic975 = ic + 1.96 * se
    return BcpnnResult(
        ic=_js_round(ic, 4),
        ic025=_js_round(ic025, 4),
        ic975=_js_round(ic975, 4),
        signal_bcpnn=bool(ic025 > 0),
    )


@dataclass
class GammaPrior:
    """Gamma prior hyperparameters for Poisson-Gamma EBGM (shape α, rate β)."""

    alpha: float
    beta: float


def fit_gamma_poisson_prior(observed: np.ndarray, expected: np.ndarray) -> GammaPrior:
    """
    Estimate a single gamma prior across strata via marginal maximum likelihood
    (DuMouchel-style; one prior for all drug-event pairs in the table).
    """
    o = np.asarray(observed, dtype=float)
    e = np.asarray(expected, dtype=float)
    mask = (e > 0) & (o >= 0)
    o = o[mask]
    e = e[mask]
    if len(o) < 3:
        return GammaPrior(alpha=1.0, beta=1.0)

    def neg_log_marginal(params: np.ndarray) -> float:
        alpha, beta = params
        if alpha <= 0.05 or beta <= 0.05:
            return 1e12
        log_p = (
            gammaln(o + alpha)
            - gammaln(alpha)
            - gammaln(o + 1)
            + alpha * np.log(beta / (beta + e))
            + o * np.log(e / (beta + e))
        )
        return -float(np.sum(log_p))

    result = optimize.minimize(
        neg_log_marginal,
        x0=np.array([1.0, 1.0]),
        method="L-BFGS-B",
        bounds=[(0.05, 50.0), (0.05, 50.0)],
    )
    if result.success:
        return GammaPrior(alpha=float(result.x[0]), beta=float(result.x[1]))
    return GammaPrior(alpha=1.0, beta=1.0)


def ebgm_pair(a: int, expected: float, prior: GammaPrior) -> EbgmResult:
    """
    Posterior mean (EBGM) and 5th/95th percentiles for relative reporting rate μ.
    Observed count a ~ Poisson(μ * E), μ ~ Gamma(α, β) (shape-rate).
    """
    alpha, beta = prior.alpha, prior.beta
    post_shape = a + alpha
    post_rate = expected + beta
    if post_rate <= 0:
        post_rate = 1e-9
    ebgm = post_shape / post_rate
    eb05 = float(stats.gamma.ppf(0.05, post_shape, scale=1 / post_rate))
    eb95 = float(stats.gamma.ppf(0.95, post_shape, scale=1 / post_rate))
    return EbgmResult(
        ebgm=_js_round(ebgm, 4),
        eb05=_js_round(eb05, 4),
        eb95=_js_round(eb95, 4),
        signal_ebgm=bool(eb05 > 2.0),
    )


def expected_count(a: int, b: int, c: int, d: int, n_total: int) -> float:
    row = a + b
    col = a + c
    return (row * col) / n_total if n_total else 0.0


def benjamini_hochberg(p_values: Sequence[float]) -> list[float]:
    """
    Benjamini-Hochberg (1995) step-up False Discovery Rate (FDR) q-values.
    Given m p-values p_1..p_m, orders p_(1) <= ... <= p_(m) and computes
    q_(k) = min(1, min_{j >= k} (m / j) * p_(j)).
    """
    m = len(p_values)
    if m == 0:
        return []
    indexed = sorted(
        [(idx, max(0.0, min(1.0, float(p))) if math.isfinite(float(p)) else 1.0) for idx, p in enumerate(p_values)],
        key=lambda x: (x[1], x[0]),
    )
    q_sorted = [1.0] * m
    running_min = 1.0
    for i in range(m - 1, -1, -1):
        rank = i + 1
        raw_q = (m / rank) * indexed[i][1]
        if raw_q < running_min:
            running_min = raw_q
        q_sorted[i] = min(1.0, running_min)

    out = [1.0] * m
    for i in range(m):
        out[indexed[i][0]] = _js_round(q_sorted[i], 6)
    return out


def compute_mantel_haenszel(strata: Sequence[dict[str, Any]]) -> dict[str, float | None]:
    """
    Computes Mantel-Haenszel (1959) adjusted PRR, adjusted ROR, and WHO-UMC stratified IC
    across demographic strata (e.g. Age Band x Sex).
    """
    prr_num = 0.0
    prr_den = 0.0
    ror_num = 0.0
    ror_den = 0.0
    obs_sum = 0.0
    exp_sum = 0.0
    valid_strata = 0

    for s in strata:
        n = int(s.get("n_total", s["a"] + s["b"] + s["c"] + s["d"]))
        if n <= 0:
            continue
        a = int(s["a"])
        b = int(s["b"])
        c = int(s["c"])
        d = int(s["d"])
        ab = a + b
        cd = c + d
        ac = a + c
        if ab > 0 and cd > 0:
            prr_num += (a * cd) / n
            prr_den += (c * ab) / n
            ror_num += (a * d) / n
            ror_den += (b * c) / n
        if ab > 0 and ac > 0:
            obs_sum += a
            exp_sum += (ab * ac) / n
            valid_strata += 1

    prr_mh = _js_round(prr_num / prr_den, 3) if (prr_den > 0 and prr_num > 0) else None
    ror_mh = _js_round(ror_num / ror_den, 3) if (ror_den > 0 and ror_num > 0) else None
    ic_stratified = (
        _js_round(math.log2((obs_sum + 0.5) / (exp_sum + 0.5)), 4)
        if valid_strata > 0
        else None
    )
    return {
        "prr_mh": prr_mh,
        "ror_mh": ror_mh,
        "ic_stratified": ic_stratified,
    }


def fit_weibull_tto(
    drug: str,
    adverse_event: str,
    raw_days: Sequence[float],
    min_cases: int = 10,
) -> dict[str, Any] | None:
    """
    Fits a 2-parameter Weibull distribution f(t; k, λ) = (k/λ)(t/λ)^(k-1) exp(-(t/λ)^k)
    via Maximum Likelihood Estimation (Sauzet et al., Drug Safety 2013).
    """
    valid_days = [float(d) for d in raw_days if d is not None and math.isfinite(float(d)) and 0 <= float(d) <= 3650]
    if len(valid_days) < min_cases:
        return None

    sorted_raw = sorted(valid_days)
    n = len(sorted_raw)
    t = [0.5 if d <= 0 else d for d in sorted_raw]
    ln_t = [math.log(v) for v in t]
    mean_ln_t = sum(ln_t) / n

    k = 1.0
    for _ in range(40):
        s0 = 0.0
        s1 = 0.0
        s2 = 0.0
        for i in range(n):
            tk = t[i] ** k
            x = ln_t[i]
            s0 += tk
            s1 += tk * x
            s2 += tk * x * x
        if s0 <= 0:
            break
        ratio1 = s1 / s0
        g = 1.0 / k + mean_ln_t - ratio1
        if abs(g) < 1e-11:
            break
        dg = -1.0 / (k * k) - (s2 / s0 - ratio1 * ratio1)
        if dg >= -1e-12:
            break
        next_k = k - g / dg
        k = min(20.0, next_k) if next_k > 0.05 else k * 0.5

    sum_tk = sum(v ** k for v in t)
    lam = (sum_tk / n) ** (1.0 / k)

    se_ln_k = math.sqrt(6.0 / (math.pi * math.pi * n))
    ci_low = k * math.exp(-1.96 * se_ln_k)
    ci_high = k * math.exp(1.96 * se_ln_k)

    regime = "random"
    interpretation = (
        "Random / constant hazard (95% CI includes 1.0): event rate is approximately constant over treatment time."
    )
    if ci_high < 1.0:
        regime = "early_failure"
        interpretation = (
            "Early failure / decreasing hazard (k < 1): risk peaks shortly after treatment initiation (typical of hypersensitivity or acute intolerance)."
        )
    elif ci_low > 1.0:
        regime = "wear_out"
        interpretation = (
            "Wear-out / increasing hazard (k > 1): risk increases with cumulative duration of therapy (typical of cumulative dose toxicity)."
        )
    elif k < 0.85:
        interpretation = (
            "Early-onset tendency (point estimate k < 1, 95% CI spans 1.0): cases cluster early after initiation but sample size does not exclude constant hazard."
        )
    elif k > 1.15:
        interpretation = (
            "Delayed-onset tendency (point estimate k > 1, 95% CI spans 1.0): cases cluster later in therapy but sample size does not exclude constant hazard."
        )

    def quantile(q: float) -> float:
        pos = (n - 1) * q
        lo = math.floor(pos)
        hi = math.ceil(pos)
        return sorted_raw[lo] if lo == hi else sorted_raw[lo] + (sorted_raw[hi] - sorted_raw[lo]) * (pos - lo)

    max_day = max(30, min(365, math.ceil(sorted_raw[-1] * 1.05)))
    num_grid = 25
    curve = []
    for j in range(num_grid):
        day = max(0.5, _js_round(((j + 1) / num_grid) * max_day, 1))
        ratio = day / lam
        rk = ratio ** k
        survival = math.exp(-rk)
        fitted_cdf = 1.0 - survival
        hazard = (k / lam) * (ratio ** (k - 1.0))
        density = hazard * survival
        emp_count = sum(1 for d in sorted_raw if d <= day)
        curve.append({
            "day": day,
            "density": _js_round(density, 4),
            "survival": _js_round(survival, 4),
            "hazard": _js_round(hazard, 4),
            "empirical_cdf": _js_round(emp_count / n, 4),
            "fitted_cdf": _js_round(fitted_cdf, 4),
        })

    return {
        "drug": drug,
        "adverse_event": adverse_event,
        "n_cases_with_tto": n,
        "median_days": _js_round(quantile(0.5), 3),
        "iqr_low": _js_round(quantile(0.25), 3),
        "iqr_high": _js_round(quantile(0.75), 3),
        "shape_k": _js_round(k, 4),
        "shape_ci_low": _js_round(ci_low, 4),
        "shape_ci_high": _js_round(ci_high, 4),
        "scale_lambda": _js_round(lam, 3),
        "regime": regime,
        "interpretation": interpretation,
        "onset_days": sorted_raw,
        "curve": curve,
    }


def compute_omega_interaction(
    n111: int,
    n11: int,
    n101: int,
    n10: int,
    n011: int,
    n01: int,
    n001: int,
    n00: int,
) -> dict[str, Any]:
    """
    Norén et al. (2008) Omega (Ω) shrinkage measure for drug-drug interaction (DDI) detection.
    """
    eps = 1e-6
    total_n = n00 + n10 + n01 + n11
    total_e = n001 + n101 + n011 + n111
    fallback_rate = max(eps, min(1.0 - eps, total_e / max(1, total_n)))

    def safe_prop(e_count: int, tot_count: int) -> float:
        if tot_count <= 0:
            return fallback_rate
        return max(eps, min(1.0 - eps, e_count / tot_count))

    f00 = safe_prop(n001, n00)
    f10 = safe_prop(n101, n10)
    f01 = safe_prop(n011, n01)
    f11 = safe_prop(n111, n11)

    odds00 = f00 / (1.0 - f00)
    odds10 = f10 / (1.0 - f10)
    odds01 = f01 / (1.0 - f01)

    denom = max(odds00, odds10) + max(odds00, odds01) - odds00 + 1.0
    g11 = max(eps, min(1.0 - eps, 1.0 - 1.0 / denom))
    expected_111 = g11 * n11

    alpha = 0.5
    omega = math.log2((n111 + alpha) / (expected_111 + alpha))
    half_width = 1.96 / (LN2 * math.sqrt(n111 + alpha))
    omega025 = omega - half_width
    omega975 = omega + half_width

    return {
        "f00": _js_round(f00, 4),
        "f10": _js_round(f10, 4),
        "f01": _js_round(f01, 4),
        "f11": _js_round(f11, 4),
        "g11": _js_round(g11, 4),
        "expected_111": _js_round(expected_111, 4),
        "omega": _js_round(omega, 4),
        "omega025": _js_round(omega025, 4),
        "omega975": _js_round(omega975, 4),
        "signal_omega": bool(omega025 > 0),
    }
