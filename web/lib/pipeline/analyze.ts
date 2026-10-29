import { bcpnn, chiSquareYates, ebgmPair, expectedCount, fitGammaPoissonPrior } from "./bayesian";
import { uniqueCases } from "./buildPairs";
import { trainAndScore, SERIOUS_EVENTS } from "./mlPrioritize";
import type { AnalysisResult, FaersRow, PairRow, SignalRow } from "./types";
import { buildCaseLevelTable } from "./buildPairs";
import { requireColumns } from "./parseCsv";

export function runAnalysis(
  demo: FaersRow[],
  drug: FaersRow[],
  reac: FaersRow[],
  source: "sample" | "upload",
  fileNames?: AnalysisResult["meta"]["fileNames"],
  minCases = 3,
): AnalysisResult {
  requireColumns(demo, ["primaryid"], "DEMO");
  requireColumns(drug, ["primaryid", "drugname"], "DRUG");
  requireColumns(reac, ["primaryid", "pt"], "REAC");

  const pairs = buildCaseLevelTable(demo, drug, reac);
  const totalReports = uniqueCases(pairs);
  const signals = computeDisproportionality(pairs, totalReports, minCases);
  const { scores, importances } = trainAndScore(signals, totalReports);

  const ranked = signals
    .map((s, i) => ({
      ...s,
      priority_score: scores[i]?.priority_score ?? null,
      priority_explain: scores[i]?.priority_explain ?? null,
    }))
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
    .map((s, i) => ({ ...s, priority_rank: i + 1 }));

  const drugSet = new Set(ranked.map((s) => s.drug));

  return {
    meta: {
      source,
      case_count: totalReports,
      demo_rows: demo.length,
      drug_rows: drug.length,
      reac_rows: reac.length,
      pair_count: pairs.length,
      drug_count: drugSet.size,
      fileNames,
    },
    pairs,
    signals: ranked,
    prior: ranked.length ? fitPriorFromSignals(ranked, totalReports) : { alpha: 1, beta: 1 },
    globalImportance: importances,
  };
}

function fitPriorFromSignals(signals: SignalRow[], total: number) {
  const o: number[] = [];
  const e: number[] = [];
  for (const s of signals) {
    const b = s.drug_total_reports - s.case_count_a;
    const c = s.event_total_reports - s.case_count_a;
    const d = total - s.drug_total_reports - s.event_total_reports + s.case_count_a;
    o.push(s.case_count_a);
    e.push(expectedCount(s.case_count_a, b, c, d, total));
  }
  return fitGammaPoissonPrior(o, e);
}

function computeDisproportionality(pairs: PairRow[], totalReports: number, minCases: number): SignalRow[] {
  const drugTotals = new Map<string, Set<string>>();
  const eventTotals = new Map<string, Set<string>>();
  const pairCounts = new Map<string, number>();

  for (const p of pairs) {
    if (!drugTotals.has(p.drugname)) drugTotals.set(p.drugname, new Set());
    if (!eventTotals.has(p.pt)) eventTotals.set(p.pt, new Set());
    drugTotals.get(p.drugname)!.add(p.primaryid);
    eventTotals.get(p.pt)!.add(p.primaryid);
    const key = `${p.drugname}|${p.pt}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  const strata: {
    drug: string;
    adverse_event: string;
    a: number;
    b: number;
    c: number;
    d: number;
    drug_total_reports: number;
    event_total_reports: number;
  }[] = [];

  for (const [key, a] of pairCounts) {
    if (a < minCases) continue;
    const [drug, adverse_event] = key.split("|");
    const drugTotal = drugTotals.get(drug)!.size;
    const eventTotal = eventTotals.get(adverse_event)!.size;
    const b = drugTotal - a;
    const c = eventTotal - a;
    const d = totalReports - drugTotal - eventTotal + a;
    if (b <= 0 || c <= 0 || d <= 0) continue;
    strata.push({ drug, adverse_event, a, b, c, d, drug_total_reports: drugTotal, event_total_reports: eventTotal });
  }

  const observed = strata.map((s) => s.a);
  const expected = strata.map((s) => expectedCount(s.a, s.b, s.c, s.d, totalReports));
  const prior = fitGammaPoissonPrior(observed, expected);

  return strata.map((s) => {
    const prr = (s.a / (s.a + s.b)) / (s.c / (s.c + s.d));
    const ror = (s.a * s.d) / (s.b * s.c);
    const chi2 = chiSquareYates(s.a, s.b, s.c, s.d);
    const se = Math.sqrt(1 / s.a + 1 / s.b + 1 / s.c + 1 / s.d);
    const logRor = Math.log(ror);
    const bcp = bcpnn(s.a, s.b, s.c, s.d, totalReports);
    const exp = expectedCount(s.a, s.b, s.c, s.d, totalReports);
    const ebg = ebgmPair(s.a, exp, prior);
    return {
      drug: s.drug,
      adverse_event: s.adverse_event,
      case_count_a: s.a,
      drug_total_reports: s.drug_total_reports,
      event_total_reports: s.event_total_reports,
      PRR: round3(prr),
      ROR: round3(ror),
      ROR_95CI_low: round3(Math.exp(logRor - 1.96 * se)),
      ROR_95CI_high: round3(Math.exp(logRor + 1.96 * se)),
      chi_square: round3(chi2),
      p_value: 0,
      IC: bcp.ic,
      IC025: bcp.ic025,
      IC975: bcp.ic975,
      signal_bcpnn: bcp.signal_bcpnn,
      EBGM: ebg.ebgm,
      EB05: ebg.eb05,
      EB95: ebg.eb95,
      signal_ebgm: ebg.signal_ebgm,
      serious_event: SERIOUS_EVENTS.has(s.adverse_event),
      signal_detected: prr >= 2 && chi2 >= 4 && s.a >= minCases,
      priority_score: null,
      priority_rank: null,
      priority_explain: null,
    };
  });
}

function round3(x: number) {
  return Math.round(x * 1000) / 1000;
}

export function signalsToCsv(signals: SignalRow[]): string {
  const headers = [
    "drug", "adverse_event", "case_count_a", "PRR", "ROR", "chi_square", "IC", "IC025", "EBGM", "EB05",
    "signal_detected", "signal_bcpnn", "signal_ebgm", "priority_score", "priority_rank",
  ];
  const lines = [headers.join(",")];
  for (const s of signals) {
    lines.push(
      [
        csvEsc(s.drug),
        csvEsc(s.adverse_event),
        s.case_count_a,
        s.PRR,
        s.ROR,
        s.chi_square,
        s.IC,
        s.IC025,
        s.EBGM,
        s.EB05,
        s.signal_detected,
        s.signal_bcpnn,
        s.signal_ebgm,
        s.priority_score ?? "",
        s.priority_rank ?? "",
      ].join(","),
    );
  }
  return lines.join("\n");
}

function csvEsc(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}
