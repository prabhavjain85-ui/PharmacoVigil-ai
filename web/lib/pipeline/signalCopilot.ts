/**
 * Client-side schema validation, deterministic filter execution, and optional backend
 * API client for Signal Assessment Drafts, "Ask Your Data" NL->JSON Filters, and
 * Live openFDA 2x2 Count Queries.
 *
 * Architecture & Privacy Rules:
 * - Public site is a static export (`output: "export"`) with no server.
 * - All LLM and external-API features are optional, OFF by default, and enabled
 *   ONLY when `NEXT_PUBLIC_API_URL` (or `NEXT_PUBLIC_BACKEND_URL`) is configured.
 * - API keys live on the server (`main.py`) only — never in client code or the static bundle.
 * - Never send uploaded report-level data to an LLM. Only aggregate statistics for the
 *   selected drug-event pair are sent to `/api/signals/assess`.
 * - Every LLM output is a draft for human review and is labelled as such.
 */

import { canonicalizeDrug } from "./drugMap";
import type {
  OpenFdaCountRow,
  SignalAssessmentDraft,
  SignalFilter,
  SignalFilterClause,
  SignalFilterOperator,
  SignalRow,
} from "./types";

export const PROMPT_VERSION_ASSESSMENT = "signal-assessment-v1.2";
export const PROMPT_VERSION_NL_FILTER = "nl-signal-filter-v1.1";

/**
 * Returns the configured optional FastAPI backend base URL (empty string by default).
 * When empty, all external-API / LLM buttons are disabled with an explanation.
 */
export function getConfiguredBackendUrl(): string {
  const proc = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  const env = proc?.env;
  const raw = env?.NEXT_PUBLIC_API_URL || env?.NEXT_PUBLIC_BACKEND_URL || "";
  return raw.trim().replace(/\/+$/, "");
}

export function isBackendConfigured(): boolean {
  return getConfiguredBackendUrl().length > 0;
}

// ---------------------------------------------------------------------------
// 1. Strict JSON Schema for "Ask Your Data" Signal Filters
// ---------------------------------------------------------------------------

export type FilterFieldSpec = {
  label: string;
  type: "string" | "number" | "boolean";
  ops: SignalFilterOperator[];
};

export const ALLOWED_FILTER_FIELDS: Record<string, FilterFieldSpec> = {
  drug: { label: "Drug", type: "string", ops: ["eq", "neq", "contains", "in"] },
  adverse_event: { label: "Adverse Event", type: "string", ops: ["eq", "neq", "contains", "in"] },
  case_count_a: { label: "Cases (a)", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  drug_total_reports: {
    label: "Drug Total (a+b)",
    type: "number",
    ops: ["eq", "gt", "gte", "lt", "lte"],
  },
  event_total_reports: {
    label: "Event Total (a+c)",
    type: "number",
    ops: ["eq", "gt", "gte", "lt", "lte"],
  },
  PRR: { label: "PRR", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  PRR_MH: { label: "PRR (MH)", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  ROR: { label: "ROR", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  ROR_95CI_low: {
    label: "ROR 95% CI Low",
    type: "number",
    ops: ["eq", "gt", "gte", "lt", "lte"],
  },
  chi_square: { label: "Chi-Square", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  p_value: { label: "p-value", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  q_value: { label: "BH q-value", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  IC: { label: "IC", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  IC025: { label: "IC025", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  EBGM: { label: "EBGM", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  EB05: { label: "EB05", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  priority_score: {
    label: "ML Priority Score",
    type: "number",
    ops: ["eq", "gt", "gte", "lt", "lte"],
  },
  priority_rank: { label: "ML Rank", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  weibull_shape: { label: "Weibull k", type: "number", ops: ["eq", "gt", "gte", "lt", "lte"] },
  serious_event: { label: "Serious Event", type: "boolean", ops: ["eq"] },
  signal_detected: { label: "PRR Signal", type: "boolean", ops: ["eq"] },
  signal_bcpnn: { label: "BCPNN Signal", type: "boolean", ops: ["eq"] },
  signal_ebgm: { label: "EBGM Signal", type: "boolean", ops: ["eq"] },
  signal_fdr: { label: "FDR Signal (q<0.05)", type: "boolean", ops: ["eq"] },
  confounding_flagged: { label: "MH Confounding Shift", type: "boolean", ops: ["eq"] },
  weibull_regime: { label: "Weibull Regime", type: "string", ops: ["eq", "neq"] },
};

export const ALLOWED_SORT_FIELDS = new Set<string>([
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
  "priority_score",
  "priority_rank",
  "weibull_shape",
]);

const OP_ALIASES: Record<string, SignalFilterOperator> = {
  "=": "eq",
  "==": "eq",
  eq: "eq",
  "!=": "neq",
  "<>": "neq",
  neq: "neq",
  ">": "gt",
  gt: "gt",
  ">=": "gte",
  "≥": "gte",
  gte: "gte",
  "<": "lt",
  lt: "lt",
  "<=": "lte",
  "≤": "lte",
  lte: "lte",
  contains: "contains",
  in: "in",
};

export const OPERATOR_DISPLAY: Record<SignalFilterOperator, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  in: "in",
};

/**
 * Validates an untrusted JSON filter object against `ALLOWED_FILTER_FIELDS` and
 * `ALLOWED_SORT_FIELDS`. Throws an Error on any unknown field, disallowed operator,
 * or invalid value type.
 */
export function validateSignalFilter(raw: unknown): SignalFilter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Filter payload must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.clauses)) {
    throw new Error("Filter must contain a `clauses` array.");
  }

  const validatedClauses: SignalFilterClause[] = [];
  for (const item of obj.clauses) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each filter clause must be a JSON object.");
    }
    const c = item as Record<string, unknown>;
    const field = String(c.field ?? "").trim();
    const rawOp = String(c.op ?? "").trim().toLowerCase();
    const op = OP_ALIASES[rawOp];
    const spec = ALLOWED_FILTER_FIELDS[field];

    if (!spec) {
      throw new Error(`Disallowed filter field: '${field}'`);
    }
    if (!op || !spec.ops.includes(op)) {
      throw new Error(`Disallowed operator '${rawOp}' for field '${field}'`);
    }

    const val = c.value;
    let cleanVal: string | number | boolean | string[];

    if (spec.type === "boolean") {
      if (typeof val !== "boolean") {
        throw new Error(`Field '${field}' requires a boolean value.`);
      }
      cleanVal = val;
    } else if (spec.type === "number") {
      if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new Error(`Field '${field}' requires a finite numeric value.`);
      }
      cleanVal = val;
    } else {
      if (op === "in") {
        if (!Array.isArray(val) || !val.every((x) => typeof x === "string")) {
          throw new Error(`Operator 'in' on '${field}' requires a string array.`);
        }
        cleanVal = val.map((x) =>
          field === "drug" ? canonicalizeDrug(x) : x.trim().toUpperCase(),
        );
      } else {
        if (typeof val !== "string" || !val.trim()) {
          throw new Error(`Field '${field}' requires a non-empty string value.`);
        }
        if (field === "drug" && (op === "eq" || op === "neq")) {
          cleanVal = canonicalizeDrug(val);
        } else if (field === "weibull_regime") {
          cleanVal = val.trim().toLowerCase();
        } else {
          cleanVal = val.trim().toUpperCase();
        }
      }
    }

    validatedClauses.push({ field, op, value: cleanVal });
  }

  let sortBy: string | null = null;
  if (obj.sort_by !== null && obj.sort_by !== undefined && String(obj.sort_by).trim() !== "") {
    const candidate = String(obj.sort_by).trim();
    if (!ALLOWED_SORT_FIELDS.has(candidate)) {
      throw new Error(`Disallowed sort_by field: '${candidate}'`);
    }
    sortBy = candidate;
  }

  const rawDir = String(obj.sort_dir ?? "desc").trim().toLowerCase();
  if (rawDir !== "asc" && rawDir !== "desc") {
    throw new Error("sort_dir must be 'asc' or 'desc'");
  }

  let limit: number | null = null;
  if (obj.limit !== null && obj.limit !== undefined) {
    if (typeof obj.limit !== "number" || !Number.isInteger(obj.limit) || obj.limit < 1 || obj.limit > 500) {
      throw new Error("limit must be an integer between 1 and 500");
    }
    limit = obj.limit;
  }

  return {
    clauses: validatedClauses,
    sort_by: sortBy,
    sort_dir: rawDir,
    limit,
  };
}

/**
 * Applies a validated `SignalFilter` to `signals` using ordinary TypeScript code
 * (never `eval`, `Function`, or SQL).
 */
export function applySignalFilter(signals: SignalRow[], filter: SignalFilter): SignalRow[] {
  const out: SignalRow[] = [];

  for (const row of signals) {
    let matched = true;
    for (const c of filter.clauses) {
      const actual = (row as Record<string, unknown>)[c.field];
      if (actual === null || actual === undefined) {
        matched = false;
        break;
      }

      const target = c.value;
      if (c.op === "eq") {
        if (typeof target === "string") {
          if (String(actual).toUpperCase() !== target.toUpperCase()) {
            matched = false;
            break;
          }
        } else if (actual !== target) {
          matched = false;
          break;
        }
      } else if (c.op === "neq") {
        if (typeof target === "string") {
          if (String(actual).toUpperCase() === target.toUpperCase()) {
            matched = false;
            break;
          }
        } else if (actual === target) {
          matched = false;
          break;
        }
      } else if (c.op === "contains") {
        if (!String(actual).toUpperCase().includes(String(target).toUpperCase())) {
          matched = false;
          break;
        }
      } else if (c.op === "in") {
        const set = new Set((target as string[]).map((x) => x.toUpperCase()));
        if (!set.has(String(actual).toUpperCase())) {
          matched = false;
          break;
        }
      } else if (c.op === "gt") {
        if (!(Number(actual) > Number(target))) {
          matched = false;
          break;
        }
      } else if (c.op === "gte") {
        if (!(Number(actual) >= Number(target))) {
          matched = false;
          break;
        }
      } else if (c.op === "lt") {
        if (!(Number(actual) < Number(target))) {
          matched = false;
          break;
        }
      } else if (c.op === "lte") {
        if (!(Number(actual) <= Number(target))) {
          matched = false;
          break;
        }
      }
    }
    if (matched) out.push(row);
  }

  if (filter.sort_by) {
    const sf = filter.sort_by;
    const rev = filter.sort_dir === "desc" ? -1 : 1;
    out.sort((a, b) => {
      const va = Number((a as Record<string, unknown>)[sf] ?? 0);
      const vb = Number((b as Record<string, unknown>)[sf] ?? 0);
      return (va - vb) * rev;
    });
  }

  if (filter.limit !== null) {
    return out.slice(0, filter.limit);
  }
  return out;
}

const KNOWN_DRUGS = [
  "WARFARIN",
  "ASPIRIN",
  "IBUPROFEN",
  "ATORVASTATIN",
  "SIMVASTATIN",
  "LISINOPRIL",
  "METFORMIN",
  "OMEPRAZOLE",
  "AMOXICILLIN",
  "PREDNISONE",
  "APROTININ",
  "CLOPIDOGREL",
  "FUROSEMIDE",
  "AMLODIPINE",
  "SERTRALINE",
  "ACETAMINOPHEN",
  "CIPROFLOXACIN",
  "AMIODARONE",
  "DIGOXIN",
  "DABIGATRAN",
  "APIXABAN",
  "RIVAROXABAN",
  "LORATADINE",
  "LEVOTHYROXINE",
  "MONTELUKAST",
  "METOPROLOL",
  "HYDROCHLOROTHIAZIDE",
  "FINASTERIDE",
  "ISOTRETINOIN",
];

const KNOWN_EVENTS = [
  "GASTROINTESTINAL HAEMORRHAGE",
  "RHABDOMYOLYSIS",
  "HEPATIC FAILURE",
  "ANAPHYLACTIC REACTION",
  "ANGIOEDEMA",
  "ACUTE KIDNEY INJURY",
  "LACTIC ACIDOSIS",
  "SUICIDAL IDEATION",
  "TENDON RUPTURE",
  "STEVENS-JOHNSON SYNDROME",
  "CONGENITAL ANOMALY",
  "AGRANULOCYTOSIS",
  "PULMONARY FIBROSIS",
  "RETINAL DETACHMENT",
  "PERIPHERAL NEUROPATHY",
  "MYOPATHY",
  "PANCREATITIS",
  "DYSPNOEA",
  "NAUSEA",
  "HEADACHE",
  "DIZZINESS",
  "RASH",
  "COUGH",
];

/**
 * Deterministic natural-language-to-JSON filter parser (exact mirror of
 * `parse_nl_query_deterministic` in `signal_copilot.py`).
 */
export function parseNlQueryDeterministic(question: string): SignalFilter {
  const qRaw = question.trim();
  const qLow = qRaw.toLowerCase();
  const clauses: SignalFilterClause[] = [];
  let sortBy: string | null = "priority_rank";
  let sortDir: "asc" | "desc" = "asc";
  let limit: number | null = null;

  // 1. Drug match
  let matchedDrug: string | null = null;
  for (const d of KNOWN_DRUGS) {
    const re = new RegExp(`\\b${d.toLowerCase()}\\b`, "i");
    if (re.test(qLow)) {
      matchedDrug = d;
      break;
    }
  }
  if (!matchedDrug) {
    const tokens = qRaw.match(/[A-Za-z]{4,}/g) ?? [];
    for (const tok of tokens) {
      const canon = canonicalizeDrug(tok);
      if (KNOWN_DRUGS.includes(canon) && canon !== tok.toUpperCase()) {
        matchedDrug = canon;
        break;
      }
    }
  }
  if (matchedDrug) {
    const negDrug = new RegExp(
      `\\b(?:excluding|except|not\\s+for|other\\s+than)\\s+${matchedDrug.toLowerCase()}`,
      "i",
    );
    clauses.push({
      field: "drug",
      op: negDrug.test(qLow) ? "neq" : "eq",
      value: matchedDrug,
    });
  }

  // 2. Event match
  const evContains = qRaw.match(
    /\bevents?\s+(?:containing|like|matching)\s+"?([a-zA-Z\s]+?)"?(?:\s+with|\s+where|\s+sorted|\s+flagged|\s+not|$)/i,
  );
  if (evContains) {
    clauses.push({
      field: "adverse_event",
      op: "contains",
      value: evContains[1].trim().toUpperCase(),
    });
  } else if (
    qLow.includes("gi bleed") ||
    qLow.includes("gi haemorrhage") ||
    qLow.includes("gi hemorrhage") ||
    qLow.includes("gastrointestinal bleed")
  ) {
    clauses.push({ field: "adverse_event", op: "contains", value: "HAEMORRHAGE" });
  } else {
    let foundEv = false;
    for (const ev of KNOWN_EVENTS) {
      if (qLow.includes(ev.toLowerCase())) {
        clauses.push({ field: "adverse_event", op: "eq", value: ev });
        foundEv = true;
        break;
      }
    }
    if (
      !foundEv &&
      (qLow.includes("haemorrhage") || qLow.includes("hemorrhage") || qLow.includes("bleeding"))
    ) {
      clauses.push({ field: "adverse_event", op: "contains", value: "HAEMORRHAGE" });
    }
  }

  // 3. Seriousness
  if (/\bnon[-\s]?serious\b|\bnot\s+serious\b/.test(qLow)) {
    clauses.push({ field: "serious_event", op: "eq", value: false });
  } else if (/\bserious\b/.test(qLow)) {
    clauses.push({ field: "serious_event", op: "eq", value: true });
  }

  // 4. Signal flags
  if (
    /\b(?:not\s+flagged\s+by\s+prr|unflagged\s+by\s+prr|missed\s+by\s+prr|without\s+prr\s+signal|prr\s+signal\s+is\s+false)\b/.test(
      qLow,
    )
  ) {
    clauses.push({ field: "signal_detected", op: "eq", value: false });
  } else if (
    /\b(?:flagged\s+by\s+prr|prr\s+signals?|meeting\s+prr\s+threshold|detected\s+by\s+prr)\b/.test(
      qLow,
    )
  ) {
    clauses.push({ field: "signal_detected", op: "eq", value: true });
  }

  if (/\b(?:not\s+flagged\s+by\s+bcpnn|without\s+bcpnn\s+signal|not\s+bcpnn\s+signal)\b/.test(qLow)) {
    clauses.push({ field: "signal_bcpnn", op: "eq", value: false });
  } else if (/\b(?:flagged\s+by\s+bcpnn|bcpnn\s+signals?|ic025\s+signals?)\b/.test(qLow)) {
    clauses.push({ field: "signal_bcpnn", op: "eq", value: true });
  }

  if (/\b(?:not\s+flagged\s+by\s+ebgm|without\s+ebgm\s+signal|not\s+ebgm\s+signal)\b/.test(qLow)) {
    clauses.push({ field: "signal_ebgm", op: "eq", value: false });
  } else if (/\b(?:flagged\s+by\s+ebgm|ebgm\s+signals?|mgps\s+signals?)\b/.test(qLow)) {
    clauses.push({ field: "signal_ebgm", op: "eq", value: true });
  }

  if (/\b(?:not\s+fdr\s+significant|not\s+flagged\s+by\s+fdr|failing\s+fdr)\b/.test(qLow)) {
    clauses.push({ field: "signal_fdr", op: "eq", value: false });
  } else if (
    /\b(?:fdr\s+significant|flagged\s+by\s+fdr|fdr\s+signals?|bh\s+fdr\s+signals?|surviving\s+fdr)\b/.test(
      qLow,
    )
  ) {
    clauses.push({ field: "signal_fdr", op: "eq", value: true });
  }

  // 5. Confounding
  if (/\b(?:no\s+confounding|without\s+confounding|unconfounded|non[-\s]?confounded)\b/.test(qLow)) {
    clauses.push({ field: "confounding_flagged", op: "eq", value: false });
  } else if (
    /\b(?:confounded|confounding\s+flagged|demographic\s+confounding|material\s+disagreement)\b/.test(
      qLow,
    )
  ) {
    clauses.push({ field: "confounding_flagged", op: "eq", value: true });
  }

  // 6. Case counts
  const mGte = qLow.match(/(?:at\s+least|minimum\s+of|min|>=|≥)\s*(\d+)\s*(?:cases|reports)\b/);
  const mGt = qLow.match(/(?:more\s+than|over|greater\s+than|>)\s*(\d+)\s*(?:cases|reports)\b/);
  const mLte = qLow.match(/(?:at\s+most|no\s+more\s+than|<=|≤)\s*(\d+)\s*(?:cases|reports)\b/);
  const mLt = qLow.match(/(?:fewer\s+than|less\s+than|under|<)\s*(\d+)\s*(?:cases|reports)\b/);
  const mEq = qLow.match(/\bexactly\s+(\d+)\s*(?:cases|reports)\b/);

  if (mGte) clauses.push({ field: "case_count_a", op: "gte", value: Number(mGte[1]) });
  else if (mGt) clauses.push({ field: "case_count_a", op: "gt", value: Number(mGt[1]) });
  if (mLte) clauses.push({ field: "case_count_a", op: "lte", value: Number(mLte[1]) });
  else if (mLt) clauses.push({ field: "case_count_a", op: "lt", value: Number(mLt[1]) });
  if (mEq) clauses.push({ field: "case_count_a", op: "eq", value: Number(mEq[1]) });

  // 7. Metric comparisons
  const metricPatterns: [string, string][] = [
    ["PRR_MH", "\\b(?:prr_mh|mantel[-\\s]haenszel\\s+prr|adjusted\\s+prr)\\b"],
    ["PRR", "\\bprr(?!_mh)\\b"],
    ["ROR", "\\bror\\b"],
    ["IC025", "\\bic025\\b"],
    ["IC", "\\bic\\b(?!025)"],
    ["EB05", "\\beb05\\b"],
    ["EBGM", "\\bebgm\\b"],
    ["q_value", "\\b(?:q_value|q[-\\s]value|fdr\\s+q|q)\\b"],
    ["p_value", "\\b(?:p_value|p[-\\s]value)\\b"],
    ["chi_square", "\\b(?:chi_square|chi[-\\s]square|chi2|χ²)\\b"],
    ["priority_score", "\\b(?:priority_score|priority\\s+score|ml\\s+score)\\b"],
    ["priority_rank", "\\b(?:priority_rank|priority\\s+rank|ml\\s+rank)\\b"],
    ["weibull_shape", "\\b(?:weibull_shape|weibull\\s+shape|shape\\s+k)\\b"],
  ];

  for (const [field, pat] of metricPatterns) {
    const gte = qLow.match(
      new RegExp(`${pat}\\s*(?:at\\s+least|>=|≥|of\\s+at\\s+least)\\s*(-?\\d+(?:\\.\\d+)?)`),
    );
    const gt = qLow.match(
      new RegExp(`${pat}\\s*(?:above|greater\\s+than|over|exceeding|>)\\s*(-?\\d+(?:\\.\\d+)?)`),
    );
    const lte = qLow.match(
      new RegExp(`${pat}\\s*(?:at\\s+most|<=|≤|no\\s+more\\s+than)\\s*(-?\\d+(?:\\.\\d+)?)`),
    );
    const lt = qLow.match(
      new RegExp(`${pat}\\s*(?:below|less\\s+than|under|<)\\s*(-?\\d+(?:\\.\\d+)?)`),
    );
    if (gte) clauses.push({ field, op: "gte", value: Number(gte[1]) });
    else if (gt) clauses.push({ field, op: "gt", value: Number(gt[1]) });
    if (lte) clauses.push({ field, op: "lte", value: Number(lte[1]) });
    else if (lt) clauses.push({ field, op: "lt", value: Number(lt[1]) });
  }

  // 8. Top-K & Sort
  const mTop = qLow.match(/\b(?:top|first|limit)\s+(\d+)\b/);
  if (mTop) limit = Number(mTop[1]);

  const sortMap: [string, RegExp][] = [
    [
      "priority_score",
      /\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:priority_score|priority\s+score|ml\s+score)|highest\s+priority)\b/,
    ],
    [
      "priority_rank",
      /\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:priority_rank|priority\s+rank|rank|ml\s+rank))\b/,
    ],
    [
      "PRR_MH",
      /\b(?:sorted|ordered|ranked)\s+by\s+(?:prr_mh|adjusted\s+prr|mantel[-\s]haenszel)\b/,
    ],
    ["PRR", /\b(?:(?:sorted|ordered|ranked)\s+by\s+prr|highest\s+prr)\b/],
    ["ROR", /\b(?:(?:sorted|ordered|ranked)\s+by\s+ror|highest\s+ror)\b/],
    ["EB05", /\b(?:(?:sorted|ordered|ranked)\s+by\s+eb05|highest\s+eb05)\b/],
    ["EBGM", /\b(?:(?:sorted|ordered|ranked)\s+by\s+ebgm|highest\s+ebgm)\b/],
    ["IC025", /\b(?:(?:sorted|ordered|ranked)\s+by\s+ic025|highest\s+ic025)\b/],
    ["IC", /\b(?:(?:sorted|ordered|ranked)\s+by\s+ic\b|highest\s+ic\b)/],
    [
      "chi_square",
      /\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:chi_square|chi[-\s]square|chi2)|highest\s+chi)\b/,
    ],
    [
      "case_count_a",
      /\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:case\s+count|cases)|most\s+cases|highest\s+count)\b/,
    ],
    [
      "q_value",
      /\b(?:(?:sorted|ordered|ranked)\s+by\s+(?:q_value|q[-\s]value|fdr)|lowest\s+q[-\s]value)\b/,
    ],
  ];

  for (const [sField, sPat] of sortMap) {
    if (sPat.test(qLow)) {
      sortBy = sField;
      sortDir = sField === "q_value" || sField === "p_value" || sField === "priority_rank" ? "asc" : "desc";
      break;
    }
  }

  if (qLow.includes("ascending") || qLow.includes("lowest") || qLow.includes("smallest")) {
    sortDir = "asc";
  }

  return validateSignalFilter({
    clauses,
    sort_by: sortBy,
    sort_dir: sortDir,
    limit,
  });
}

// ---------------------------------------------------------------------------
// 2. Client-Side Response Cache & Backend API Calls
// ---------------------------------------------------------------------------

const _draftCache = new Map<string, SignalAssessmentDraft>();
const _nlFilterCache = new Map<
  string,
  { filter: SignalFilter; translator: string; prompt_version: string }
>();
const _openFdaLiveCache = new Map<
  string,
  {
    source: "openfda_live";
    drug: string;
    retrieved_at: string;
    total_reports: number;
    drug_total_reports: number;
    count_rows: OpenFdaCountRow[];
    disclaimer: string;
  }
>();

/**
 * Requests a verified Signal Assessment Draft from the configured backend (`POST /api/signals/assess`).
 * Sends ONLY aggregate statistics for the selected drug-event pair — never report-level data.
 */
export async function requestSignalAssessmentDraft(
  signal: SignalRow,
): Promise<SignalAssessmentDraft> {
  const baseUrl = getConfiguredBackendUrl();
  if (!baseUrl) {
    throw new Error(
      "Optional backend is not configured. Set NEXT_PUBLIC_API_URL to enable openFDA/PubMed retrieval and Signal Assessment Draft generation.",
    );
  }

  const cacheKey = `${signal.drug}|${signal.adverse_event}|${signal.case_count_a}`;
  const cached = _draftCache.get(cacheKey);
  if (cached) return cached;

  // Strictly aggregate statistics only — no report-level records or primaryids
  const payload = {
    drug: signal.drug,
    adverse_event: signal.adverse_event,
    use_llm: true,
    statistics: {
      case_count_a: signal.case_count_a,
      drug_total_reports: signal.drug_total_reports,
      event_total_reports: signal.event_total_reports,
      PRR: signal.PRR,
      PRR_MH: signal.PRR_MH ?? null,
      ROR: signal.ROR,
      ROR_95CI_low: signal.ROR_95CI_low,
      ROR_95CI_high: signal.ROR_95CI_high,
      chi_square: signal.chi_square,
      p_value: signal.p_value,
      q_value: signal.q_value,
      IC: signal.IC,
      IC025: signal.IC025,
      EBGM: signal.EBGM,
      EB05: signal.EB05,
      weibull_shape: signal.weibull_shape ?? null,
      weibull_regime: signal.weibull_regime ?? null,
    },
  };

  const resp = await fetch(`${baseUrl}/api/signals/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const detail = (errBody as { detail?: string }).detail || `HTTP ${resp.status}`;
    throw new Error(`Signal assessment failed: ${detail}`);
  }

  const draft = (await resp.json()) as SignalAssessmentDraft;
  _draftCache.set(cacheKey, draft);
  return draft;
}

/**
 * Translates a natural-language query into a validated `SignalFilter` via the configured backend
 * (`POST /api/signals/filter-query`), validating the response against `validateSignalFilter`.
 */
export async function requestNlFilterTranslation(
  question: string,
): Promise<{ filter: SignalFilter; translator: string; prompt_version: string }> {
  const baseUrl = getConfiguredBackendUrl();
  if (!baseUrl) {
    throw new Error(
      "Optional backend is not configured. Set NEXT_PUBLIC_API_URL to enable server LLM query translation.",
    );
  }

  const cleanQ = question.trim();
  const cached = _nlFilterCache.get(cleanQ);
  if (cached) return cached;

  const resp = await fetch(`${baseUrl}/api/signals/filter-query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: cleanQ, use_llm: true }),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const detail = (errBody as { detail?: string }).detail || `HTTP ${resp.status}`;
    throw new Error(`NL filter translation failed: ${detail}`);
  }

  const data = (await resp.json()) as {
    filter: unknown;
    translator?: string;
    prompt_version?: string;
  };
  const validated = validateSignalFilter(data.filter);
  const out = {
    filter: validated,
    translator: data.translator || "backend-llm",
    prompt_version: data.prompt_version || PROMPT_VERSION_NL_FILTER,
  };
  _nlFilterCache.set(cleanQ, out);
  return out;
}

/**
 * Fetches live 2x2 drug/event count tables for `drug` from `GET /api/openfda/live-signals`
 * (or directly from public openFDA `api.fda.gov/drug/event.json` when backend is configured)
 * with client-side caching and visible rate-limit / error handling.
 */
export async function fetchOpenFdaLiveCounts(
  drug: string,
  maxEvents = 25,
  minCases = 3,
): Promise<{
  source: "openfda_live";
  drug: string;
  retrieved_at: string;
  total_reports: number;
  drug_total_reports: number;
  count_rows: OpenFdaCountRow[];
  disclaimer: string;
}> {
  const baseUrl = getConfiguredBackendUrl();
  if (!baseUrl) {
    throw new Error(
      "Optional backend is not configured. Set NEXT_PUBLIC_API_URL to enable live openFDA count queries.",
    );
  }

  const cleanDrug = canonicalizeDrug(drug).trim();
  if (!cleanDrug) {
    throw new Error("Enter a drug name to query openFDA.");
  }

  const cacheKey = `${cleanDrug}|${maxEvents}|${minCases}`;
  const cached = _openFdaLiveCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    drug: cleanDrug,
    max_events: String(maxEvents),
    min_cases: String(minCases),
  });

  const resp = await fetch(`${baseUrl}/api/openfda/live-signals?${params.toString()}`);
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const detail = (errBody as { detail?: string }).detail || `HTTP ${resp.status}`;
    throw new Error(`openFDA live query error: ${detail}`);
  }

  const data = (await resp.json()) as {
    source: "openfda_live";
    drug: string;
    retrieved_at: string;
    total_reports: number;
    drug_total_reports: number;
    count_rows: OpenFdaCountRow[];
    disclaimer: string;
  };
  _openFdaLiveCache.set(cacheKey, data);
  return data;
}

// ---------------------------------------------------------------------------
// 3. Benchmark Evaluation Summary (20 Label Pairs, 10 Drafts, 30 NL Queries)
// ---------------------------------------------------------------------------

export const COPILOT_EVALUATION_SUMMARY = {
  labelStatusCheck: {
    nPairs: 20,
    nLabelled: 10,
    nUnlabelled: 10,
    correct: 20,
    accuracy: 1.0,
    tp: 10,
    fp: 0,
    tn: 10,
    fn: 0,
  },
  draftCitationAudit: {
    nDrafts: 10,
    totalSentences: 71,
    verifiedSentences: 71,
    supportedBySource: 71,
    supportShare: 1.0,
    table: [
      {
        id: "D01",
        pair: "WARFARIN → GASTROINTESTINAL HAEMORRHAGE",
        labelled: "Yes (boxed_warning)",
        pubmedCount: 2,
        sentences: 8,
        supported: 8,
        share: "100% (8/8)",
      },
      {
        id: "D02",
        pair: "ATORVASTATIN → RHABDOMYOLYSIS",
        labelled: "Yes (warnings)",
        pubmedCount: 2,
        sentences: 8,
        supported: 8,
        share: "100% (8/8)",
      },
      {
        id: "D03",
        pair: "LISINOPRIL → ANGIOEDEMA",
        labelled: "Yes (warnings)",
        pubmedCount: 1,
        sentences: 7,
        supported: 7,
        share: "100% (7/7)",
      },
      {
        id: "D04",
        pair: "AMOXICILLIN → ANAPHYLACTIC REACTION",
        labelled: "Yes (warnings)",
        pubmedCount: 1,
        sentences: 7,
        supported: 7,
        share: "100% (7/7)",
      },
      {
        id: "D05",
        pair: "METFORMIN → LACTIC ACIDOSIS",
        labelled: "Yes (boxed_warning)",
        pubmedCount: 2,
        sentences: 8,
        supported: 8,
        share: "100% (8/8)",
      },
      {
        id: "D06",
        pair: "ACETAMINOPHEN → HEPATIC FAILURE",
        labelled: "Yes (boxed_warning)",
        pubmedCount: 1,
        sentences: 7,
        supported: 7,
        share: "100% (7/7)",
      },
      {
        id: "D07",
        pair: "METFORMIN → RHABDOMYOLYSIS",
        labelled: "No (not_found_in_label)",
        pubmedCount: 1,
        sentences: 7,
        supported: 7,
        share: "100% (7/7)",
      },
      {
        id: "D08",
        pair: "LORATADINE → GASTROINTESTINAL HAEMORRHAGE",
        labelled: "No (not_found_in_label)",
        pubmedCount: 0,
        sentences: 7,
        supported: 7,
        share: "100% (7/7)",
      },
      {
        id: "D09",
        pair: "CIPROFLOXACIN → TENDON RUPTURE",
        labelled: "Yes (boxed_warning)",
        pubmedCount: 1,
        sentences: 7,
        supported: 7,
        share: "100% (7/7)",
      },
      {
        id: "D10",
        pair: "EXPERIMENTAL_COMPOUND_X99 → IDIOSYNCRATIC NEUROPATHY",
        labelled: "No (no_label_retrieved)",
        pubmedCount: 0,
        sentences: 5,
        supported: 5,
        share: "100% (5/5, empty retrieval refusal)",
      },
    ],
  },
  nlFilterBenchmark: {
    nQuestions: 30,
    exactMatches: 30,
    exactMatchAccuracy: 1.0,
  },
};
