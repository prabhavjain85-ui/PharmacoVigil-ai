/**
 * Feature engineering for ML prioritisation of drug-event pairs.
 * Exact TypeScript mirror of pair_features.py.
 */

import type { FaersRow, OptionalTables, PairRow, SignalRow } from "./types";

export const DISPROPORTIONALITY_FEATURES: [string, string][] = [
  ["ic", "IC (BCPNN)"],
  ["ic025", "IC025 (lower bound)"],
  ["log_prr", "log PRR"],
  ["log_ror_ci_low", "log ROR lower 95% bound"],
  ["log_chi2", "log(1 + chi-square)"],
  ["log_cases", "log(1 + case count)"],
];

export const CASE_FEATURES: [string, string][] = [
  ["frac_death", "Fatal outcome fraction"],
  ["frac_hosp_lt", "Hospitalised / life-threatening fraction"],
  ["frac_serious", "Any serious outcome fraction"],
  ["frac_hcp", "Health-professional reporter fraction"],
  ["frac_female", "Female fraction"],
  ["mean_age", "Mean age (years)"],
  ["log_median_tto", "log(1 + median days to onset)"],
  ["frac_tto_30d", "Onset within 30 days fraction"],
  ["log_mean_drugs", "log mean drugs per report"],
  ["frac_primary_suspect", "Primary-suspect fraction"],
  ["frac_event_is_indication", "Event reported as indication fraction"],
];

export const FEATURE_GROUPS: Record<"disproportionality" | "case", string[]> = {
  disproportionality: DISPROPORTIONALITY_FEATURES.map(([name]) => name),
  case: CASE_FEATURES.map(([name]) => name),
};

export const ALL_FEATURES: string[] = [
  ...FEATURE_GROUPS.disproportionality,
  ...FEATURE_GROUPS.case,
];

export const FEATURE_LABELS: Record<string, string> = Object.fromEntries([
  ...DISPROPORTIONALITY_FEATURES,
  ...CASE_FEATURES,
]);

export const FEATURE_GROUP_OF: Record<string, "disproportionality" | "case"> = {
  ...Object.fromEntries(FEATURE_GROUPS.disproportionality.map((n) => [n, "disproportionality" as const])),
  ...Object.fromEntries(FEATURE_GROUPS.case.map((n) => [n, "case" as const])),
};

const LOG_FLOOR = 1e-3;
const SERIOUS_OUTCOMES = new Set(["DE", "LT", "HO", "DS", "CA", "RI"]);
const HCP_REPORTERS = new Set(["MD", "PH", "OT", "HP", "RN"]);
const MAX_TTO_DAYS = 3650;
const AGE_UNIT_TO_YEARS: Record<string, number> = {
  YR: 1.0,
  DEC: 10.0,
  MON: 1 / 12,
  WK: 1 / 52.18,
  DY: 1 / 365.25,
  HR: 1 / 8766,
};

export type CaseContext = {
  demo?: FaersRow[];
  drug?: FaersRow[];
  outc?: FaersRow[];
  indi?: FaersRow[];
  ther?: FaersRow[];
};

export type FeatureMap = Record<string, number | null>;

function hasCol(rows: FaersRow[] | undefined, col: string): boolean {
  if (!rows || rows.length === 0) return false;
  return Object.prototype.hasOwnProperty.call(rows[0], col);
}

function parseFaersDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!/^\d{8}$/.test(text)) return null;
  const y = Number(text.slice(0, 4));
  const m = Number(text.slice(4, 6));
  const d = Number(text.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt.getTime();
}

export function disproportionalityFeatures(signal: SignalRow): Record<string, number> {
  return {
    ic: signal.IC,
    ic025: signal.IC025,
    log_prr: Math.log(Math.max(signal.PRR, LOG_FLOOR)),
    log_ror_ci_low: Math.log(Math.max(signal.ROR_95CI_low, LOG_FLOOR)),
    log_chi2: Math.log1p(Math.max(signal.chi_square, 0.0)),
    log_cases: Math.log1p(signal.case_count_a),
  };
}

type CaseAttr = {
  female?: number | null;
  age_years?: number | null;
  hcp?: number | null;
  event_date?: number | null;
  death?: number | null;
  hosp_lt?: number | null;
  serious?: number | null;
  n_drugs?: number | null;
};

function buildCaseTable(context: CaseContext): {
  cases: Map<string, CaseAttr>;
  hasFemale: boolean;
  hasAge: boolean;
  hasHcp: boolean;
  hasEventDate: boolean;
  hasOutc: boolean;
  hasNDrugs: boolean;
} {
  const cases = new Map<string, CaseAttr>();
  const ensure = (pid: string): CaseAttr => {
    let c = cases.get(pid);
    if (!c) {
      c = {};
      cases.set(pid, c);
    }
    return c;
  };

  const demo = context.demo;
  const hasDemoPid = hasCol(demo, "primaryid");
  const hasFemale = hasDemoPid && hasCol(demo, "sex");
  const hasAge = hasDemoPid && hasCol(demo, "age");
  const hasAgeCod = hasDemoPid && hasCol(demo, "age_cod");
  const hasHcp = hasDemoPid && hasCol(demo, "occp_cod");
  const hasEventDate = hasDemoPid && hasCol(demo, "event_dt");

  if (demo && hasDemoPid) {
    const seenDemo = new Set<string>();
    for (const row of demo) {
      const pid = row.primaryid?.trim();
      if (!pid || seenDemo.has(pid)) continue;
      seenDemo.add(pid);
      const attr = ensure(pid);

      if (hasFemale) {
        const sex = (row.sex ?? "").trim().toUpperCase();
        attr.female = sex === "F" ? 1.0 : sex === "M" ? 0.0 : null;
      }
      if (hasAge) {
        const rawAge = (row.age ?? "").trim();
        const ageNum = rawAge === "" ? NaN : Number(rawAge);
        let mult = 1.0;
        if (hasAgeCod) {
          const unit = (row.age_cod ?? "").trim().toUpperCase();
          mult = AGE_UNIT_TO_YEARS[unit] ?? 1.0;
        }
        const ageYears = ageNum * mult;
        attr.age_years =
          !Number.isNaN(ageYears) && ageYears >= 0 && ageYears <= 120 ? ageYears : null;
      }
      if (hasHcp) {
        const occp = (row.occp_cod ?? "").trim().toUpperCase();
        attr.hcp = occp !== "" ? (HCP_REPORTERS.has(occp) ? 1.0 : 0.0) : null;
      }
      if (hasEventDate) {
        attr.event_date = parseFaersDate(row.event_dt);
      }
    }
  }

  const outc = context.outc;
  const hasOutc = hasCol(outc, "primaryid") && hasCol(outc, "outc_cod");
  if (outc && hasOutc) {
    for (const row of outc) {
      const pid = row.primaryid?.trim();
      const code = row.outc_cod?.trim().toUpperCase();
      if (!pid || !code) continue;
      const attr = ensure(pid);
      const d = code === "DE" ? 1.0 : 0.0;
      const h = code === "HO" || code === "LT" ? 1.0 : 0.0;
      const s = SERIOUS_OUTCOMES.has(code) ? 1.0 : 0.0;
      attr.death = Math.max(attr.death ?? 0.0, d);
      attr.hosp_lt = Math.max(attr.hosp_lt ?? 0.0, h);
      attr.serious = Math.max(attr.serious ?? 0.0, s);
    }
  }

  const drug = context.drug;
  const hasNDrugs = hasCol(drug, "primaryid") && hasCol(drug, "drugname");
  if (drug && hasNDrugs) {
    const byPid = new Map<string, Set<string>>();
    for (const row of drug) {
      const pid = row.primaryid?.trim();
      const name = row.drugname?.trim().toUpperCase();
      if (!pid || !name) continue;
      let set = byPid.get(pid);
      if (!set) {
        set = new Set();
        byPid.set(pid, set);
      }
      set.add(name);
    }
    for (const [pid, set] of byPid) {
      const attr = ensure(pid);
      attr.n_drugs = set.size;
    }
  }

  if (hasOutc) {
    for (const attr of cases.values()) {
      attr.death = attr.death ?? 0.0;
      attr.hosp_lt = attr.hosp_lt ?? 0.0;
      attr.serious = attr.serious ?? 0.0;
    }
  }

  return {
    cases,
    hasFemale,
    hasAge,
    hasHcp,
    hasEventDate,
    hasOutc,
    hasNDrugs,
  };
}

function buildTherapyStart(context: CaseContext): {
  perDrug: Map<string, number> | null;
  perCase: Map<string, number> | null;
} {
  const ther = context.ther;
  if (!ther || !hasCol(ther, "primaryid") || !hasCol(ther, "start_dt")) {
    return { perDrug: null, perCase: null };
  }
  const hasDrugSeq = hasCol(ther, "dsg_drug_seq");
  const perCase = new Map<string, number>();
  const perDrug = hasDrugSeq ? new Map<string, number>() : null;

  for (const row of ther) {
    const pid = row.primaryid?.trim();
    const start = parseFaersDate(row.start_dt);
    if (!pid || start === null) continue;
    const prevCase = perCase.get(pid);
    if (prevCase === undefined || start < prevCase) {
      perCase.set(pid, start);
    }
    if (perDrug) {
      const seq = row.dsg_drug_seq?.trim();
      if (seq) {
        const dKey = `${pid}|${seq}`;
        const prevDrug = perDrug.get(dKey);
        if (prevDrug === undefined || start < prevDrug) {
          perDrug.set(dKey, start);
        }
      }
    }
  }

  return { perDrug, perCase };
}

export function caseLevelFeatures(
  pairs: PairRow[],
  context: CaseContext = {},
  eventMapper?: (pt: string) => string,
): Map<string, FeatureMap> {
  const result = new Map<string, FeatureMap>();
  if (pairs.length === 0) return result;

  const hasRoleCod = pairs.some((p) => p.role_cod !== undefined);
  const hasPairDrugSeq = pairs.some((p) => p.drug_seq !== undefined);

  const {
    cases,
    hasFemale,
    hasAge,
    hasHcp,
    hasEventDate,
    hasOutc,
    hasNDrugs,
  } = buildCaseTable(context);

  const { perDrug, perCase } = buildTherapyStart(context);
  const hasTto = perCase !== null && hasEventDate;

  const indi = context.indi;
  const hasIndi = hasCol(indi, "primaryid") && hasCol(indi, "indi_pt");
  const indSet = new Set<string>();
  if (indi && hasIndi) {
    for (const row of indi) {
      const pid = row.primaryid?.trim();
      const rawPt = row.indi_pt?.trim().toUpperCase().split(/\s+/).join(" ");
      if (!pid || !rawPt) continue;
      const pt = eventMapper ? eventMapper(rawPt) : rawPt;
      indSet.add(`${pid}|${pt}`);
    }
  }

  type PairAccum = {
    death: number[];
    hosp_lt: number[];
    serious: number[];
    hcp: number[];
    female: number[];
    age_years: number[];
    tto: number[];
    tto_30d: number[];
    n_drugs: number[];
    primary: number[];
    event_is_indication: number[];
  };

  const groups = new Map<string, PairAccum>();

  for (const p of pairs) {
    const pid = p.primaryid.trim();
    const key = `${p.drugname}|${p.pt}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        death: [],
        hosp_lt: [],
        serious: [],
        hcp: [],
        female: [],
        age_years: [],
        tto: [],
        tto_30d: [],
        n_drugs: [],
        primary: [],
        event_is_indication: [],
      };
      groups.set(key, acc);
    }

    const attr = cases.get(pid);

    if (hasOutc && attr) {
      if (attr.death != null) acc.death.push(attr.death);
      if (attr.hosp_lt != null) acc.hosp_lt.push(attr.hosp_lt);
      if (attr.serious != null) acc.serious.push(attr.serious);
    }
    if (hasHcp && attr?.hcp != null) {
      acc.hcp.push(attr.hcp);
    }
    if (hasFemale && attr?.female != null) {
      acc.female.push(attr.female);
    }
    if (hasAge && attr?.age_years != null) {
      acc.age_years.push(attr.age_years);
    }
    if (hasNDrugs && attr?.n_drugs != null) {
      acc.n_drugs.push(attr.n_drugs);
    }

    if (hasTto && attr?.event_date != null) {
      const startCase = perCase!.get(pid);
      let start = startCase;
      if (perDrug && hasPairDrugSeq && p.drug_seq) {
        const startDrug = perDrug.get(`${pid}|${p.drug_seq.trim()}`);
        if (startDrug !== undefined) {
          start = startDrug;
        }
      }
      if (start !== undefined) {
        const days = Math.round((attr.event_date - start) / 86_400_000);
        if (days >= 0 && days <= MAX_TTO_DAYS) {
          acc.tto.push(days);
          acc.tto_30d.push(days <= 30 ? 1.0 : 0.0);
        }
      }
    }

    if (hasRoleCod) {
      const role = (p.role_cod ?? "").trim().toUpperCase();
      if (role !== "") {
        acc.primary.push(role === "PS" ? 1.0 : 0.0);
      }
    }

    if (hasIndi) {
      acc.event_is_indication.push(indSet.has(`${pid}|${p.pt}`) ? 1.0 : 0.0);
    }
  }

  const meanOf = (arr: number[], enabled: boolean): number | null => {
    if (!enabled || arr.length === 0) return null;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  };

  const medianOf = (arr: number[]): number | null => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  };

  for (const [key, acc] of groups) {
    const meanDrugs = meanOf(acc.n_drugs, hasNDrugs);
    const medTto = hasTto ? medianOf(acc.tto) : null;
    result.set(key, {
      frac_death: meanOf(acc.death, hasOutc),
      frac_hosp_lt: meanOf(acc.hosp_lt, hasOutc),
      frac_serious: meanOf(acc.serious, hasOutc),
      frac_hcp: meanOf(acc.hcp, hasHcp),
      frac_female: meanOf(acc.female, hasFemale),
      mean_age: meanOf(acc.age_years, hasAge),
      log_median_tto: medTto !== null ? Math.log1p(medTto) : null,
      frac_tto_30d: meanOf(acc.tto_30d, hasTto),
      log_mean_drugs: meanDrugs !== null && meanDrugs > 0 ? Math.log(meanDrugs) : null,
      frac_primary_suspect: meanOf(acc.primary, hasRoleCod),
      frac_event_is_indication: meanOf(acc.event_is_indication, hasIndi),
    });
  }

  return result;
}

export function buildFeatureFrame(
  signals: SignalRow[],
  caseFeatures?: Map<string, FeatureMap>,
): FeatureMap[] {
  return signals.map((s) => {
    const disp = disproportionalityFeatures(s);
    const c = caseFeatures?.get(`${s.drug}|${s.adverse_event}`);
    const row: FeatureMap = { ...disp };
    for (const name of FEATURE_GROUPS.case) {
      const val = c?.[name];
      row[name] = val !== undefined && val !== null && !Number.isNaN(val) ? val : null;
    }
    return row;
  });
}

export function computeFeatureAvailability(frames: FeatureMap[]): Record<string, number> {
  const n = frames.length;
  const out: Record<string, number> = {};
  for (const name of ALL_FEATURES) {
    if (n === 0) {
      out[name] = 0;
      continue;
    }
    let present = 0;
    for (const row of frames) {
      if (row[name] !== null && row[name] !== undefined && !Number.isNaN(row[name]!)) {
        present++;
      }
    }
    out[name] = Math.round((present / n) * 10000) / 10000;
  }
  return out;
}

export function contextFromTables(
  demo: FaersRow[],
  drug: FaersRow[],
  optional?: OptionalTables,
): CaseContext {
  return {
    demo,
    drug,
    outc: optional?.outc,
    indi: optional?.indi,
    ther: optional?.ther,
  };
}
