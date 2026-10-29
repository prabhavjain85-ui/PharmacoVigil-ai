/**
 * Run after build: node scripts/parity-check.mjs
 * Compares TS pipeline output to python-parity.json on sample CSVs.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { parseCsv } = await import("../lib/pipeline/parseCsv.ts");
const { runAnalysis } = await import("../lib/pipeline/analyze.ts");

const demo = parseCsv(readFileSync(join(root, "public/sample/DEMO_sample.csv"), "utf8"));
const drug = parseCsv(readFileSync(join(root, "public/sample/DRUG_sample.csv"), "utf8"));
const reac = parseCsv(readFileSync(join(root, "public/sample/REAC_sample.csv"), "utf8"));
const result = runAnalysis(demo, drug, reac, "sample", undefined, 3);
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
    console.error(`Parity fail ${key}: ts=${a} py=${b}`);
    process.exit(1);
  }
}
console.log("Parity OK (within tolerance)", { PRR: row.PRR, IC025: row.IC025, EB05: row.EB05 });
