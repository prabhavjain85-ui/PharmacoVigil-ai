import { canonicalizeDrug, normalizePt } from "./drugMap";
import type { FaersRow, PairRow, ProbableDuplicatePair } from "./types";

const AGE_UNIT_TO_YEARS: Record<string, number> = {
  YR: 1.0,
  DEC: 10.0,
  MON: 1 / 12,
  WK: 1 / 52.18,
  DY: 1 / 365.25,
  HR: 1 / 8766,
};

function hasColumn(rows: FaersRow[], col: string): boolean {
  if (rows.length === 0) return false;
  return Object.prototype.hasOwnProperty.call(rows[0], col);
}

/**
 * Reuses the FAERS case-version deduplication rule from `faers_loader.py`:
 * When DEMO has both `caseid` and `caseversion`, keep only the latest `caseversion`
 * per `caseid`, then deduplicate on `primaryid`.
 */
export function deduplicateDemoByCaseId(demo: FaersRow[]): {
  dedupedDemo: FaersRow[];
  supersededVersionsDropped: number;
} {
  if (demo.length === 0) {
    return { dedupedDemo: [], supersededVersionsDropped: 0 };
  }

  const before = demo.length;
  let working = demo.filter((r) => (r.primaryid ?? "").trim() !== "");

  if (hasColumn(demo, "caseid") && hasColumn(demo, "caseversion")) {
    const withMeta = working.map((row, idx) => {
      const caseid = (row.caseid ?? "").trim();
      const rawVer = Number((row.caseversion ?? "").trim());
      const version = Number.isFinite(rawVer) ? rawVer : 0;
      return { row, idx, caseid, version };
    });

    // Sort by (caseid, version, original index) and keep the last entry per non-empty caseid
    withMeta.sort((a, b) => {
      if (a.caseid !== b.caseid) return a.caseid.localeCompare(b.caseid);
      if (a.version !== b.version) return a.version - b.version;
      return a.idx - b.idx;
    });

    const latestByCase = new Map<string, { row: FaersRow; idx: number }>();
    const withoutCaseId: { row: FaersRow; idx: number }[] = [];
    for (const item of withMeta) {
      if (item.caseid) {
        latestByCase.set(item.caseid, { row: item.row, idx: item.idx });
      } else {
        withoutCaseId.push({ row: item.row, idx: item.idx });
      }
    }

    const combined = [...latestByCase.values(), ...withoutCaseId];
    combined.sort((a, b) => a.idx - b.idx);
    working = combined.map((c) => c.row);
  }

  // Deduplicate on primaryid preserving order
  const seenPid = new Set<string>();
  const dedupedDemo: FaersRow[] = [];
  for (const row of working) {
    const pid = (row.primaryid ?? "").trim();
    if (!pid || seenPid.has(pid)) continue;
    seenPid.add(pid);
    dedupedDemo.push(row);
  }

  return {
    dedupedDemo,
    supersededVersionsDropped: Math.max(0, before - dedupedDemo.length),
  };
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

function parseAgeYears(row: FaersRow): number | null {
  const raw = (row.age ?? "").trim();
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  const unit = (row.age_cod ?? "YR").trim().toUpperCase() || "YR";
  const mult = AGE_UNIT_TO_YEARS[unit] ?? 1.0;
  const yrs = num * mult;
  return yrs >= 0 && yrs <= 120 ? Math.round(yrs * 100) / 100 : null;
}

function getCountry(row: FaersRow): string {
  return (row.occr_country ?? row.reporter_country ?? row.country ?? "").trim().toUpperCase();
}

/**
 * Probable-duplicate detection across different `caseid`s.
 * Scores pairs of reports on suspect drugs, reactions, event_dt, age, sex, and country.
 * Does NOT remove them automatically; returns flagged pairs for review and optional toggle exclusion.
 */
export function detectProbableDuplicates(
  demo: FaersRow[],
  drug: FaersRow[],
  reac: FaersRow[],
  threshold = 0.72,
): {
  flaggedPairs: ProbableDuplicatePair[];
  flaggedSecondaryPrimaryIds: string[];
} {
  const { dedupedDemo } = deduplicateDemoByCaseId(demo);
  if (dedupedDemo.length < 2) {
    return { flaggedPairs: [], flaggedSecondaryPrimaryIds: [] };
  }

  const validPids = new Set(dedupedDemo.map((r) => r.primaryid.trim()));
  const drugsByPid = new Map<string, Set<string>>();
  const reacsByPid = new Map<string, Set<string>>();

  for (const d of drug) {
    const pid = (d.primaryid ?? "").trim();
    const rawName = (d.drugname ?? "").trim();
    if (!pid || !rawName || !validPids.has(pid)) continue;
    const role = (d.role_cod ?? "").trim().toUpperCase();
    if (role && !["PS", "SS"].includes(role)) continue;
    const canonical = canonicalizeDrug(rawName);
    if (!canonical) continue;
    if (!drugsByPid.has(pid)) drugsByPid.set(pid, new Set());
    drugsByPid.get(pid)!.add(canonical);
  }

  for (const r of reac) {
    const pid = (r.primaryid ?? "").trim();
    const pt = normalizePt(r.pt ?? "");
    if (!pid || !pt || !validPids.has(pid)) continue;
    if (!reacsByPid.has(pid)) reacsByPid.set(pid, new Set());
    reacsByPid.get(pid)!.add(pt);
  }

  type CaseProfile = {
    pid: string;
    caseid: string;
    eventDtStr: string;
    eventMs: number | null;
    ageStr: string;
    ageYrs: number | null;
    sex: string;
    country: string;
    drugs: string[];
    reacs: string[];
  };

  // Index cases by suspect drug so we only compare pairs sharing >= 1 suspect drug
  const profiles: CaseProfile[] = [];
  const byDrug = new Map<string, number[]>();

  for (const row of dedupedDemo) {
    const pid = row.primaryid.trim();
    const dSet = drugsByPid.get(pid);
    const rSet = reacsByPid.get(pid);
    if (!dSet || dSet.size === 0 || !rSet || rSet.size === 0) continue;

    const drugs = [...dSet].sort();
    const reacs = [...rSet].sort();
    const idx = profiles.length;
    profiles.push({
      pid,
      caseid: (row.caseid ?? pid).trim() || pid,
      eventDtStr: (row.event_dt ?? "").trim(),
      eventMs: parseFaersDateMs(row.event_dt),
      ageStr: (row.age ?? "").trim(),
      ageYrs: parseAgeYears(row),
      sex: (row.sex ?? "").trim().toUpperCase(),
      country: getCountry(row),
      drugs,
      reacs,
    });

    for (const dName of drugs) {
      let bucket = byDrug.get(dName);
      if (!bucket) {
        bucket = [];
        byDrug.set(dName, bucket);
      }
      if (bucket.length < 500) {
        bucket.push(idx);
      }
    }
  }

  const compared = new Set<string>();
  const flaggedPairs: ProbableDuplicatePair[] = [];

  for (const indices of byDrug.values()) {
    const len = indices.length;
    for (let i = 0; i < len; i++) {
      const a = profiles[indices[i]];
      for (let j = i + 1; j < len; j++) {
        const b = profiles[indices[j]];
        if (a.caseid === b.caseid) continue;
        const [first, second] = a.pid < b.pid ? [a, b] : [b, a];
        const pairKey = `${first.pid}|${second.pid}`;
        if (compared.has(pairKey)) continue;
        compared.add(pairKey);

        // Shared reactions check
        const sharedReactions = first.reacs.filter((pt) => second.reacs.includes(pt));
        if (sharedReactions.length === 0) continue;

        const sharedDrugs = first.drugs.filter((d) => second.drugs.includes(d));
        if (sharedDrugs.length === 0) continue;

        const unionDrugs = new Set([...first.drugs, ...second.drugs]).size;
        const unionReacs = new Set([...first.reacs, ...second.reacs]).size;
        const drugJaccard = sharedDrugs.length / unionDrugs;
        const reacJaccard = sharedReactions.length / unionReacs;

        const matchingFields: string[] = [];
        if (drugJaccard >= 0.5) matchingFields.push("suspect_drugs");
        if (reacJaccard >= 0.5) matchingFields.push("reactions");

        let dateScore = 0;
        if (first.eventDtStr && first.eventDtStr === second.eventDtStr) {
          dateScore = 1.0;
          matchingFields.push("event_dt");
        } else if (first.eventMs !== null && second.eventMs !== null) {
          const diffDays = Math.abs(first.eventMs - second.eventMs) / 86_400_000;
          if (diffDays <= 7) {
            dateScore = 0.7;
            matchingFields.push("event_dt (±7d)");
          } else if (diffDays <= 30) {
            dateScore = 0.3;
          }
        }

        let ageScore = 0;
        if (first.ageYrs !== null && second.ageYrs !== null) {
          const diffAge = Math.abs(first.ageYrs - second.ageYrs);
          if (diffAge === 0) {
            ageScore = 1.0;
            matchingFields.push("age");
          } else if (diffAge <= 2) {
            ageScore = 0.7;
            matchingFields.push("age (±2y)");
          }
        }

        let sexScore = 0;
        if (first.sex && (first.sex === "M" || first.sex === "F") && first.sex === second.sex) {
          sexScore = 1.0;
          matchingFields.push("sex");
        }

        let countryScore = 0;
        if (first.country && first.country === second.country) {
          countryScore = 1.0;
          matchingFields.push("country");
        }

        const totalScore =
          0.3 * drugJaccard +
          0.25 * reacJaccard +
          0.15 * dateScore +
          0.12 * ageScore +
          0.1 * sexScore +
          0.08 * countryScore;

        if (totalScore >= threshold) {
          flaggedPairs.push({
            primaryid_a: first.pid,
            primaryid_b: second.pid,
            caseid_a: first.caseid,
            caseid_b: second.caseid,
            score: Math.round(totalScore * 10000) / 10000,
            matching_fields: matchingFields,
            shared_drugs: sharedDrugs,
            shared_reactions: sharedReactions,
            event_dt_a: first.eventDtStr || undefined,
            event_dt_b: second.eventDtStr || undefined,
            age_a: first.ageStr || undefined,
            age_b: second.ageStr || undefined,
            sex_a: first.sex || undefined,
            sex_b: second.sex || undefined,
            country_a: first.country || undefined,
            country_b: second.country || undefined,
          });
        }
      }
    }
  }

  flaggedPairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.primaryid_a.localeCompare(b.primaryid_a) ||
      a.primaryid_b.localeCompare(b.primaryid_b),
  );

  const capped = flaggedPairs.slice(0, 200);
  const secondarySet = new Set<string>();
  for (const p of capped) {
    secondarySet.add(p.primaryid_b);
  }

  return {
    flaggedPairs: capped,
    flaggedSecondaryPrimaryIds: [...secondarySet].sort(),
  };
}

export function buildCaseLevelTable(
  demo: FaersRow[],
  drug: FaersRow[],
  reac: FaersRow[],
  excludePrimaryIds?: Set<string>,
): PairRow[] {
  const { dedupedDemo } = deduplicateDemoByCaseId(demo);
  const valid = new Set(
    dedupedDemo
      .map((r) => r.primaryid?.trim())
      .filter((pid): pid is string => Boolean(pid) && !excludePrimaryIds?.has(pid!)),
  );
  const eventByCase = new Map<string, string>();
  dedupedDemo.forEach((r) => {
    const pid = r.primaryid?.trim();
    if (pid && valid.has(pid) && r.event_dt) {
      eventByCase.set(pid, r.event_dt.trim());
    }
  });

  const pairs: PairRow[] = [];
  const seen = new Set<string>();

  const reacByCase = new Map<string, FaersRow[]>();
  for (const r of reac) {
    const pid = r.primaryid?.trim();
    if (!pid || !valid.has(pid)) continue;
    if (!reacByCase.has(pid)) reacByCase.set(pid, []);
    reacByCase.get(pid)!.push(r);
  }

  for (const d of drug) {
    const pid = d.primaryid?.trim();
    const rawName = d.drugname?.trim();
    if (!pid || !rawName || !valid.has(pid)) continue;
    const roleRaw = d.role_cod?.trim();
    if (roleRaw) {
      const role = roleRaw.toUpperCase();
      if (role && !["PS", "SS"].includes(role)) continue;
    }
    const drugname = canonicalizeDrug(rawName);
    if (!drugname) continue;
    const drugSeq = d.drug_seq?.trim();
    const reactions = reacByCase.get(pid) ?? [];
    for (const r of reactions) {
      const pt = normalizePt(r.pt ?? "");
      if (!pt) continue;
      const key = `${pid}|${drugname}|${pt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        primaryid: pid,
        drugname,
        pt,
        event_dt: eventByCase.get(pid),
        role_cod: roleRaw,
        drug_seq: drugSeq,
      });
    }
  }
  return pairs;
}

export function uniqueCases(pairs: PairRow[]): number {
  return new Set(pairs.map((p) => p.primaryid)).size;
}
