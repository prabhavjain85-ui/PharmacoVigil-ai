/** Client-side disproportionality helpers for the interactive 2×2 calculator. */

export type Cells = { a: number; b: number; c: number; d: number; n: number };

export type CalcResult = {
  prr: number;
  ror: number;
  chi2: number;
  ic: number;
  ic025: number;
  ebgm: number;
  eb05: number;
  signalPrr: boolean;
  signalBcpnn: boolean;
  signalEbgm: boolean;
};

const LN2 = Math.log(2);
const CC = 0.5;

export function chiSquareYates(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  if (n === 0) return 0;
  const rows = [a + b, c + d];
  const cols = [a + c, b + d];
  const cells = [
    [a, b],
    [c, d],
  ];
  let chi2 = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const expected = (rows[i] * cols[j]) / n;
      if (expected <= 0) continue;
      const observed = cells[i][j];
      chi2 += (Math.abs(observed - expected) - 0.5) ** 2 / expected;
    }
  }
  return chi2;
}

export function computeFromCells(
  cells: Cells,
  prior: { alpha: number; beta: number },
): CalcResult | null {
  const { a, b, c, d } = cells;
  const n = cells.n || a + b + c + d;
  if (a < 0 || b < 0 || c < 0 || d < 0 || n <= 0) return null;
  if (a + b === 0 || a + c === 0 || b === 0 || c === 0 || d === 0) return null;

  const prr = (a / (a + b)) / (c / (c + d));
  const ror = (a * d) / (b * c);
  const exp = ((a + b) * (a + c)) / n;

  const ac = a + CC;
  const bc = b + CC;
  const cc = c + CC;
  const dc = d + CC;
  const ic = Math.log2((ac * n) / ((ac + bc) * (ac + cc)));
  const variance = (1 / LN2 ** 2) * (1 / ac + 1 / bc + 1 / cc + 1 / dc);
  const ic025 = ic - 1.96 * Math.sqrt(variance);

  const chi2 = chiSquareYates(a, b, c, d);

  const alpha = prior.alpha;
  const beta = prior.beta;
  const postShape = a + alpha;
  const postRate = exp + beta;
  const ebgm = postShape / postRate;
  const mean = postShape / postRate;
  const std = Math.sqrt(postShape) / postRate;
  const eb05 = Math.max(0, mean - 1.645 * std);

  return {
    prr,
    ror,
    chi2,
    ic,
    ic025,
    ebgm,
    eb05,
    signalPrr: prr >= 2 && chi2 >= 4 && a >= 3,
    signalBcpnn: ic025 > 0,
    signalEbgm: eb05 > 2,
  };
}
