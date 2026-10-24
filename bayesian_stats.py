"""
Bayesian disproportionality measures used in pharmacovigilance (BCPNN, EBGM/MGPS).

BCPNN: Information Component (IC) with approximate 95% credibility interval;
       signal when IC025 > 0 (WHO-UMC convention).

EBGM: DuMouchel gamma–Poisson empirical Bayes shrinkage with a dataset-level
       prior; EB05 is the 5th percentile of the posterior reporting rate.
       Signal when EB05 > 2 (FDA MGPS convention).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import optimize, stats
from scipy.special import gammaln

LN2 = math.log(2)
CC = 0.5  # continuity correction for sparse cells


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
        ic=round(ic, 4),
        ic025=round(ic025, 4),
        ic975=round(ic975, 4),
        signal_bcpnn=bool(ic025 > 0),
    )


@dataclass
class GammaPrior:
    """Gamma prior hyperparameters for Poisson–Gamma EBGM (shape α, rate β)."""

    alpha: float
    beta: float


def fit_gamma_poisson_prior(observed: np.ndarray, expected: np.ndarray) -> GammaPrior:
    """
    Estimate a single gamma prior across strata via marginal maximum likelihood
    (DuMouchel-style; one prior for all drug–event pairs in the table).
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
        # P(o|α,β,e) = Γ(o+α)/(Γ(α)Γ(o+1)) * (β/(β+e))^α * (e/(β+e))^o  (conjugate form)
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
    Observed count a ~ Poisson(μ * E), μ ~ Gamma(α, β) (shape–rate).
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
        ebgm=round(ebgm, 4),
        eb05=round(eb05, 4),
        eb95=round(eb95, 4),
        signal_ebgm=bool(eb05 > 2.0),
    )


def expected_count(a: int, b: int, c: int, d: int, n_total: int) -> float:
    row = a + b
    col = a + c
    return (row * col) / n_total if n_total else 0.0
