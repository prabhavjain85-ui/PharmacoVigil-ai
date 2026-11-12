/**
 * Compares TypeScript pipeline features, priority scores, and all statistical
 * extensions (EBGM/EB05 within 0.02, p_value, Benjamini-Hochberg q_value,
 * Mantel-Haenszel PRR_MH/IC_stratified, Weibull TTO shape, Omega DDI shrinkage,
 * temporal cumulative IC & change-points, and duplicate detection) against python-parity.json.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { parseCsv } = await import("../lib/pipeline/parseCsv.ts");
const { runAnalysis, computeTemporalSignalSeries } = await import("../lib/pipeline/analyze.ts");
const { buildFeatureFrame, caseLevelFeatures, contextFromTables } = await import(
  "../lib/pipeline/pairFeatures.ts"
);

const sampleDir = join(root, "public/sample");
const demo = parseCsv(readFileSync(join(sampleDir, "DEMO_sample.csv"), "utf8"));
const drug = parseCsv(readFileSync(join(sampleDir, "DRUG_sample.csv"), "utf8"));
const reac = parseCsv(readFileSync(join(sampleDir, "REAC_sample.csv"), "utf8"));
const outc = parseCsv(readFileSync(join(sampleDir, "OUTC_sample.csv"), "utf8"));
const indi = parseCsv(readFileSync(join(sampleDir, "INDI_sample.csv"), "utf8"));
const ther = parseCsv(readFileSync(join(sampleDir, "THER_sample.csv"), "utf8"));

const optional = { outc, indi, ther };
const result = runAnalysis(demo, drug, reac, "sample", undefined, 3, optional);
const caseFeats = caseLevelFeatures(result.pairs, contextFromTables(demo, drug, optional));
const featureFrames = buildFeatureFrame(result.signals, caseFeats);

const py = JSON.parse(readFileSync(join(root, "public/data/python-parity.json"), "utf8"));

const row = result.signals.find(
  (s) => s.drug === "WARFARIN" && s.adverse_event === "GASTROINTESTINAL HAEMORRHAGE",
);
if (!row) throw new Error("WARFARIN/GI row missing");

// Tightened EBGM and EB05 parity tolerance (<= 0.02) and exact statistical checks
const ebgmTol = 0.02;
const statTol = 1e-3;

for (const key of ["EBGM", "EB05"]) {
  const a = row[key];
  const b = py.warfarin_gi[key];
  if (Math.abs(a - b) > ebgmTol) {
    console.error(`Parity fail warfarin_gi.${key}: ts=${a} py=${b} (tol=${ebgmTol})`);
    process.exit(1);
  }
}

for (const key of ["PRR", "IC025", "p_value", "q_value", "PRR_MH", "IC_stratified", "weibull_shape"]) {
  const a = row[key];
  const b = py.warfarin_gi[key];
  if (Math.abs((a ?? 0) - (b ?? 0)) > statTol) {
    console.error(`Parity fail warfarin_gi.${key}: ts=${a} py=${b}`);
    process.exit(1);
  }
}

if (result.duplicates.flagged_pairs.length !== py.probable_duplicates_count) {
  console.error(
    `Probable duplicate count mismatch: ts=${result.duplicates.flagged_pairs.length} py=${py.probable_duplicates_count}`,
  );
  process.exit(1);
}

if (result.signals.length !== py.pairs.length) {
  console.error(`Pair count mismatch: ts=${result.signals.length} py=${py.pairs.length}`);
  process.exit(1);
}

const tsByKey = new Map();
result.signals.forEach((s, idx) => {
  tsByKey.set(`${s.drug}|${s.adverse_event}`, { signal: s, features: featureFrames[idx] });
});

const featTol = 1e-4;
const scoreTol = 0.005;

for (const pyPair of py.pairs) {
  const key = `${pyPair.drug}|${pyPair.adverse_event}`;
  const tsEntry = tsByKey.get(key);
  if (!tsEntry) {
    console.error(`Missing pair in TS output: ${key}`);
    process.exit(1);
  }
  const s = tsEntry.signal;

  // Check EBGM and EB05 within 0.02 across every pair
  if (Math.abs(s.EBGM - pyPair.EBGM) > ebgmTol || Math.abs(s.EB05 - pyPair.EB05) > ebgmTol) {
    console.error(
      `EBGM/EB05 mismatch on ${key}: ts=(${s.EBGM}, ${s.EB05}) py=(${pyPair.EBGM}, ${pyPair.EB05})`,
    );
    process.exit(1);
  }

  // Check p_value, q_value, PRR_MH, ROR_MH, IC_stratified
  for (const statKey of ["p_value", "q_value", "PRR_MH", "ROR_MH", "IC_stratified"]) {
    const tv = s[statKey];
    const pv = pyPair[statKey];
    if (pv !== null && pv !== undefined) {
      if (tv === null || tv === undefined || Math.abs(tv - pv) > statTol) {
        console.error(`${statKey} mismatch on ${key}: ts=${tv} py=${pv}`);
        process.exit(1);
      }
    }
  }

  // Check Weibull TTO shape & regime
  if (pyPair.weibull_shape !== null && pyPair.weibull_shape !== undefined) {
    if (s.weibull_shape === null || s.weibull_shape === undefined || Math.abs(s.weibull_shape - pyPair.weibull_shape) > statTol) {
      console.error(`Weibull shape mismatch on ${key}: ts=${s.weibull_shape} py=${pyPair.weibull_shape}`);
      process.exit(1);
    }
    if (s.weibull_regime !== pyPair.weibull_regime) {
      console.error(
        `Weibull regime mismatch on ${key}: ts=${s.weibull_regime} py=${pyPair.weibull_regime}`,
      );
      process.exit(1);
    }
  }

  for (const fname of py.feature_names) {
    const pyVal = pyPair.features[fname];
    const tsVal = tsEntry.features[fname];
    if (pyVal === null || pyVal === undefined) {
      if (tsVal !== null && tsVal !== undefined) {
        console.error(`Feature ${fname} on ${key}: expected null, got ${tsVal}`);
        process.exit(1);
      }
    } else {
      if (tsVal === null || tsVal === undefined || Math.abs(tsVal - pyVal) > featTol) {
        console.error(`Feature ${fname} mismatch on ${key}: ts=${tsVal} py=${pyVal}`);
        process.exit(1);
      }
    }
  }

  const tsScore = s.priority_score ?? 0;
  const pyScore = pyPair.priority_score;
  if (Math.abs(tsScore - pyScore) > scoreTol) {
    console.error(`Score mismatch on ${key}: ts=${tsScore} py=${pyScore}`);
    process.exit(1);
  }
}

// Check Drug-Drug Interaction Omega signals
if (result.interactions.length !== py.interactions.length) {
  console.error(
    `Interactions count mismatch: ts=${result.interactions.length} py=${py.interactions.length}`,
  );
  process.exit(1);
}
for (let i = 0; i < py.interactions.length; i++) {
  const ti = result.interactions[i];
  const pi = py.interactions[i];
  if (
    ti.drug_a !== pi.drug_a ||
    ti.drug_b !== pi.drug_b ||
    ti.adverse_event !== pi.adverse_event ||
    Math.abs(ti.omega - pi.omega) > statTol ||
    Math.abs(ti.omega025 - pi.omega025) > statTol
  ) {
    console.error(`Interaction mismatch at index ${i}:`, ti, pi);
    process.exit(1);
  }
}

// Check Temporal signal series for Warfarin + GI Haemorrhage
const tsTemp = computeTemporalSignalSeries(
  result.pairs,
  "WARFARIN",
  "GASTROINTESTINAL HAEMORRHAGE",
  "quarter",
);
const pyTemp = py.temporal_warfarin_gi;
if (
  tsTemp.first_ic025_gt0_period !== pyTemp.first_ic025_gt0_period ||
  tsTemp.points.length !== pyTemp.points.length
) {
  console.error("Temporal series metadata mismatch:", tsTemp, pyTemp);
  process.exit(1);
}
for (let i = 0; i < pyTemp.points.length; i++) {
  const tp = tsTemp.points[i];
  const pp = pyTemp.points[i];
  if (
    tp.period !== pp.period ||
    Math.abs(tp.cum_ic - pp.cum_ic) > statTol ||
    Math.abs(tp.cum_ic025 - pp.cum_ic025) > statTol ||
    Math.abs(tp.cusum_stat - pp.cusum_stat) > statTol ||
    Math.abs(tp.llr_stat - pp.llr_stat) > statTol
  ) {
    console.error(`Temporal point mismatch at ${tp.period}:`, tp, pp);
    process.exit(1);
  }
}

console.log(`Parity OK: ${py.pairs.length} pairs, ${py.feature_names.length} features each`);
