/**
 * Compares TypeScript pipeline features and priority scores against python-parity.json
 * across all six sample tables (DEMO, DRUG, REAC, OUTC, INDI, THER).
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { parseCsv } = await import("../lib/pipeline/parseCsv.ts");
const { runAnalysis } = await import("../lib/pipeline/analyze.ts");
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

const tol = 0.15;
for (const key of ["PRR", "IC025", "EB05"]) {
  const a = row[key];
  const b = py.warfarin_gi[key];
  if (Math.abs(a - b) > tol) {
    console.error(`Parity fail warfarin_gi.${key}: ts=${a} py=${b}`);
    process.exit(1);
  }
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

  const tsScore = tsEntry.signal.priority_score ?? 0;
  const pyScore = pyPair.priority_score;
  if (Math.abs(tsScore - pyScore) > scoreTol) {
    console.error(`Score mismatch on ${key}: ts=${tsScore} py=${pyScore}`);
    process.exit(1);
  }
}

console.log(`Parity OK: ${py.pairs.length} pairs, ${py.feature_names.length} features each`);
