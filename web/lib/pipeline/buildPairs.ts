import { canonicalizeDrug, normalizePt } from "./drugMap";
import type { FaersRow, PairRow } from "./types";

export function buildCaseLevelTable(
  demo: FaersRow[],
  drug: FaersRow[],
  reac: FaersRow[],
): PairRow[] {
  const valid = new Set(demo.map((r) => r.primaryid?.trim()).filter(Boolean));
  const eventByCase = new Map<string, string>();
  demo.forEach((r) => {
    if (r.primaryid && r.event_dt) eventByCase.set(r.primaryid.trim(), r.event_dt.trim());
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
    if (d.role_cod) {
      const role = d.role_cod.trim().toUpperCase();
      if (role && !["PS", "SS"].includes(role)) continue;
    }
    const drugname = canonicalizeDrug(rawName);
    if (!drugname) continue;
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
      });
    }
  }
  return pairs;
}

export function uniqueCases(pairs: PairRow[]): number {
  return new Set(pairs.map((p) => p.primaryid)).size;
}
