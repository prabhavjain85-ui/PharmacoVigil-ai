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

function gammaPpf(p: number, shape: number, scale: number): number {
  const mean = shape * scale;
  const std = Math.sqrt(shape) * scale;
  const z = p < 0.5 ? -1.645 : 1.645;
  return Math.max(0, mean + z * std * (p < 0.5 ? 1 : 0) + (p < 0.5 ? -1.645 * std : 0));
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
      chi2 += (Math.abs(obs - exp) - 0.5) ** 2 / exp;
    }
  }
  return chi2;
}
