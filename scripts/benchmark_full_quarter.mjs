/**
 * Full FAERS Quarter (2024Q2) Scale & Masking Benchmark for the TypeScript Pipeline.
 * Loads all 6 ASCII tables from /tmp/faers_raw/2024q2/ASCII through parseCsv + runAnalysis,
 * measuring exact parse time, analysis time, peak heap/RSS memory, and competition-bias masking.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const faersDir = process.env.FAERS_QUARTER_DIR || "/tmp/faers_raw/2024q2/ASCII";

function readTableFile(baseName) {
  const lower = join(faersDir, `${baseName}.txt`);
  if (existsSync(lower)) return readFileSync(lower, "utf8");
  return readFileSync(join(faersDir, `${baseName}.TXT`), "utf8");
}

const { parseCsv, clearCsvInternPool } = await import("../src/lib/pipeline/parseCsv.ts");
const { runAnalysis } = await import("../src/lib/pipeline/analyze.ts");

let peakHeapUsedBytes = process.memoryUsage().heapUsed;
let peakRssBytes = process.memoryUsage().rss;

function sampleMemory() {
  const m = process.memoryUsage();
  if (m.heapUsed > peakHeapUsedBytes) peakHeapUsedBytes = m.heapUsed;
  if (m.rss > peakRssBytes) peakRssBytes = m.rss;
}

console.log(`Loading full FAERS quarter from ${faersDir}...`);
const t0 = performance.now();

const tParseStart = performance.now();
const demo = parseCsv(readTableFile("DEMO24Q2"), [
  "primaryid",
  "caseid",
  "caseversion",
  "event_dt",
  "age",
  "age_cod",
  "sex",
  "occp_cod",
  "occr_country",
  "reporter_country",
]);
global.gc?.();
sampleMemory();
console.log(`  Parsed DEMO24Q2: ${demo.length.toLocaleString()} rows`);

const drug = parseCsv(readTableFile("DRUG24Q2"), [
  "primaryid",
  "drug_seq",
  "role_cod",
  "drugname",
]);
global.gc?.();
sampleMemory();
console.log(`  Parsed DRUG24Q2: ${drug.length.toLocaleString()} rows`);

const reac = parseCsv(readTableFile("REAC24Q2"), [
  "primaryid",
  "pt",
]);
global.gc?.();
sampleMemory();
console.log(`  Parsed REAC24Q2: ${reac.length.toLocaleString()} rows`);

const outc = parseCsv(readTableFile("OUTC24Q2"), [
  "primaryid",
  "outc_cod",
]);
global.gc?.();
sampleMemory();
console.log(`  Parsed OUTC24Q2: ${outc.length.toLocaleString()} rows`);

const indi = parseCsv(readTableFile("INDI24Q2"), [
  "primaryid",
  "indi_drug_seq",
  "indi_pt",
]);
global.gc?.();
sampleMemory();
console.log(`  Parsed INDI24Q2: ${indi.length.toLocaleString()} rows`);

const ther = parseCsv(readTableFile("THER24Q2"), [
  "primaryid",
  "dsg_drug_seq",
  "start_dt",
]);
clearCsvInternPool();
global.gc?.();
sampleMemory();
console.log(`  Parsed THER24Q2: ${ther.length.toLocaleString()} rows`);

const tParseEnd = performance.now();
const parseTimeSec = Math.round(((tParseEnd - tParseStart) / 1000) * 100) / 100;
console.log(`Parse completed in ${parseTimeSec}s`);

const tAnalyzeStart = performance.now();
const result = runAnalysis(
  demo,
  drug,
  reac,
  "upload",
  {
    demo: "DEMO24Q2.TXT",
    drug: "DRUG24Q2.TXT",
    reac: "REAC24Q2.TXT",
    outc: "OUTC24Q2.TXT",
    indi: "INDI24Q2.TXT",
    ther: "THER24Q2.TXT",
  },
  3,
  { outc, indi, ther },
  {
    onProgress: (step, pct) => {
      sampleMemory();
      console.log(`  [${pct}%] ${step}`);
    },
  },
);
sampleMemory();
const tAnalyzeEnd = performance.now();
const analysisTimeSec = Math.round(((tAnalyzeEnd - tAnalyzeStart) / 1000) * 100) / 100;
const totalTimeSec = Math.round(((tAnalyzeEnd - t0) / 1000) * 100) / 100;

const peakHeapUsedMb = Math.round((peakHeapUsedBytes / (1024 * 1024)) * 10) / 10;
const peakRssMb = Math.round((peakRssBytes / (1024 * 1024)) * 10) / 10;

const summary = {
  quarter: "2024Q2",
  environment: {
    runtime: `Node.js ${process.version} (tsx TypeScript pipeline)`,
    platform: `${process.platform} ${process.arch}`,
  },
  row_counts: {
    demo_rows: result.meta.demo_rows,
    deduplicated_cases: result.meta.case_count,
    superseded_versions_dropped: result.meta.superseded_versions_dropped,
    probable_duplicates_flagged: result.meta.probable_duplicates_flagged,
    drug_rows: result.meta.drug_rows,
    reac_rows: result.meta.reac_rows,
    outc_rows: result.meta.outc_rows,
    indi_rows: result.meta.indi_rows,
    ther_rows: result.meta.ther_rows,
    total_table_rows:
      result.meta.demo_rows +
      result.meta.drug_rows +
      result.meta.reac_rows +
      (result.meta.outc_rows ?? 0) +
      (result.meta.indi_rows ?? 0) +
      (result.meta.ther_rows ?? 0),
    case_drug_event_pairs: result.meta.pair_count,
    distinct_suspect_drugs: result.meta.drug_count,
    eligible_pairs_min_cases_3: result.signals.length,
  },
  signal_counts: {
    signals_prr: result.duplicates.baseline_counts.signals_prr,
    signals_bcpnn: result.duplicates.baseline_counts.signals_bcpnn,
    signals_ebgm: result.duplicates.baseline_counts.signals_ebgm,
    signals_fdr: result.duplicates.baseline_counts.signals_fdr,
    stratified_pairs_evaluated: Object.keys(result.stratified).length,
    weibull_pairs_fitted: Object.keys(result.weibull).length,
    omega_ddi_triplets: result.interactions.length,
  },
  timings: {
    parse_time_sec: parseTimeSec,
    analysis_time_sec: analysisTimeSec,
    total_time_sec: totalTimeSec,
  },
  memory: {
    peak_heap_used_mb: peakHeapUsedMb,
    peak_rss_mb: peakRssMb,
  },
  masking_check: result.masking
    ? {
        top_k_drugs: result.masking.top_k_drugs,
        removed_drugs: result.masking.removed_drugs,
        baseline_total_reports: result.masking.baseline_total_reports,
        unmasked_total_reports: result.masking.unmasked_total_reports,
        pairs_evaluated: result.masking.pairs_evaluated,
        status_changed_count: result.masking.status_changed_count,
        newly_unmasked_count: result.masking.newly_unmasked_count,
        de_flagged_count: result.masking.de_flagged_count,
        top_status_changed_pairs: result.masking.status_changed_pairs.slice(0, 25),
      }
    : null,
};

mkdirSync(join(root, "evaluation"), { recursive: true });
const outPath = join(root, "evaluation/scale_benchmark_results.json");
writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

console.log("\n=== Full Quarter (2024Q2) Scale Benchmark Complete ===");
console.log(`  Deduplicated cases: ${summary.row_counts.deduplicated_cases.toLocaleString()}`);
console.log(`  Total table rows:   ${summary.row_counts.total_table_rows.toLocaleString()}`);
console.log(`  Case-level pairs:   ${summary.row_counts.case_drug_event_pairs.toLocaleString()}`);
console.log(`  Evaluated signals:  ${summary.row_counts.eligible_pairs_min_cases_3.toLocaleString()}`);
console.log(`  Parse time:         ${summary.timings.parse_time_sec}s`);
console.log(`  Analysis time:      ${summary.timings.analysis_time_sec}s`);
console.log(`  Total time:         ${summary.timings.total_time_sec}s`);
console.log(`  Peak Heap / RSS:    ${summary.memory.peak_heap_used_mb} MB / ${summary.memory.peak_rss_mb} MB`);
if (summary.masking_check) {
  console.log(
    `  Masking check:      removed top ${summary.masking_check.top_k_drugs} drugs (${summary.masking_check.removed_drugs.map((d) => `${d.drug} [${d.report_count}]`).join(", ")}) -> ${summary.masking_check.status_changed_count} signal status changes (${summary.masking_check.newly_unmasked_count} newly unmasked, ${summary.masking_check.de_flagged_count} de-flagged)`,
  );
}
console.log(`Saved to ${outPath}`);
