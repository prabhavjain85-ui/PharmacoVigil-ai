import type { FaersRow } from "./types";

const SEPARATORS = [",", "$", "|", "\t"];

export function parseCsv(text: string): FaersRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  let headerLine = lines[0];
  let sep = ",";
  for (const s of SEPARATORS) {
    if (headerLine.includes(s) && headerLine.split(s).length > 1) {
      sep = s;
      break;
    }
  }
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const rows: FaersRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep);
    if (cols.length < headers.length) continue;
    const row: FaersRow = {};
    headers.forEach((h, j) => {
      row[h] = (cols[j] ?? "").trim();
    });
    rows.push(row);
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
