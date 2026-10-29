const REFERENCE_POSITIVE = new Set([
  "WARFARIN|GASTROINTESTINAL HAEMORRHAGE",
  "CLOPIDOGREL|GASTROINTESTINAL HAEMORRHAGE",
  "SIMVASTATIN|RHABDOMYOLYSIS",
  "AMOXICILLIN|ANAPHYLACTIC REACTION",
  "PREDNISONE|HEPATIC FAILURE",
  "WARFARIN|INTERNATIONAL NORMALISED RATIO INCREASED",
  "ATORVASTATIN|MYALGIA",
  "LISINOPRIL|ANGIOEDEMA",
]);

export const SERIOUS_EVENTS = new Set([
  "GASTROINTESTINAL HAEMORRHAGE",
  "ANAPHYLACTIC REACTION",
  "HEPATIC FAILURE",
  "RHABDOMYOLYSIS",
  "ANGIOEDEMA",
  "DYSPNOEA",
]);

export function isWeakLabelPositive(drug: string, event: string): boolean {
  return REFERENCE_POSITIVE.has(`${drug}|${event}`);
}

export const FEATURE_LABELS: Record<string, string> = {
  PRR: "PRR",
  ROR: "ROR",
  chi_square: "χ²",
  IC: "IC (BCPNN)",
  EBGM: "EBGM",
  EB05: "EB05",
  case_count_a: "Case count",
  log_cases: "log(cases)",
  serious_event: "Serious PT flag",
  drug_report_share: "Drug report share",
  event_report_share: "Event report share",
};

export const FEATURES = [
  "PRR",
  "ROR",
  "chi_square",
  "IC",
  "EBGM",
  "EB05",
  "case_count_a",
  "log_cases",
  "serious_event",
  "drug_report_share",
  "event_report_share",
] as const;

/** Transparent logistic regression trained in-browser on weak labels (same idea as Python GBM). */
export function trainAndScore(
  rows: {
    drug: string;
    adverse_event: string;
    PRR: number;
    ROR: number;
    chi_square: number;
    IC: number;
    EBGM: number;
    EB05: number;
    case_count_a: number;
    serious_event: boolean;
    drug_total_reports: number;
    event_total_reports: number;
  }[],
  totalReports: number,
): {
  scores: { priority_score: number; priority_explain: { feature: string; label: string; value: number; contribution: number }[] }[];
  importances: { feature: string; label: string; importance: number }[];
} {
  if (!rows.length) {
    return { scores: [], importances: FEATURES.map((f) => ({ feature: f, label: FEATURE_LABELS[f], importance: 0 })) };
  }

  const X: number[][] = rows.map((r) => featureVector(r, totalReports));
  const y = rows.map((r) => (isWeakLabelPositive(r.drug, r.adverse_event) ? 1 : 0));

  const means = FEATURES.map((_, j) => X.reduce((s, row) => s + row[j], 0) / X.length);
  const stds = FEATURES.map((_, j) => {
    const v = X.reduce((s, row) => s + (row[j] - means[j]) ** 2, 0) / X.length;
    return Math.sqrt(v) || 1;
  });
  const Xn = X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));

  let weights = new Array(FEATURES.length + 1).fill(0);
  const lr = 0.15;
  const epochs = 400;

  for (let ep = 0; ep < epochs; ep++) {
    const grad = new Array(weights.length).fill(0);
    for (let i = 0; i < Xn.length; i++) {
      const z = weights[0] + Xn[i].reduce((s, x, j) => s + x * weights[j + 1], 0);
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[i];
      grad[0] += err;
      for (let j = 0; j < FEATURES.length; j++) grad[j + 1] += err * Xn[i][j];
    }
    for (let j = 0; j < weights.length; j++) weights[j] -= (lr * grad[j]) / Xn.length;
  }

  const absW = weights.slice(1).map((w) => Math.abs(w));
  const sumW = absW.reduce((a, b) => a + b, 0) || 1;
  const importances = FEATURES.map((f, j) => ({
    feature: f,
    label: FEATURE_LABELS[f],
    importance: round4(absW[j] / sumW),
  }));

  const scores = Xn.map((xn, i) => {
    const z = weights[0] + xn.reduce((s, x, j) => s + x * weights[j + 1], 0);
    const prob = 1 / (1 + Math.exp(-z));
    const contribs = xn.map((x, j) => x * (absW[j] / sumW));
    const order = contribs
      .map((c, j) => ({ j, c: Math.abs(c) }))
      .sort((a, b) => b.c - a.c)
      .slice(0, 3);
    return {
      priority_score: round4(prob),
      priority_explain: order.map(({ j }) => ({
        feature: FEATURES[j],
        label: FEATURE_LABELS[FEATURES[j]],
        value: round4(X[i][j]),
        contribution: round4(contribs[j]),
      })),
    };
  });

  return { scores, importances };
}

function featureVector(
  r: {
    PRR: number;
    ROR: number;
    chi_square: number;
    IC: number;
    EBGM: number;
    EB05: number;
    case_count_a: number;
    serious_event: boolean;
    drug_total_reports: number;
    event_total_reports: number;
  },
  totalReports: number,
) {
  return [
    r.PRR,
    r.ROR,
    r.chi_square,
    r.IC,
    r.EBGM,
    r.EB05,
    r.case_count_a,
    Math.log1p(r.case_count_a),
    r.serious_event ? 1 : 0,
    r.drug_total_reports / Math.max(totalReports, 1),
    r.event_total_reports / Math.max(totalReports, 1),
  ];
}

function round4(x: number) {
  return Math.round(x * 10000) / 10000;
}
