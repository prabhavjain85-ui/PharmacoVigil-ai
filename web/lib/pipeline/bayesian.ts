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

function logGamma(z: number): number {
  if (z <= 0) return 0;
  return (z - 0.5) * Math.log(z) - z + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * z);
}

export function fitGammaPoissonPrior(observed: number[], expected: number[]): GammaPrior {
  const o: number[] = [];
  const e: number[] = [];
  for (let i = 0; i < observed.length; i++) {
    if (expected[i] > 0 && observed[i] >= 0) {
      o.push(observed[i]);
      e.push(expected[i]);
    }
  }
  if (o.length < 3) return { alpha: 1, beta: 1 };

  let bestA = 1;
  let bestB = 1;
  let best = Infinity;
  for (let alpha = 0.2; alpha <= 8; alpha += 0.25) {
    for (let beta = 0.2; beta <= 8; beta += 0.25) {
      const nll = negLogMarginal(alpha, beta, o, e);
      if (nll < best) {
        best = nll;
        bestA = alpha;
        bestB = beta;
      }
    }
  }
  return { alpha: bestA, beta: bestB };
}

function negLogMarginal(alpha: number, beta: number, o: number[], e: number[]): number {
  if (alpha <= 0.05 || beta <= 0.05) return 1e12;
  let sum = 0;
  for (let i = 0; i < o.length; i++) {
    const oi = o[i];
    const ei = e[i];
    sum +=
      logGamma(oi + alpha) -
      logGamma(alpha) -
      logGamma(oi + 1) +
      alpha * Math.log(beta / (beta + ei)) +
      oi * Math.log(ei / (beta + ei));
  }
  return -sum;
}

/** Rational approximation to standard normal quantile Φ⁻¹(p) (Acklam). */
function normPpf(p: number): number {
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

/** Wilson–Hilferty cube-root approximation for Gamma(shape, scale) quantile. */
function gammaPpf(p: number, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0) return 0;
  const z = normPpf(p);
  const v = 1 / (9 * shape);
  const cubeRoot = 1 - v + z * Math.sqrt(v);
  if (cubeRoot <= 0) return 0;
  return Math.max(0, shape * scale * cubeRoot ** 3);
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

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
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
