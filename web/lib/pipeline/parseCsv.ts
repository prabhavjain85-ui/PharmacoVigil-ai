import type { FaersRow } from "./types";

const SEPARATORS = [",", "$", "|", "\t"];

const INTERN_POOL = new Map<string, string>();
const MAX_INTERN_POOL_SIZE = 250_000;

export function clearCsvInternPool(): void {
  INTERN_POOL.clear();
}

function unpinStr(s: string): string {
  // V8 SlicedStrings (length >= 13) retain a reference to the entire raw file string.
  // Copying via Buffer.from unpins the multi-hundred-MB parent string so GC can free it.
  return s.length >= 12 ? Buffer.from(s).toString("utf8") : s;
}

function isLongDigits(s: string): boolean {
  if (s.length < 5) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function internStr(s: string): string {
  if (s.length === 0) return "";
  // Do not fill the intern pool with 7-8 digit primaryid/caseid/date strings
  if (isLongDigits(s)) {
    return unpinStr(s);
  }
  const existing = INTERN_POOL.get(s);
  if (existing !== undefined) return existing;
  const flat = unpinStr(s);
  if (INTERN_POOL.size < MAX_INTERN_POOL_SIZE) {
    INTERN_POOL.set(flat, flat);
  }
  return flat;
}

export function parseCsv(text: string, keepColumns?: string[]): FaersRow[] {
  const len = text.length;
  if (len === 0) return [];

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let headerLine = "";
  while (pos < len) {
    let nl = text.indexOf("\n", pos);
    if (nl === -1) nl = len;
    const rawLine =
      nl > pos && text.charCodeAt(nl - 1) === 13
        ? text.slice(pos, nl - 1)
        : text.slice(pos, nl);
    pos = nl + 1;
    if (rawLine.trim()) {
      headerLine = rawLine;
      break;
    }
  }
  if (!headerLine) return [];

  let sep = ",";
  for (const s of SEPARATORS) {
    if (headerLine.includes(s) && headerLine.split(s).length > 1) {
      sep = s;
      break;
    }
  }

  const headers = headerLine.split(sep).map((h) => h.trim().toLowerCase());
  const numHeaders = headers.length;
  const keepSet = keepColumns ? new Set(keepColumns.map((c) => c.toLowerCase())) : null;
  const activeIndices: number[] = [];
  const activeSlotByCol = new Int32Array(numHeaders).fill(-1);
  for (let j = 0; j < numHeaders; j++) {
    if (!keepSet || keepSet.has(headers[j])) {
      activeSlotByCol[j] = activeIndices.length;
      activeIndices.push(j);
    }
  }
  if (activeIndices.length === 0) return [];

  // Monomorphic object-literal factory so V8 uses compact in-object properties (no dictionary backing store)
  const factoryBody =
    "return {" +
    activeIndices.map((colIdx, slot) => `${JSON.stringify(headers[colIdx])}:v[${slot}]`).join(",") +
    "};";
  const makeRow = new Function("v", factoryBody) as (v: string[]) => FaersRow;
  const slotBuffer = new Array<string>(activeIndices.length).fill("");

  const rows: FaersRow[] = [];

  while (pos < len) {
    const lineStart = pos;
    let nl = text.indexOf("\n", lineStart);
    if (nl === -1) nl = len;
    const lineEnd = nl > lineStart && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
    pos = nl + 1;
    if (lineEnd <= lineStart) continue;

    if (!keepSet) {
      const line = text.slice(lineStart, lineEnd);
      if (!line.trim()) continue;
      const cols = line.split(sep);
      if (cols.length < numHeaders) continue;
      for (let s = 0; s < activeIndices.length; s++) {
        slotBuffer[s] = (cols[activeIndices[s]] ?? "").trim();
      }
      rows.push(makeRow(slotBuffer));
    } else {
      let colStart = lineStart;
      let colIdx = 0;
      while (colIdx < numHeaders) {
        let nextSep = text.indexOf(sep, colStart);
        if (nextSep === -1 || nextSep > lineEnd) {
          nextSep = lineEnd;
        }
        const slot = activeSlotByCol[colIdx];
        if (slot !== -1) {
          slotBuffer[slot] = internStr(text.slice(colStart, nextSep).trim());
        }
        colIdx++;
        if (nextSep === lineEnd) break;
        colStart = nextSep + 1;
      }
      if (colIdx < numHeaders) continue;
      rows.push(makeRow(slotBuffer));
    }
  }
  return rows;
}

export async function fetchCsv(url: string): Promise<FaersRow[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return parseCsv(await res.text());
}

export function requireColumns(rows: FaersRow[], cols: string[], table: string) {
  if (!rows.length) throw new Error(`${table} is empty`);
  const keys = new Set(Object.keys(rows[0]));
  const missing = cols.filter((c) => !keys.has(c));
  if (missing.length) throw new Error(`${table} missing columns: ${missing.join(", ")}`);
}
