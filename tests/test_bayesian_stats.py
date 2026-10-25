"""Tests for BCPNN and EBGM with hand-checked reference values."""
import math

import numpy as np

from bayesian_stats import bcpnn, ebgm_pair, expected_count, fit_gamma_poisson_prior


def test_bcpnn_hand_computed_ic():
    # 2×2 table: a=10, b=20, c=15, d=155, N=200
    a, b, c, d, n = 10, 20, 15, 155, 200
    result = bcpnn(a, b, c, d, n)
    ac, bc, cc, dc = a + 0.5, b + 0.5, c + 0.5, d + 0.5
    expected_ic = math.log2((ac * n) / ((ac + bc) * (ac + cc)))
    variance = (1 / (math.log(2) ** 2)) * (1 / ac + 1 / bc + 1 / cc + 1 / dc)
    expected_ic025 = expected_ic - 1.96 * math.sqrt(variance)
    assert result.ic == round(expected_ic, 4)
    assert result.ic025 == round(expected_ic025, 4)
    assert result.signal_bcpnn == (result.ic025 > 0)


def test_expected_count():
    assert expected_count(10, 20, 15, 155, 200) == (30 * 25) / 200


def test_ebgm_with_fixed_prior():
    prior = fit_gamma_poisson_prior(
        np.array([10.0, 4.0, 2.0]),
        np.array([5.0, 8.0, 3.0]),
    )
    exp = expected_count(10, 20, 15, 155, 200)
    result = ebgm_pair(10, exp, prior)
    repeat = ebgm_pair(10, exp, prior)
    assert result.ebgm == repeat.ebgm
    assert result.eb05 <= result.ebgm <= result.eb95


def test_bcpnn_warfarin_gi_bleed_contingency():
    """Contingency from committed sample (WARFARIN × GI haemorrhage)."""
    a, b, c, d, n = 18, 20, 27, 135, 200
    result = bcpnn(a, b, c, d, n)
    assert result.ic > 0
    assert result.ic975 > 1.0
