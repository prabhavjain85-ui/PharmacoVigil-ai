import {
  bcpnn,
  benjaminiHochberg,
  chiSquarePValue,
  chiSquareYates,
  computeMantelHaenszel,
  computeOmegaInteraction,
  ebgmPair,
  expectedCount,
  fitGammaPoissonPrior,
  fitWeibullTto,
} from "./bayesian";
import {
  buildCaseLevelTable,
  deduplicateDemoByCaseId,
  detectProbableDuplicates,
  uniqueCases,
} from "./buildPairs";
import { getPrioritizerModel, scoreFeatureFrames, SERIOUS_EVENTS } from "./mlPrioritize";
import {
  buildFeatureFrame,
  caseLevelFeatures,
  computeFeatureAvailability,
  contextFromTables,
} from "./pairFeatures";
import { requireColumns } from "./parseCsv";
import type {
  AnalysisResult,
  DuplicateSignalCounts,
  FaersRow,
  InteractionSignalRow,
  OpenFdaCountRow,
  OptionalTables,
  PairRow,
  SignalRow,
  StratifiedPairSummary,
  StratumMetrics,
  TemporalPeriodPoint,
  TemporalSignalSeries,
  WeibullTtoResult,
} from "./types";

const AGE_UNIT_TO_YEARS: Record<string, number> = {
  YR: 1.0,
  DEC: 10.0,
  MON: 1 / 12,
  WK: 1 / 52.18,
  DY: 1 / 365.25,
  HR: 1 / 8766,
};

export type AnalysisProgressCallback = (step: string, percent: number) => void;

export function runAnalysis(
  demo: FaersRow[],
  drug: FaersRow[],
  reac: FaersRow[],
  source: "sample" | "upload",
  fileNames?: AnalysisResult["meta"]["fileNames"],
  minCases = 3,
  optional?: OptionalTables,
  options?: {
    excludeFlaggedDuplicates?: boolean;
    onProgress?: AnalysisProgressCallback;
  },
): AnalysisResult {
  const onProgress = options?.onProgress;
  onProgress?.("Validating columns & deduplicating case versions...", 10);

  requireColumns(demo, ["primaryid"], "DEMO");
  requireColumns(drug, ["primaryid", "drugname"], "DRUG");
  requireColumns(reac, ["primaryid", "pt"], "REAC");

  const { dedupedDemo, supersededVersionsDropped } = deduplicateDemoByCaseId(demo);

  onProgress?.("Scoring probable cross-caseid duplicates...", 22);
  const { flaggedPairs, flaggedSecondaryPrimaryIds } = detectProbableDuplicates(
    dedupedDemo,
    drug,
    reac,
  );
  const excludeSet = options?.excludeFlaggedDuplicates
    ? new Set(flaggedSecondaryPrimaryIds)
    : undefined;

  onProgress?.("Building case-level drug–event pairs...", 35);
  const pairs = buildCaseLevelTable(dedupedDemo, drug, reac, excludeSet);
  const totalReports = uniqueCases(pairs);

  onProgress?.("Computing disproportionality, exact EBGM & FDR q-values...", 50);
  const signals = computeDisproportionality(pairs, totalReports, minCases);

  // Compute baseline vs deduplicated signal counts for duplicate review impact panel
  const countSignals = (sigs: SignalRow[], cases: number): DuplicateSignalCounts => ({
    cases,
    signals_prr: sigs.filter((s) => s.signal_detected).length,
    signals_bcpnn: sigs.filter((s) => s.signal_bcpnn).length,
    signals_ebgm: sigs.filter((s) => s.signal_ebgm).length,
    signals_fdr: sigs.filter((s) => s.signal_fdr).length,
  });

  let baselineCounts: DuplicateSignalCounts;
  let excludedCounts: DuplicateSignalCounts;
  if (flaggedSecondaryPrimaryIds.length === 0) {
    const current = countSignals(signals, totalReports);
    baselineCounts = current;
    excludedCounts = current;
  } else if (options?.excludeFlaggedDuplicates) {
    excludedCounts = countSignals(signals, totalReports);
    const basePairs = buildCaseLevelTable(dedupedDemo, drug, reac);
    const baseTotal = uniqueCases(basePairs);
    const baseSigs = computeDisproportionality(basePairs, baseTotal, minCases);
    baselineCounts = countSignals(baseSigs, baseTotal);
  } else {
    baselineCounts = countSignals(signals, totalReports);
    const dedupPairs = buildCaseLevelTable(
      dedupedDemo,
      drug,
      reac,
      new Set(flaggedSecondaryPrimaryIds),
    );
    const dedupTotal = uniqueCases(dedupPairs);
    const dedupSigs = computeDisproportionality(dedupPairs, dedupTotal, minCases);
    excludedCounts = countSignals(dedupSigs, dedupTotal);
  }

  onProgress?.("Computing Mantel–Haenszel stratified & Weibull time-to-onset models...", 68);
  const activeDemo = excludeSet
    ? dedupedDemo.filter((r) => !excludeSet.has((r.primaryid ?? "").trim()))
    : dedupedDemo;

  const stratified = computeStratifiedAnalysis(activeDemo, pairs, signals);
  const weibull = computeWeibullForPairs(activeDemo, pairs, optional?.ther, 10);

  // Enrich signals with Mantel-Haenszel & Weibull summaries
  for (const s of signals) {
    const key = `${s.drug}|${s.adverse_event}`;
    const strat = stratified[key];
    if (strat) {
      s.PRR_MH = strat.adjusted_PRR_MH;
      s.ROR_MH = strat.adjusted_ROR_MH;
      s.IC_stratified = strat.stratified_IC;
      s.prr_confounding_pct = strat.prr_change_pct;
      s.confounding_flagged = strat.confounding_flagged;
    }
    const wb = weibull[key];
    if (wb) {
      s.weibull_shape = wb.shape_k;
      s.weibull_shape_ci_low = wb.shape_ci_low;
      s.weibull_shape_ci_high = wb.shape_ci_high;
      s.weibull_scale = wb.scale_lambda;
      s.weibull_n = wb.n_cases_with_tto;
      s.weibull_regime = wb.regime;
    }
  }

  onProgress?.("Computing ML prioritization features & Omega DDI signals...", 84);
  const context = contextFromTables(activeDemo, drug, optional);
  const caseFeats = caseLevelFeatures(pairs, context);
  const featureFrames = buildFeatureFrame(signals, caseFeats);
  const featureAvailability = computeFeatureAvailability(featureFrames);
  const model = getPrioritizerModel();
  const scored = scoreFeatureFrames(featureFrames, model);

  const ranked = signals
    .map((s, i) => ({
      ...s,
      priority_score: scored[i]?.priority_score ?? null,
      priority_explain: scored[i]?.priority_explain ?? null,
      _origIdx: i,
    }))
    .sort((a, b) => {
      const diff = (b.priority_score ?? 0) - (a.priority_score ?? 0);
      return diff !== 0 ? diff : a._origIdx - b._origIdx;
    })
    .map(({ _origIdx: _, ...s }, i) => ({ ...s, priority_rank: i + 1 }));

  const interactions = computeDrugInteractions(pairs, totalReports, Math.max(2, minCases));
  const drugSet = new Set(ranked.map((s) => s.drug));

  onProgress?.("Analysis complete", 100);

  return {
    meta: {
      source,
      case_count: totalReports,
      demo_rows: demo.length,
      superseded_versions_dropped: supersededVersionsDropped,
      probable_duplicates_flagged: flaggedPairs.length,
      drug_rows: drug.length,
      reac_rows: reac.length,
      outc_rows: optional?.outc?.length,
      indi_rows: optional?.indi?.length,
      ther_rows: optional?.ther?.length,
      pair_count: pairs.length,
      drug_count: drugSet.size,
      fileNames,
    },
    pairs,
    signals: ranked,
    prior: ranked.length ? fitPriorFromSignals(ranked, totalReports) : { alpha: 1, beta: 1 },
    model,
    featureAvailability,
    duplicates: {
      superseded_versions_dropped: supersededVersionsDropped,
      flagged_pairs: flaggedPairs,
      flagged_secondary_primaryids: flaggedSecondaryPrimaryIds,
      excluded_active: Boolean(options?.excludeFlaggedDuplicates),
      baseline_counts: baselineCounts,
      excluded_counts: excludedCounts,
    },
    stratified,
    weibull,
    interactions,
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

export function computeDisproportionality(
  pairs: PairRow[],
  totalReports: number,
  minCases: number,
): SignalRow[] {
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

  // Sort pair keys lexicographically by (drug, adverse_event) to match pandas groupby(["drugname", "pt"])
  const sortedEntries = [...pairCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

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

  for (const [key, a] of sortedEntries) {
    if (a < minCases) continue;
    const [drug, adverse_event] = key.split("|");
    const drugTotal = drugTotals.get(drug)!.size;
    const eventTotal = eventTotals.get(adverse_event)!.size;
    const b = drugTotal - a;
    const c = eventTotal - a;
    const d = totalReports - drugTotal - eventTotal + a;
    if (b <= 0 || c <= 0 || d <= 0) continue;
    strata.push({
      drug,
      adverse_event,
      a,
      b,
      c,
      d,
      drug_total_reports: drugTotal,
      event_total_reports: eventTotal,
    });
  }

  if (strata.length === 0) return [];

  const observed = strata.map((s) => s.a);
  const expected = strata.map((s) => expectedCount(s.a, s.b, s.c, s.d, totalReports));
  const prior = fitGammaPoissonPrior(observed, expected);

  const rawRows = strata.map((s) => {
    const prr = (s.a / (s.a + s.b)) / (s.c / (s.c + s.d));
    const ror = (s.a * s.d) / (s.b * s.c);
    const chi2 = chiSquareYates(s.a, s.b, s.c, s.d);
    const rawP = chiSquarePValue(chi2);
    const se = Math.sqrt(1 / s.a + 1 / s.b + 1 / s.c + 1 / s.d);
    const logRor = Math.log(ror);
    const bcp = bcpnn(s.a, s.b, s.c, s.d, totalReports);
    const exp = expectedCount(s.a, s.b, s.c, s.d, totalReports);
    const ebg = ebgmPair(s.a, exp, prior);
    return {
      s,
      prr,
      ror,
      chi2,
      rawP,
      se,
      logRor,
      bcp,
      ebg,
    };
  });

  const qValues = benjaminiHochberg(rawRows.map((r) => round6(r.rawP)));

  return rawRows.map((r, idx) => {
    const qVal = qValues[idx];
    return {
      drug: r.s.drug,
      adverse_event: r.s.adverse_event,
      case_count_a: r.s.a,
      drug_total_reports: r.s.drug_total_reports,
      event_total_reports: r.s.event_total_reports,
      PRR: round3(r.prr),
      ROR: round3(r.ror),
      ROR_95CI_low: round3(Math.exp(r.logRor - 1.96 * r.se)),
      ROR_95CI_high: round3(Math.exp(r.logRor + 1.96 * r.se)),
      chi_square: round3(r.chi2),
      p_value: round6(r.rawP),
      q_value: qVal,
      signal_fdr: qVal < 0.05 && r.prr >= 2 && r.s.a >= minCases,
      IC: r.bcp.ic,
      IC025: r.bcp.ic025,
      IC975: r.bcp.ic975,
      signal_bcpnn: r.bcp.signal_bcpnn,
      EBGM: r.ebg.ebgm,
      EB05: r.ebg.eb05,
      EB95: r.ebg.eb95,
      signal_ebgm: r.ebg.signal_ebgm,
      serious_event: SERIOUS_EVENTS.has(r.s.adverse_event),
      signal_detected: r.prr >= 2 && r.chi2 >= 4 && r.s.a >= minCases,
      priority_score: null,
      priority_rank: null,
      priority_explain: null,
    };
  });
}

function getAgeBand(row: FaersRow): string {
  const raw = (row.age ?? "").trim();
  if (!raw) return "UNK";
  const num = Number(raw);
  if (!Number.isFinite(num)) return "UNK";
  const unit = (row.age_cod ?? "YR").trim().toUpperCase() || "YR";
  const yrs = num * (AGE_UNIT_TO_YEARS[unit] ?? 1.0);
  if (yrs < 0 || yrs > 120) return "UNK";
  if (yrs < 18) return "0-17";
  if (yrs < 45) return "18-44";
  if (yrs < 65) return "45-64";
  return "65+";
}

function getSexBand(row: FaersRow): string {
  const s = (row.sex ?? "").trim().toUpperCase();
  return s === "F" || s === "M" ? s : "UNK";
}

/**
 * Computes age-band, sex, and joint (age_band x sex) stratified PRR/IC and
 * Mantel–Haenszel adjusted estimates for each eligible drug–event signal.
 */
export function computeStratifiedAnalysis(
  demo: FaersRow[],
  pairs: PairRow[],
  signals: SignalRow[],
): Record<string, StratifiedPairSummary> {
  const caseAgeBand = new Map<string, string>();
  const caseSex = new Map<string, string>();

  for (const r of demo) {
    const pid = (r.primaryid ?? "").trim();
    if (!pid) continue;
    caseAgeBand.set(pid, getAgeBand(r));
    caseSex.set(pid, getSexBand(r));
  }

  // Only include cases that appear in `pairs` (matching total_reports denominator)
  const activePids = new Set(pairs.map((p) => p.primaryid));
  const ageStrataCases = new Map<string, Set<string>>();
  const sexStrataCases = new Map<string, Set<string>>();
  const jointStrataCases = new Map<string, Set<string>>();

  for (const pid of activePids) {
    const ab = caseAgeBand.get(pid) ?? "UNK";
    const sx = caseSex.get(pid) ?? "UNK";
    if (ab !== "UNK") {
      if (!ageStrataCases.has(ab)) ageStrataCases.set(ab, new Set());
      ageStrataCases.get(ab)!.add(pid);
    }
    if (sx !== "UNK") {
      if (!sexStrataCases.has(sx)) sexStrataCases.set(sx, new Set());
      sexStrataCases.get(sx)!.add(pid);
    }
    if (ab !== "UNK" && sx !== "UNK") {
      const jk = `${ab}|${sx}`;
      if (!jointStrataCases.has(jk)) jointStrataCases.set(jk, new Set());
      jointStrataCases.get(jk)!.add(pid);
    }
  }

  // Pre-index drug cases and event cases
  const drugCases = new Map<string, Set<string>>();
  const eventCases = new Map<string, Set<string>>();
  const pairCases = new Map<string, Set<string>>();

  for (const p of pairs) {
    if (!drugCases.has(p.drugname)) drugCases.set(p.drugname, new Set());
    drugCases.get(p.drugname)!.add(p.primaryid);
    if (!eventCases.has(p.pt)) eventCases.set(p.pt, new Set());
    eventCases.get(p.pt)!.add(p.primaryid);
    const pk = `${p.drugname}|${p.pt}`;
    if (!pairCases.has(pk)) pairCases.set(pk, new Set());
    pairCases.get(pk)!.add(p.primaryid);
  }

  const evalStrataGroup = (
    strataMap: Map<string, Set<string>>,
    orderedKeys: string[],
    dSet: Set<string>,
    eSet: Set<string>,
    pSet: Set<string>,
  ): StratumMetrics[] => {
    const list: StratumMetrics[] = [];
    for (const sk of orderedKeys) {
      const sCases = strataMap.get(sk);
      if (!sCases || sCases.size === 0) continue;
      const n_total = sCases.size;
      let a = 0;
      let dTot = 0;
      let eTot = 0;
      for (const pid of sCases) {
        const hasD = dSet.has(pid);
        const hasE = eSet.has(pid);
        if (hasD) dTot++;
        if (hasE) eTot++;
        if (hasD && hasE && pSet.has(pid)) a++;
      }
      const b = dTot - a;
      const c = eTot - a;
      const d = n_total - dTot - eTot + a;
      const prr =
        a + b > 0 && c + d > 0 && c > 0 ? round3((a / (a + b)) / (c / (c + d))) : null;
      const bcp = bcpnn(Math.max(0, a), Math.max(0, b), Math.max(0, c), Math.max(0, d), n_total);
      list.push({
        stratum: sk,
        a,
        b,
        c,
        d,
        n_total,
        PRR: prr,
        IC: bcp.ic,
        IC025: bcp.ic025,
      });
    }
    return list;
  };

  const AGE_ORDER = ["0-17", "18-44", "45-64", "65+"];
  const SEX_ORDER = ["F", "M"];
  const JOINT_ORDER = AGE_ORDER.flatMap((ab) => SEX_ORDER.map((sx) => `${ab}|${sx}`));

  const out: Record<string, StratifiedPairSummary> = {};

  for (const s of signals) {
    const pk = `${s.drug}|${s.adverse_event}`;
    const dSet = drugCases.get(s.drug) ?? new Set();
    const eSet = eventCases.get(s.adverse_event) ?? new Set();
    const pSet = pairCases.get(pk) ?? new Set();

    const by_age_band = evalStrataGroup(ageStrataCases, AGE_ORDER, dSet, eSet, pSet);
    const by_sex = evalStrataGroup(sexStrataCases, SEX_ORDER, dSet, eSet, pSet);
    const by_age_sex = evalStrataGroup(jointStrataCases, JOINT_ORDER, dSet, eSet, pSet);

    const mh = computeMantelHaenszel(by_age_sex);
    const prrChangePct =
      mh.prr_mh !== null && s.PRR > 0
        ? round3(((mh.prr_mh - s.PRR) / s.PRR) * 100)
        : null;

    const logRatioDiff =
      mh.prr_mh !== null && mh.prr_mh > 0 && s.PRR > 0
        ? Math.abs(Math.log(mh.prr_mh / s.PRR))
        : 0;
    const thresholdFlip =
      mh.prr_mh !== null && ((s.PRR >= 2 && mh.prr_mh < 2) || (s.PRR < 2 && mh.prr_mh >= 2));
    const confounding_flagged = logRatioDiff >= Math.log(1.2) || Boolean(thresholdFlip);

    let direction: StratifiedPairSummary["direction"] = "consistent";
    if (confounding_flagged && prrChangePct !== null) {
      direction = prrChangePct < 0 ? "inflated_pooled" : "masked_pooled";
    }

    out[pk] = {
      drug: s.drug,
      adverse_event: s.adverse_event,
      case_count_a: s.case_count_a,
      pooled_PRR: s.PRR,
      adjusted_PRR_MH: mh.prr_mh,
      pooled_ROR: s.ROR,
      adjusted_ROR_MH: mh.ror_mh,
      pooled_IC: s.IC,
      stratified_IC: mh.ic_stratified,
      prr_change_pct: prrChangePct,
      confounding_flagged,
      direction,
      by_age_band,
      by_sex,
      by_age_sex,
    };
  }

  return out;
}

function parseFaersDateMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!/^\d{8}$/.test(text)) return null;
  const y = Number(text.slice(0, 4));
  const m = Number(text.slice(4, 6));
  const d = Number(text.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt.getTime();
}

/**
 * Fits Weibull distributions across all drug–event pairs that have >= minCases (default 10)
 * valid time-to-onset observations from THER.start_dt and DEMO.event_dt.
 */
export function computeWeibullForPairs(
  demo: FaersRow[],
  pairs: PairRow[],
  ther: FaersRow[] | undefined,
  minCases = 10,
): Record<string, WeibullTtoResult> {
  const out: Record<string, WeibullTtoResult> = {};
  if (!ther || ther.length === 0) return out;

  const eventDateByPid = new Map<string, number>();
  for (const r of demo) {
    const pid = (r.primaryid ?? "").trim();
    const ms = parseFaersDateMs(r.event_dt);
    if (pid && ms !== null) eventDateByPid.set(pid, ms);
  }

  const perCaseStart = new Map<string, number>();
  const perDrugStart = new Map<string, number>();
  for (const r of ther) {
    const pid = (r.primaryid ?? "").trim();
    const startMs = parseFaersDateMs(r.start_dt);
    if (!pid || startMs === null) continue;
    const prevCase = perCaseStart.get(pid);
    if (prevCase === undefined || startMs < prevCase) {
      perCaseStart.set(pid, startMs);
    }
    const seq = (r.dsg_drug_seq ?? "").trim();
    if (seq) {
      const dk = `${pid}|${seq}`;
      const prevDrug = perDrugStart.get(dk);
      if (prevDrug === undefined || startMs < prevDrug) {
        perDrugStart.set(dk, startMs);
      }
    }
  }

  const ttoByPair = new Map<string, number[]>();
  for (const p of pairs) {
    const pid = p.primaryid.trim();
    const evMs = eventDateByPid.get(pid);
    if (evMs === undefined) continue;
    let startMs = perCaseStart.get(pid);
    if (p.drug_seq) {
      const dStart = perDrugStart.get(`${pid}|${p.drug_seq.trim()}`);
      if (dStart !== undefined) startMs = dStart;
    }
    if (startMs === undefined) continue;
    const days = Math.round((evMs - startMs) / 86_400_000);
    if (days >= 0 && days <= 3650) {
      const pk = `${p.drugname}|${p.pt}`;
      let arr = ttoByPair.get(pk);
      if (!arr) {
        arr = [];
        ttoByPair.set(pk, arr);
      }
      arr.push(days);
    }
  }

  for (const [pk, days] of ttoByPair.entries()) {
    if (days.length < minCases) continue;
    const [drug, adverse_event] = pk.split("|");
    const fitted = fitWeibullTto(drug, adverse_event, days, minCases);
    if (fitted) out[pk] = fitted;
  }

  return out;
}

/**
 * Computes cumulative IC with 95% intervals by month or quarter for a selected (drug, event) pair,
 * the date IC025 first exceeded zero, and Poisson Log-Likelihood Ratio + Page's CUSUM change-point
 * detection on the reporting rate.
 */
export function computeTemporalSignalSeries(
  pairs: PairRow[],
  drug: string,
  adverse_event: string,
  granularity: "month" | "quarter" = "month",
): TemporalSignalSeries {
  const periodOf = (eventDt?: string): string | null => {
    if (!eventDt) return null;
    const clean = eventDt.trim();
    if (clean.length < 6 || !/^\d{6}/.test(clean)) return null;
    const y = clean.slice(0, 4);
    const m = Number(clean.slice(4, 6));
    if (m < 1 || m > 12) return null;
    if (granularity === "quarter") {
      const q = Math.floor((m - 1) / 3) + 1;
      return `${y}-Q${q}`;
    }
    return `${y}-${String(m).padStart(2, "0")}`;
  };

  // Group case-level presence by period (each primaryid assigned to its event_dt period)
  const casePeriod = new Map<string, string>();
  const caseDrugs = new Map<string, Set<string>>();
  const caseEvents = new Map<string, Set<string>>();

  for (const p of pairs) {
    const per = periodOf(p.event_dt);
    if (!per) continue;
    const pid = p.primaryid;
    casePeriod.set(pid, per);
    if (!caseDrugs.has(pid)) caseDrugs.set(pid, new Set());
    caseDrugs.get(pid)!.add(p.drugname);
    if (!caseEvents.has(pid)) caseEvents.set(pid, new Set());
    caseEvents.get(pid)!.add(p.pt);
  }

  const allPeriods = [...new Set(casePeriod.values())].sort();
  if (allPeriods.length === 0) {
    return {
      drug,
      adverse_event,
      granularity,
      first_ic025_gt0_period: null,
      changepoint_period: null,
      changepoint_llr: 0,
      changepoint_p_value: 1,
      changepoint_detected: false,
      pre_rate: 0,
      post_rate: 0,
      points: [],
    };
  }

  const periodBuckets = new Map<
    string,
    { n: number; drugCount: number; eventCount: number; pairCount: number }
  >();
  for (const per of allPeriods) {
    periodBuckets.set(per, { n: 0, drugCount: 0, eventCount: 0, pairCount: 0 });
  }

  for (const [pid, per] of casePeriod.entries()) {
    const b = periodBuckets.get(per)!;
    b.n += 1;
    const hasD = caseDrugs.get(pid)?.has(drug) ?? false;
    const hasE = caseEvents.get(pid)?.has(adverse_event) ?? false;
    if (hasD) b.drugCount += 1;
    if (hasE) b.eventCount += 1;
    if (hasD && hasE) b.pairCount += 1;
  }

  // Total drug reports and pair reports across all dated periods for baseline rate
  let totalDrugReports = 0;
  let totalPairReports = 0;
  for (const b of periodBuckets.values()) {
    totalDrugReports += b.drugCount;
    totalPairReports += b.pairCount;
  }
  const baselineRate = totalPairReports / Math.max(1, totalDrugReports);

  // Compute 2-segment Poisson Log-Likelihood Ratio (G² = 2 * LLR) for each split index
  const K = allPeriods.length;
  const llrByIdx = new Array<number>(K).fill(0);
  let bestSplitIdx = -1;
  let maxLlr = 0;
  let bestPreRate = baselineRate;
  let bestPostRate = baselineRate;

  let preA = 0;
  let preM = 0;
  for (let m = 0; m < K - 1; m++) {
    const b = periodBuckets.get(allPeriods[m])!;
    preA += b.pairCount;
    preM += b.drugCount;
    const postA = totalPairReports - preA;
    const postM = totalDrugReports - preM;

    if (preM > 0 && postM > 0 && totalPairReports > 0) {
      const e1 = totalPairReports * (preM / totalDrugReports);
      const e2 = totalPairReports * (postM / totalDrugReports);
      const term1 = preA > 0 && e1 > 0 ? preA * Math.log(preA / e1) : 0;
      const term2 = postA > 0 && e2 > 0 ? postA * Math.log(postA / e2) : 0;
      const g2 = Math.max(0, 2 * (term1 + term2));
      llrByIdx[m + 1] = round4(g2);
      // Flag upward or material rate shift at period m + 1
      if (g2 > maxLlr) {
        maxLlr = g2;
        bestSplitIdx = m + 1;
        bestPreRate = preA / preM;
        bestPostRate = postA / postM;
      }
    }
  }

  let cumN = 0;
  let cumDrug = 0;
  let cumEvent = 0;
  let cumA = 0;
  let cusum = 0;
  let firstSignalPeriod: string | null = null;

  const points: TemporalPeriodPoint[] = [];
  for (let i = 0; i < K; i++) {
    const per = allPeriods[i];
    const b = periodBuckets.get(per)!;
    cumN += b.n;
    cumDrug += b.drugCount;
    cumEvent += b.eventCount;
    cumA += b.pairCount;

    const cumB = Math.max(0, cumDrug - cumA);
    const cumC = Math.max(0, cumEvent - cumA);
    const cumD = Math.max(0, cumN - cumDrug - cumEvent + cumA);

    const bcp = bcpnn(cumA, cumB, cumC, cumD, cumN);
    if (firstSignalPeriod === null && bcp.ic025 > 0) {
      firstSignalPeriod = per;
    }

    // Sequential Page's Poisson CUSUM against 1.25x baseline reference shift
    const expectedPeriodA = b.drugCount * baselineRate;
    const kRef = expectedPeriodA * 1.15 + 0.05;
    cusum = Math.max(0, cusum + (b.pairCount - kRef));

    points.push({
      period: per,
      period_cases_a: b.pairCount,
      period_drug_reports: b.drugCount,
      period_rate: b.drugCount > 0 ? round4(b.pairCount / b.drugCount) : 0,
      cum_a: cumA,
      cum_b: cumB,
      cum_c: cumC,
      cum_d: cumD,
      cum_n: cumN,
      cum_ic: bcp.ic,
      cum_ic025: bcp.ic025,
      cum_ic975: bcp.ic975,
      cusum_stat: round4(cusum),
      llr_stat: llrByIdx[i],
    });
  }

  const cpPval = round6(chiSquarePValue(maxLlr));
  // Threshold G² >= 6.63 corresponds to α = 0.01 per split to control family-wise false alarm rate
  const cpDetected = maxLlr >= 6.63 && bestSplitIdx > 0;

  return {
    drug,
    adverse_event,
    granularity,
    first_ic025_gt0_period: firstSignalPeriod,
    changepoint_period: bestSplitIdx > 0 ? allPeriods[bestSplitIdx] : null,
    changepoint_llr: round4(maxLlr),
    changepoint_p_value: cpPval,
    changepoint_detected: cpDetected,
    pre_rate: round4(bestPreRate),
    post_rate: round4(bestPostRate),
    points,
  };
}

/**
 * Computes Norén et al. (2008) Omega (Ω) shrinkage drug–drug interaction signals
 * across triplets (drug_a, drug_b, adverse_event). Caps the search to stay responsive.
 */
export function computeDrugInteractions(
  pairs: PairRow[],
  totalReports: number,
  minCoCases = 2,
  maxTriplets = 200,
): InteractionSignalRow[] {
  if (pairs.length === 0 || totalReports <= 0) return [];

  const caseDrugs = new Map<string, Set<string>>();
  const caseEvents = new Map<string, Set<string>>();
  const drugCases = new Map<string, Set<string>>();
  const eventCases = new Map<string, Set<string>>();
  const singlePairCases = new Map<string, Set<string>>();

  for (const p of pairs) {
    const pid = p.primaryid;
    if (!caseDrugs.has(pid)) caseDrugs.set(pid, new Set());
    caseDrugs.get(pid)!.add(p.drugname);

    if (!caseEvents.has(pid)) caseEvents.set(pid, new Set());
    caseEvents.get(pid)!.add(p.pt);

    if (!drugCases.has(p.drugname)) drugCases.set(p.drugname, new Set());
    drugCases.get(p.drugname)!.add(pid);

    if (!eventCases.has(p.pt)) eventCases.set(p.pt, new Set());
    eventCases.get(p.pt)!.add(pid);

    const spKey = `${p.drugname}|${p.pt}`;
    if (!singlePairCases.has(spKey)) singlePairCases.set(spKey, new Set());
    singlePairCases.get(spKey)!.add(pid);
  }

  // Count co-administered drug pairs (n11) and triplet co-events (n111) across multi-drug cases
  const drugPairCount = new Map<string, number>();
  const tripletCount = new Map<string, number>();

  for (const [pid, dSet] of caseDrugs.entries()) {
    if (dSet.size < 2) continue;
    // Cap drugs per case at 12 to prevent combinatorial explosion on polypharmacy outlier reports
    const drugs = [...dSet].sort().slice(0, 12);
    const events = [...(caseEvents.get(pid) ?? [])].sort();

    for (let i = 0; i < drugs.length; i++) {
      for (let j = i + 1; j < drugs.length; j++) {
        const dpKey = `${drugs[i]}|${drugs[j]}`;
        drugPairCount.set(dpKey, (drugPairCount.get(dpKey) ?? 0) + 1);
        for (const ev of events) {
          const tKey = `${drugs[i]}|${drugs[j]}|${ev}`;
          tripletCount.set(tKey, (tripletCount.get(tKey) ?? 0) + 1);
        }
      }
    }
  }

  const eligibleTriplets = [...tripletCount.entries()]
    .filter(([, n111]) => n111 >= minCoCases)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTriplets);

  const results: InteractionSignalRow[] = [];

  for (const [tKey, n111] of eligibleTriplets) {
    const [drug_a, drug_b, adverse_event] = tKey.split("|");
    const dpKey = `${drug_a}|${drug_b}`;
    const n11 = drugPairCount.get(dpKey) ?? n111;

    const nA = drugCases.get(drug_a)?.size ?? 0;
    const nB = drugCases.get(drug_b)?.size ?? 0;
    const nE = eventCases.get(adverse_event)?.size ?? 0;

    const nAE = singlePairCases.get(`${drug_a}|${adverse_event}`)?.size ?? 0;
    const nBE = singlePairCases.get(`${drug_b}|${adverse_event}`)?.size ?? 0;

    // 4 mutually exclusive cells:
    // 11: both A and B
    // 10: A without B
    // 01: B without A
    // 00: neither A nor B
    const n10 = Math.max(0, nA - n11);
    const n01 = Math.max(0, nB - n11);
    const n00 = Math.max(0, totalReports - n11 - n10 - n01);

    const n101 = Math.max(0, nAE - n111);
    const n011 = Math.max(0, nBE - n111);
    const n001 = Math.max(0, nE - n111 - n101 - n011);

    const omegaRes = computeOmegaInteraction(n111, n11, n101, n10, n011, n01, n001, n00);

    const calcSimplePrr = (aCount: number, totDrug: number) => {
      const bCount = totDrug - aCount;
      const cCount = nE - aCount;
      const dCount = totalReports - totDrug - nE + aCount;
      if (aCount + bCount <= 0 || cCount + dCount <= 0 || cCount <= 0) return null;
      return round3((aCount / (aCount + bCount)) / (cCount / (cCount + dCount)));
    };

    const prr_a = calcSimplePrr(nAE, nA);
    const prr_b = calcSimplePrr(nBE, nB);
    const prr_ab = calcSimplePrr(n111, n11) ?? 0;

    results.push({
      drug_a,
      drug_b,
      adverse_event,
      n111,
      n11,
      n101,
      n10,
      n011,
      n01,
      n001,
      n00,
      ...omegaRes,
      prr_a,
      prr_b,
      prr_ab,
    });
  }

  results.sort(
    (a, b) =>
      b.omega025 - a.omega025 ||
      b.omega - a.omega ||
      b.n111 - a.n111 ||
      a.drug_a.localeCompare(b.drug_a),
  );

  return results;
}

function round3(x: number) {
  return Math.round(x * 1000) / 1000;
}

function round4(x: number) {
  return Math.round(x * 10000) / 10000;
}

function round6(x: number) {
  return Math.round(x * 1000000) / 1000000;
}

export function signalsToCsv(signals: SignalRow[]): string {
  const headers = [
    "drug",
    "adverse_event",
    "case_count_a",
    "PRR",
    "PRR_MH",
    "ROR",
    "chi_square",
    "p_value",
    "q_value",
    "IC",
    "IC025",
    "EBGM",
    "EB05",
    "signal_detected",
    "signal_bcpnn",
    "signal_ebgm",
    "signal_fdr",
    "priority_score",
    "priority_rank",
  ];
  const lines = [headers.join(",")];
  for (const s of signals) {
    lines.push(
      [
        csvEsc(s.drug),
        csvEsc(s.adverse_event),
        s.case_count_a,
        s.PRR,
        s.PRR_MH ?? "",
        s.ROR,
        s.chi_square,
        s.p_value,
        s.q_value,
        s.IC,
        s.IC025,
        s.EBGM,
        s.EB05,
        s.signal_detected,
        s.signal_bcpnn,
        s.signal_ebgm,
        s.signal_fdr,
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

/**
 * Runs the existing disproportionality pipeline directly on 2x2 contingency counts
 * `(a, drug_total, event_total, totalReports)` returned by live openFDA count queries.
 */
export function computeDisproportionalityFromCounts(
  countRows: OpenFdaCountRow[],
  totalReports: number,
  minCases = 3,
): SignalRow[] {
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

  const sorted = [...countRows].sort(
    (x, y) => x.drug.localeCompare(y.drug) || x.adverse_event.localeCompare(y.adverse_event),
  );

  for (const r of sorted) {
    const a = Math.round(r.a);
    if (a < minCases) continue;
    const drugTotal = Math.round(r.drug_total);
    const eventTotal = Math.round(r.event_total);
    const b = drugTotal - a;
    const c = eventTotal - a;
    const d = totalReports - drugTotal - eventTotal + a;
    if (b <= 0 || c <= 0 || d <= 0) continue;
    strata.push({
      drug: r.drug.trim().toUpperCase(),
      adverse_event: r.adverse_event.trim().toUpperCase(),
      a,
      b,
      c,
      d,
      drug_total_reports: drugTotal,
      event_total_reports: eventTotal,
    });
  }

  if (strata.length === 0) return [];

  const observed = strata.map((s) => s.a);
  const expected = strata.map((s) => expectedCount(s.a, s.b, s.c, s.d, totalReports));
  const prior = fitGammaPoissonPrior(observed, expected);

  const rawRows = strata.map((s) => {
    const prr = (s.a / (s.a + s.b)) / (s.c / (s.c + s.d));
    const ror = (s.a * s.d) / (s.b * s.c);
    const chi2 = chiSquareYates(s.a, s.b, s.c, s.d);
    const rawP = chiSquarePValue(chi2);
    const se = Math.sqrt(1 / s.a + 1 / s.b + 1 / s.c + 1 / s.d);
    const logRor = Math.log(ror);
    const bcp = bcpnn(s.a, s.b, s.c, s.d, totalReports);
    const exp = expectedCount(s.a, s.b, s.c, s.d, totalReports);
    const ebg = ebgmPair(s.a, exp, prior);
    return { s, prr, ror, chi2, rawP, se, logRor, bcp, ebg };
  });

  const qValues = benjaminiHochberg(rawRows.map((r) => round6(r.rawP)));

  return rawRows.map((r, idx) => {
    const qVal = qValues[idx];
    return {
      drug: r.s.drug,
      adverse_event: r.s.adverse_event,
      case_count_a: r.s.a,
      drug_total_reports: r.s.drug_total_reports,
      event_total_reports: r.s.event_total_reports,
      PRR: round3(r.prr),
      ROR: round3(r.ror),
      ROR_95CI_low: round3(Math.exp(r.logRor - 1.96 * r.se)),
      ROR_95CI_high: round3(Math.exp(r.logRor + 1.96 * r.se)),
      chi_square: round3(r.chi2),
      p_value: round6(r.rawP),
      q_value: qVal,
      signal_fdr: qVal < 0.05 && r.prr >= 2 && r.s.a >= minCases,
      IC: r.bcp.ic,
      IC025: r.bcp.ic025,
      IC975: r.bcp.ic975,
      signal_bcpnn: r.bcp.signal_bcpnn,
      EBGM: r.ebg.ebgm,
      EB05: r.ebg.eb05,
      EB95: r.ebg.eb95,
      signal_ebgm: r.ebg.signal_ebgm,
      serious_event: SERIOUS_EVENTS.has(r.s.adverse_event),
      signal_detected: r.prr >= 2 && r.chi2 >= 4 && r.s.a >= minCases,
      priority_score: null,
      priority_rank: null,
      priority_explain: null,
    };
  });
}

/**
 * Builds an AnalysisResult from live openFDA 2x2 count queries.
 * Case-level ML features (OUTC, INDI, THER, DEMO strata) are unavailable in live count mode
 * and are explicitly marked missing (0% coverage in featureAvailability).
 */
export function runOpenFdaCountAnalysis(
  payload: {
    drug: string;
    retrieved_at: string;
    total_reports: number;
    drug_total_reports: number;
    count_rows: OpenFdaCountRow[];
    disclaimer: string;
  },
  minCases = 3,
): AnalysisResult {
  const signals = computeDisproportionalityFromCounts(
    payload.count_rows,
    payload.total_reports,
    minCases,
  );
  // Pass undefined for caseFeatures so all 11 case-level ML features are marked missing (null)
  const featureFrames = buildFeatureFrame(signals, undefined);
  const featureAvailability = computeFeatureAvailability(featureFrames);
  const model = getPrioritizerModel();
  const scored = scoreFeatureFrames(featureFrames, model);

  const ranked = signals
    .map((s, i) => ({
      ...s,
      priority_score: scored[i]?.priority_score ?? null,
      priority_explain: scored[i]?.priority_explain ?? null,
      _origIdx: i,
    }))
    .sort((a, b) => {
      const diff = (b.priority_score ?? 0) - (a.priority_score ?? 0);
      return diff !== 0 ? diff : a._origIdx - b._origIdx;
    })
    .map(({ _origIdx: _, ...s }, i) => ({ ...s, priority_rank: i + 1 }));

  const counts: DuplicateSignalCounts = {
    cases: payload.total_reports,
    signals_prr: ranked.filter((s) => s.signal_detected).length,
    signals_bcpnn: ranked.filter((s) => s.signal_bcpnn).length,
    signals_ebgm: ranked.filter((s) => s.signal_ebgm).length,
    signals_fdr: ranked.filter((s) => s.signal_fdr).length,
  };

  return {
    meta: {
      source: "openfda_live",
      case_count: payload.total_reports,
      demo_rows: 0,
      superseded_versions_dropped: 0,
      probable_duplicates_flagged: 0,
      drug_rows: payload.drug_total_reports,
      reac_rows: ranked.reduce((acc, s) => acc + s.case_count_a, 0),
      pair_count: ranked.length,
      drug_count: 1,
      openfda_drug: payload.drug,
      openfda_retrieved_at: payload.retrieved_at,
      openfda_disclaimer: payload.disclaimer,
    },
    pairs: [],
    signals: ranked,
    prior: ranked.length
      ? fitPriorFromSignals(ranked, payload.total_reports)
      : { alpha: 1, beta: 1 },
    model,
    featureAvailability,
    duplicates: {
      superseded_versions_dropped: 0,
      flagged_pairs: [],
      flagged_secondary_primaryids: [],
      excluded_active: false,
      baseline_counts: counts,
      excluded_counts: counts,
    },
    stratified: {},
    weibull: {},
    interactions: [],
  };
}

