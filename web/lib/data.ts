import siteBundle from "../public/data/site-bundle.json";
import type { SiteBundle } from "./types";

export const data = siteBundle as SiteBundle;

export function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits);
}
