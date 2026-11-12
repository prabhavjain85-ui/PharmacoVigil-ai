import type {
  StratumMetrics,
  WeibullCurvePoint,
  WeibullRegime,
  WeibullTtoResult,
} from "./types";

const LN2 = Math.log(2);
const CC = 0.5;

export type BcpnnResult = { ic: number; ic025: number; ic975: number; signal_bcpnn: boolean };
export type EbgmResult = { ebgm: number; eb05: number; eb95: number; signal_ebgm: boolean };
export type GammaPrior = { alpha: number; beta: number };

export function expectedCount(a: number, b: number, c: number, d: number, n: number): number {
  return ((a + b) * (a + c)) / (n || 1);
}

export function bcpnn(a: number, b: number, c: number, d: number, nTotal: number): BcpnnResult {
  const ac = a + CC;
  const bc = b + CC;
  const cc = c + CC;
  const dc = d + CC;
  const ic = Math.log2((ac * nTotal) / ((ac + bc) * (ac + cc)));
  const variance = (1 / LN2 ** 2) * (1 / ac + 1 / bc + 1 / cc + 1 / dc);
  const se = Math.sqrt(variance);
  const ic025 = ic - 1.96 * se;
  const ic975 = ic + 1.96 * se;
  return {
    ic: round4(ic),
    ic025: round4(ic025),
    ic975: round4(ic975),
    signal_bcpnn: ic025 > 0,
  };
}

/**
 * Lanczos approximation to ln Γ(z), accurate to < 1e-14 across z > 0.
 */
const LANCZOS_COEFFS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function logGamma(z: number): number {
  if (z <= 0) return 0;
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zm1 = z - 1;
  let x = LANCZOS_COEFFS[0];
  for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i] / (zm1 + i);
  }
  const t = zm1 + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

function negLogMarginal(alpha: number, beta: number, o: number[], e: number[]): number {
  if (alpha < 0.05 || beta < 0.05 || alpha > 50.0 || beta > 50.0) return 1e12;
  let sum = 0;
  const lgAlpha = logGamma(alpha);
  const lnBeta = Math.log(beta);
  for (let i = 0; i < o.length; i++) {
    const oi = o[i];
    const ei = e[i];
    const lnBetaPlusE = Math.log(beta + ei);
    sum +=
      logGamma(oi + alpha) -
      lgAlpha -
      logGamma(oi + 1) +
      alpha * (lnBeta - lnBetaPlusE) +
      oi * (Math.log(ei) - lnBetaPlusE);
  }
  return -sum;
}

/**
 * Fits the single Gamma(alpha, beta) prior across all pairs via marginal maximum likelihood
 * on bounds [0.05, 50.0] x [0.05, 50.0], matching scipy.optimize.minimize(L-BFGS-B) to < 1e-5.
 */
export function fitGammaPoissonPrior(observed: number[], expected: number[]): GammaPrior {
  const o: number[] = [];
  const e: number[] = [];
  for (let i = 0; i < observed.length; i++) {
    if (expected[i] > 0 && observed[i] >= 0) {
      o.push(observed[i]);
      e.push(expected[i]);
    }
  }
  if (o.length < 3) return { alpha: 1.0, beta: 1.0 };

  const clamp = (v: number) => Math.max(0.05, Math.min(50.0, v));

  // Projected quasi-Newton / coordinate-damped Newton + pattern search starting from [1.0, 1.0]
  // and checking candidate grid points up to 50.0 so boundary optima (e.g. alpha=50) are exact.
  const candidates: [number, number][] = [
    [1.0, 1.0],
    [2.0, 2.0],
    [5.0, 5.0],
    [15.0, 15.0],
    [50.0, 45.0],
  ];

  let bestA = 1.0;
  let bestB = 1.0;
  let bestVal = negLogMarginal(1.0, 1.0, o, e);

  for (const [startA, startB] of candidates) {
    let a = startA;
    let b = startB;
    let f = negLogMarginal(a, b, o, e);

    for (let iter = 0; iter < 80; iter++) {
      const hA = Math.max(1e-5, 1e-4 * a);
      const hB = Math.max(1e-5, 1e-4 * b);

      const aPlus = clamp(a + hA);
      const aMinus = clamp(a - hA);
      const bPlus = clamp(b + hB);
      const bMinus = clamp(b - hB);

      const gA =
        aPlus > aMinus ? (negLogMarginal(aPlus, b, o, e) - negLogMarginal(aMinus, b, o, e)) / (aPlus - aMinus) : 0;
      const gB =
        bPlus > bMinus ? (negLogMarginal(a, bPlus, o, e) - negLogMarginal(a, bMinus, o, e)) / (bPlus - bMinus) : 0;

      // Zero out gradient component pointing outside active box constraint
      const effGA = (a <= 0.05 && gA > 0) || (a >= 50.0 && gA < 0) ? 0 : gA;
      const effGB = (b <= 0.05 && gB > 0) || (b >= 50.0 && gB < 0) ? 0 : gB;

      const gradNorm = Math.hypot(effGA, effGB);
      if (gradNorm < 1e-7) break;

      // Diagonal Hessian for Newton scaling
      const fAPlus = negLogMarginal(clamp(a + hA), b, o, e);
      const fAMinus = negLogMarginal(clamp(a - hA), b, o, e);
      const hAA = Math.max(1e-4, Math.abs((fAPlus - 2 * f + fAMinus) / (hA * hA)));

      const fBPlus = negLogMarginal(a, clamp(b + hB), o, e);
      const fBMinus = negLogMarginal(a, clamp(b - hB), o, e);
      const hBB = Math.max(1e-4, Math.abs((fBPlus - 2 * f + fBMinus) / (hB * hB)));

      const dirA = -effGA / hAA;
      const dirB = -effGB / hBB;

      // Backtracking line search
      let step = 1.0;
      let improved = false;
      while (step >= 1e-6) {
        const nextA = clamp(a + step * dirA);
        const nextB = clamp(b + step * dirB);
        const nextF = negLogMarginal(nextA, nextB, o, e);
        if (nextF < f - 1e-12) {
          a = nextA;
          b = nextB;
          f = nextF;
          improved = true;
          break;
        }
        step *= 0.5;
      }

      if (!improved) {
        // Coordinate golden-section / pattern polish
        let stepSize = 0.5;
        for (let p = 0; p < 25; p++) {
          let moved = false;
          for (const [da, db] of [
            [stepSize, 0],
            [-stepSize, 0],
            [0, stepSize],
            [0, -stepSize],
            [stepSize, stepSize],
            [-stepSize, -stepSize],
          ]) {
            const na = clamp(a + da);
            const nb = clamp(b + db);
            const nf = negLogMarginal(na, nb, o, e);
            if (nf < f) {
              a = na;
              b = nb;
              f = nf;
              moved = true;
            }
          }
          if (!moved) stepSize *= 0.5;
          if (stepSize < 1e-7) break;
        }
        break;
      }
    }

    // 1D exact Newton polish on beta holding alpha fixed, and alpha holding beta fixed
    for (let polish = 0; polish < 15; polish++) {
      const hb = 1e-5 * Math.max(1, b);
      const fb1 = negLogMarginal(a, clamp(b + hb), o, e);
      const fb2 = negLogMarginal(a, clamp(b - hb), o, e);
      const gb = (fb1 - fb2) / (clamp(b + hb) - clamp(b - hb) || 1e-9);
      const hbb = (fb1 - 2 * f + fb2) / (hb * hb);
      if (hbb > 1e-9) {
        const nb = clamp(b - gb / hbb);
        const nf = negLogMarginal(a, nb, o, e);
        if (nf < f) {
          b = nb;
          f = nf;
        }
      }
      const ha = 1e-5 * Math.max(1, a);
      const fa1 = negLogMarginal(clamp(a + ha), b, o, e);
      const fa2 = negLogMarginal(clamp(a - ha), b, o, e);
      const ga = (fa1 - fa2) / (clamp(a + ha) - clamp(a - ha) || 1e-9);
      const haa = (fa1 - 2 * f + fa2) / (ha * ha);
      if (haa > 1e-9) {
        const na = clamp(a - ga / haa);
        const nf = negLogMarginal(na, b, o, e);
        if (nf < f) {
          a = na;
          f = nf;
        }
      }
    }

    if (f < bestVal) {
      bestVal = f;
      bestA = a;
      bestB = b;
    }
  }

  return { alpha: bestA, beta: bestB };
}

/** Rational approximation to standard normal quantile Φ⁻¹(p) (Acklam). */
export function normPpf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Regularized lower incomplete gamma function P(a, x) = γ(a, x) / Γ(a).
 */
export function gammainc(a: number, x: number): number {
  if (x <= 0 || a <= 0) return 0;
  const lgA = logGamma(a);
  if (x < a + 1) {
    // Series representation
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 200; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return Math.min(1, Math.max(0, sum * Math.exp(-x + a * Math.log(x) - lgA)));
  } else {
    // Lentz continued fraction for Q(a, x) = 1 - P(a, x)
    const FPMIN = 1e-30;
    let b = x + 1 - a;
    let c = 1 / FPMIN;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i <= 200; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    const q = Math.exp(-x + a * Math.log(x) - lgA) * h;
    return Math.min(1, Math.max(0, 1 - q));
  }
}

/**
 * Exact Gamma(shape, scale) quantile via Newton-Halley refinement on gammainc(shape, x) = p.
 * Matches scipy.stats.gamma.ppf to < 1e-8.
 */
export function gammaPpf(p: number, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0 || p <= 0) return 0;
  if (p >= 1) return Infinity;

  // Initial guess via Wilson-Hilferty
  const z = normPpf(p);
  const v = 1 / (9 * shape);
  const cubeRoot = 1 - v + z * Math.sqrt(v);
  let x = cubeRoot > 0.05 ? shape * cubeRoot ** 3 : Math.max(1e-6, shape * 0.1);

  const lgA = logGamma(shape);
  for (let iter = 0; iter < 30; iter++) {
    const cdf = gammainc(shape, x);
    const err = cdf - p;
    if (Math.abs(err) < 1e-12) break;
    const logPdf = (shape - 1) * Math.log(x) - x - lgA;
    const pdf = Math.exp(logPdf);
    if (pdf <= 1e-30) break;
    // Halley step
    const dLogPdf = (shape - 1) / x - 1;
    const denom = pdf - 0.5 * err * dLogPdf;
    const step = denom > 0 ? err / denom : err / pdf;
    const nextX = x - step;
    x = nextX > 0 ? nextX : x * 0.5;
    if (Math.abs(step) < 1e-12 * x) break;
  }

  return Math.max(0, x * scale);
}

export function ebgmPair(a: number, expected: number, prior: GammaPrior): EbgmResult {
  const postShape = a + prior.alpha;
  const postRate = Math.max(expected + prior.beta, 1e-9);
  const scale = 1 / postRate;
  const ebgm = postShape * scale;
  const eb05 = gammaPpf(0.05, postShape, scale);
  const eb95 = gammaPpf(0.95, postShape, scale);
  return {
    ebgm: round4(ebgm),
    eb05: round4(eb05),
    eb95: round4(eb95),
    signal_ebgm: eb05 > 2,
  };
}

export function chiSquareYates(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  if (!n) return 0;
  const rows = [a + b, c + d];
  const cols = [a + c, b + d];
  const cells = [
    [a, b],
    [c, d],
  ];
  let chi2 = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const exp = (rows[i] * cols[j]) / n;
      if (exp <= 0) continue;
      const obs = cells[i][j];
      const diff = Math.abs(obs - exp);
      const corrected = Math.max(0, diff - Math.min(0.5, diff));
      chi2 += (corrected * corrected) / exp;
    }
  }
  return chi2;
}

/**
 * Exact 1-degree-of-freedom chi-square survival function P(χ²₁ >= x) = 1 - P(1/2, x/2) = erfc(√(x/2)).
 * Matches scipy.stats.chi2_contingency p-value.
 */
export function chiSquarePValue(chi2: number): number {
  if (chi2 <= 0 || Number.isNaN(chi2)) return 1.0;
  return Math.max(0, Math.min(1, 1 - gammainc(0.5, chi2 / 2)));
}

/**
 * Benjamini–Hochberg (1995) step-up False Discovery Rate (FDR) q-values.
 * Given m p-values p_1..p_m, orders p_(1) <= ... <= p_(m) and computes
 * q_(k) = min(1, min_{j >= k} (m / j) * p_(j)).
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const indexed = pValues.map((p, idx) => ({
    idx,
    p: Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1.0,
  }));
  indexed.sort((a, b) => a.p - b.p || a.idx - b.idx);

  const qSorted = new Array<number>(m);
  let runningMin = 1.0;
  for (let i = m - 1; i >= 0; i--) {
    const rank = i + 1;
    const rawQ = (m / rank) * indexed[i].p;
    if (rawQ < runningMin) runningMin = rawQ;
    qSorted[i] = Math.min(1.0, runningMin);
  }

  const out = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    out[indexed[i].idx] = round6(qSorted[i]);
  }
  return out;
}

/**
 * Computes Mantel–Haenszel (1959) adjusted PRR, adjusted ROR, and WHO-UMC stratified IC
 * across demographic strata (e.g. Age Band x Sex).
 */
export function computeMantelHaenszel(strata: StratumMetrics[]): {
  prr_mh: number | null;
  ror_mh: number | null;
  ic_stratified: number | null;
} {
  let prrNum = 0;
  let prrDen = 0;
  let rorNum = 0;
  let rorDen = 0;
  let obsSum = 0;
  let expSum = 0;
  let validStrata = 0;

  for (const s of strata) {
    const n = s.n_total;
    if (n <= 0) continue;
    const ab = s.a + s.b;
    const cd = s.c + s.d;
    const ac = s.a + s.c;
    if (ab > 0 && cd > 0) {
      prrNum += (s.a * cd) / n;
      prrDen += (s.c * ab) / n;
      rorNum += (s.a * s.d) / n;
      rorDen += (s.b * s.c) / n;
    }
    if (ab > 0 && ac > 0) {
      obsSum += s.a;
      expSum += (ab * ac) / n;
      validStrata++;
    }
  }

  const prr_mh = prrDen > 0 && prrNum > 0 ? round3(prrNum / prrDen) : null;
  const ror_mh = rorDen > 0 && rorNum > 0 ? round3(rorNum / rorDen) : null;
  const ic_stratified =
    validStrata > 0 ? round4(Math.log2((obsSum + 0.5) / (expSum + 0.5))) : null;

  return { prr_mh, ror_mh, ic_stratified };
}

/**
 * Fits a 2-parameter Weibull distribution f(t; k, λ) = (k/λ)(t/λ)^(k-1) exp(-(t/λ)^k)
 * via Maximum Likelihood Estimation (Sauzet et al., Drug Safety 2013).
 * Requires at least `minCases` (default 10) non-negative onset times in days.
 * Maps t = 0 (same-day onset) to t = 0.5 days per standard pharmacovigilance continuity convention.
 */
export function fitWeibullTto(
  drug: string,
  adverse_event: string,
  rawDays: number[],
  minCases = 10,
): WeibullTtoResult | null {
  const validDays = rawDays.filter((d) => Number.isFinite(d) && d >= 0 && d <= 3650);
  if (validDays.length < minCases) return null;

  const sortedRaw = [...validDays].sort((a, b) => a - b);
  const n = sortedRaw.length;
  const t = sortedRaw.map((d) => (d <= 0 ? 0.5 : d));
  const lnT = t.map((v) => Math.log(v));
  const meanLnT = lnT.reduce((acc, v) => acc + v, 0) / n;

  // Solve profile score equation g(k) = 1/k + mean(ln t) - (sum t^k ln t)/(sum t^k) = 0
  // Note g(k) is strictly decreasing on (0, ∞).
  let k = 1.0;
  for (let iter = 0; iter < 40; iter++) {
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const tk = Math.pow(t[i], k);
      const x = lnT[i];
      s0 += tk;
      s1 += tk * x;
      s2 += tk * x * x;
    }
    if (s0 <= 0) break;
    const ratio1 = s1 / s0;
    const g = 1 / k + meanLnT - ratio1;
    if (Math.abs(g) < 1e-11) break;
    const dg = -1 / (k * k) - (s2 / s0 - ratio1 * ratio1);
    if (dg >= -1e-12) break;
    const nextK = k - g / dg;
    k = nextK > 0.05 ? Math.min(20.0, nextK) : k * 0.5;
  }

  let sumTk = 0;
  for (let i = 0; i < n; i++) sumTk += Math.pow(t[i], k);
  const lambda = Math.pow(sumTk / n, 1 / k);

  // Asymptotic SE of ln(k) from Weibull Fisher information: Var(ln k) = 6 / (π² n)
  const seLnK = Math.sqrt(6 / (Math.PI * Math.PI * n));
  const ciLow = k * Math.exp(-1.96 * seLnK);
  const ciHigh = k * Math.exp(1.96 * seLnK);

  let regime: WeibullRegime = "random";
  let interpretation =
    "Random / constant hazard (95% CI includes 1.0): event rate is approximately constant over treatment time.";
  if (ciHigh < 1.0) {
    regime = "early_failure";
    interpretation =
      "Early failure / decreasing hazard (k < 1): risk peaks shortly after treatment initiation (typical of hypersensitivity or acute intolerance).";
  } else if (ciLow > 1.0) {
    regime = "wear_out";
    interpretation =
      "Wear-out / increasing hazard (k > 1): risk increases with cumulative duration of therapy (typical of cumulative dose toxicity).";
  } else if (k < 0.85) {
    interpretation =
      "Early-onset tendency (point estimate k < 1, 95% CI spans 1.0): cases cluster early after initiation but sample size does not exclude constant hazard.";
  } else if (k > 1.15) {
    interpretation =
      "Delayed-onset tendency (point estimate k > 1, 95% CI spans 1.0): cases cluster later in therapy but sample size does not exclude constant hazard.";
  }

  const quantile = (q: number) => {
    const pos = (n - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sortedRaw[lo] : sortedRaw[lo] + (sortedRaw[hi] - sortedRaw[lo]) * (pos - lo);
  };

  const maxDay = Math.max(30, Math.min(365, Math.ceil(sortedRaw[n - 1] * 1.05)));
  const numGrid = 25;
  const curve: WeibullCurvePoint[] = [];
  for (let j = 0; j < numGrid; j++) {
    const day = Math.max(0.5, Math.round(((j + 1) / numGrid) * maxDay * 10) / 10);
    const ratio = day / lambda;
    const rk = Math.pow(ratio, k);
    const survival = Math.exp(-rk);
    const fitted_cdf = 1 - survival;
    const hazard = (k / lambda) * Math.pow(ratio, k - 1);
    const density = hazard * survival;
    const empCount = sortedRaw.filter((d) => d <= day).length;
    curve.push({
      day,
      density: round4(density),
      survival: round4(survival),
      hazard: round4(hazard),
      empirical_cdf: round4(empCount / n),
      fitted_cdf: round4(fitted_cdf),
    });
  }

  return {
    drug,
    adverse_event,
    n_cases_with_tto: n,
    median_days: round3(quantile(0.5)),
    iqr_low: round3(quantile(0.25)),
    iqr_high: round3(quantile(0.75)),
    shape_k: round4(k),
    shape_ci_low: round4(ciLow),
    shape_ci_high: round4(ciHigh),
    scale_lambda: round3(lambda),
    regime,
    interpretation,
    onset_days: sortedRaw,
    curve,
  };
}

/**
 * Norén et al. (2008) Omega (Ω) shrinkage measure for drug–drug interaction (DDI) detection.
 *
 * Given four mutually exclusive exposure cells for (Drug A, Drug B) and event E:
 *  - 00: neither A nor B (n001 with E out of n00 reports)
 *  - 10: A without B (n101 with E out of n10 reports)
 *  - 01: B without A (n011 with E out of n01 reports)
 *  - 11: both A and B co-reported (n111 with E out of n11 reports)
 */
export function computeOmegaInteraction(
  n111: number,
  n11: number,
  n101: number,
  n10: number,
  n011: number,
  n01: number,
  n001: number,
  n00: number,
): {
  f00: number;
  f10: number;
  f01: number;
  f11: number;
  g11: number;
  expected_111: number;
  omega: number;
  omega025: number;
  omega975: number;
  signal_omega: boolean;
} {
  const eps = 1e-6;
  const totalN = n00 + n10 + n01 + n11;
  const totalE = n001 + n101 + n011 + n111;
  const fallbackRate = Math.max(eps, Math.min(1 - eps, totalE / Math.max(1, totalN)));

  const safeProp = (eCount: number, totCount: number) => {
    if (totCount <= 0) return fallbackRate;
    return Math.max(eps, Math.min(1 - eps, eCount / totCount));
  };

  const f00 = safeProp(n001, n00);
  const f10 = safeProp(n101, n10);
  const f01 = safeProp(n011, n01);
  const f11 = safeProp(n111, n11);

  const odds00 = f00 / (1 - f00);
  const odds10 = f10 / (1 - f10);
  const odds01 = f01 / (1 - f01);

  const denom = Math.max(odds00, odds10) + Math.max(odds00, odds01) - odds00 + 1;
  const g11 = Math.max(eps, Math.min(1 - eps, 1 - 1 / denom));
  const expected_111 = g11 * n11;

  const alpha = 0.5;
  const omega = Math.log2((n111 + alpha) / (expected_111 + alpha));
  const halfWidth = 1.96 / (LN2 * Math.sqrt(n111 + alpha));
  const omega025 = omega - halfWidth;
  const omega975 = omega + halfWidth;

  return {
    f00: round4(f00),
    f10: round4(f10),
    f01: round4(f01),
    f11: round4(f11),
    g11: round4(g11),
    expected_111: round4(expected_111),
    omega: round4(omega),
    omega025: round4(omega025),
    omega975: round4(omega975),
    signal_omega: omega025 > 0,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function round6(x: number): number {
  return Math.round(x * 1000000) / 1000000;
}
