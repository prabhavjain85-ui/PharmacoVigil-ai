"use client";

import { useMemo, useState } from "react";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";
import { useData } from "@/lib/context/DataContext";
import { computeDrugInteractions } from "@/lib/pipeline/analyze";
import type { InteractionSignalRow } from "@/lib/pipeline/types";

export function InteractionsView() {
  const { analysis } = useData();
  const [query, setQuery] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [minCoCases, setMinCoCases] = useState(2);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const interactions = useMemo(() => {
    if (!analysis) return [];
    const total = analysis.meta.case_count;
    return computeDrugInteractions(analysis.pairs, total, minCoCases, 200);
  }, [analysis, minCoCases]);

  const filtered = useMemo(() => {
    let list = interactions;
    if (onlyFlagged) {
      list = list.filter((r) => r.signal_omega);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.drug_a.toLowerCase().includes(q) ||
          r.drug_b.toLowerCase().includes(q) ||
          r.adverse_event.toLowerCase().includes(q),
      );
    }
    return list;
  }, [interactions, onlyFlagged, query]);

  const selected: InteractionSignalRow | null = useMemo(() => {
    if (filtered.length === 0) return null;
    if (selectedKey) {
      const found = filtered.find(
        (r) => `${r.drug_a}|${r.drug_b}|${r.adverse_event}` === selectedKey,
      );
      if (found) return found;
    }
    return filtered[0];
  }, [filtered, selectedKey]);

  if (!analysis) return null;

  const flaggedCount = interactions.filter((r) => r.signal_omega).length;

  return (
    <div>
      <PageHeader
        title="Drug–drug interaction signals (Ω shrinkage)"
        hint="Screens triplets (Drug A, Drug B, Adverse Event) using the Norén et al. (2008) Omega (Ω) shrinkage measure against an additive baseline risk model. Flagged when the 95% lower credibility bound Ω025 > 0."
      />

      {/* Methodological Limits Banner */}
      <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs">
        <p className="font-semibold text-amber-800 dark:text-amber-300">
          Methodological Limitations — Signals Are Hypotheses, Not Causal Findings
        </p>
        <p className="mt-1 text-[var(--muted)]">
          Spontaneous reports lack a true exposure denominator (total patients co-prescribed both
          drugs) and are subject to under-reporting, stimulated reporting, and{" "}
          <strong>confounding by indication and co-prescribing</strong> (drugs prescribed together
          for the same underlying condition share disease-related adverse events). The triplet
          search is capped at the top 200 co-reported triplets (and up to 12 drugs per report) so
          in-browser screening stays responsive. Reference:{" "}
          <em>
            Norén GN, Sundberg R, Bate A, Edwards IR. A statistical methodology for drug–drug
            interaction surveillance. Stat Med. 2008;27(16):3057–3070.
          </em>
        </p>
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Min co-reports (n₁₁₁){" "}
          <input
            type="number"
            min={1}
            max={50}
            value={minCoCases}
            onChange={(e) => setMinCoCases(Math.max(1, Number(e.target.value) || 2))}
            className="ml-1.5 w-16 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
          />
        </label>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter Drug A, Drug B, or Event…"
          className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
        />

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          Only Ω₀₂₅ &gt; 0 interaction signals ({flaggedCount})
        </label>

        <span className="ml-auto font-mono text-xs text-[var(--muted)]">
          Showing {filtered.length} of {interactions.length} evaluated triplets (search cap: 200)
        </span>
      </div>

      <HelpTip>
        <strong>Formula (Norén et al. 2008):</strong> Ω = log₂((n₁₁₁ + 0.5) / (E₁₁₁ + 0.5)), where
        E₁₁₁ = g₁₁ · n₁₁ is the expected count under no excess interaction derived from the four
        exposure cells (00: neither drug, 10: Drug A only, 01: Drug B only, 11: both drugs). Lower
        95% bound: Ω₀₂₅ = Ω − 1.96 / (ln(2) · √(n₁₁₁ + 0.5)).
      </HelpTip>

      {/* Selected Triplet 2x2x2 Cell Inspector */}
      {selected && (
        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
            <div>
              <p className="font-mono text-xs uppercase text-[var(--muted)]">
                Selected Triplet 4-Cell Additive Risk Breakdown
              </p>
              <h2 className="mt-0.5 text-lg font-semibold">
                {selected.drug_a} + {selected.drug_b} → {selected.adverse_event}
              </h2>
            </div>
            <div className="flex items-center gap-3 font-mono text-sm">
              <span>
                Ω = <strong>{selected.omega.toFixed(3)}</strong>
              </span>
              <span>
                95% CI: [{selected.omega025.toFixed(3)}, {selected.omega975.toFixed(3)}]
              </span>
              {selected.signal_omega ? (
                <Badge tone="ok">Ω₀₂₅ &gt; 0 Signal</Badge>
              ) : (
                <Badge tone="default">Below threshold</Badge>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-xs">
              <p className="font-mono text-[11px] uppercase text-[var(--muted)]">
                Cell 00 (Neither Drug)
              </p>
              <p className="mt-1 text-base font-semibold">
                {selected.n001} / {selected.n00} reports
              </p>
              <p className="mt-0.5 font-mono text-[var(--muted)]">
                f₀₀ = {(selected.f00 * 100).toFixed(2)}%
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-xs">
              <p className="font-mono text-[11px] uppercase text-[var(--muted)]">
                Cell 10 ({selected.drug_a} only)
              </p>
              <p className="mt-1 text-base font-semibold">
                {selected.n101} / {selected.n10} reports
              </p>
              <p className="mt-0.5 font-mono text-[var(--muted)]">
                f₁₀ = {(selected.f10 * 100).toFixed(2)}% · Single PRR = {selected.prr_a ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-xs">
              <p className="font-mono text-[11px] uppercase text-[var(--muted)]">
                Cell 01 ({selected.drug_b} only)
              </p>
              <p className="mt-1 text-base font-semibold">
                {selected.n011} / {selected.n01} reports
              </p>
              <p className="mt-0.5 font-mono text-[var(--muted)]">
                f₀₁ = {(selected.f01 * 100).toFixed(2)}% · Single PRR = {selected.prr_b ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-brand-600/40 bg-brand-600/5 p-3 text-xs">
              <p className="font-mono text-[11px] uppercase text-brand-600 dark:text-brand-400">
                Cell 11 (Co-reported A + B)
              </p>
              <p className="mt-1 text-base font-semibold">
                Observed n₁₁₁ = {selected.n111} / {selected.n11}
              </p>
              <p className="mt-0.5 font-mono text-[var(--muted)]">
                f₁₁ = {(selected.f11 * 100).toFixed(2)}% vs Additive g₁₁ ={" "}
                {(selected.g11 * 100).toFixed(2)}% (E₁₁₁ = {selected.expected_111.toFixed(2)})
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Triplet Table */}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="p-3">Drug A</th>
              <th className="p-3">Drug B</th>
              <th className="p-3">Adverse Event</th>
              <th className="p-3 text-right">n₁₁₁ / n₁₁</th>
              <th className="p-3 text-right">Expected E₁₁₁</th>
              <th className="p-3 text-right">Ω</th>
              <th className="p-3 text-right">Ω₀₂₅ (Lower 95%)</th>
              <th className="p-3 text-right">PRR (A / B / A+B)</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-sm text-[var(--muted)]">
                  No drug–drug–event triplets match the current filter criteria.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const key = `${r.drug_a}|${r.drug_b}|${r.adverse_event}`;
                const isSel =
                  selected &&
                  selected.drug_a === r.drug_a &&
                  selected.drug_b === r.drug_b &&
                  selected.adverse_event === r.adverse_event;
                return (
                  <tr
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    className={`cursor-pointer border-b border-[var(--border)]/50 transition ${
                      isSel ? "bg-brand-600/10" : "hover:bg-[var(--card)]/60"
                    }`}
                  >
                    <td className="p-3 font-medium">{r.drug_a}</td>
                    <td className="p-3 font-medium">{r.drug_b}</td>
                    <td className="p-3">{r.adverse_event}</td>
                    <td className="p-3 text-right font-mono">
                      {r.n111} / {r.n11}
                    </td>
                    <td className="p-3 text-right font-mono">{r.expected_111.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono font-semibold">{r.omega.toFixed(3)}</td>
                    <td
                      className={`p-3 text-right font-mono font-semibold ${
                        r.omega025 > 0 ? "text-emerald-600 dark:text-emerald-400" : ""
                      }`}
                    >
                      {r.omega025.toFixed(3)}
                    </td>
                    <td className="p-3 text-right font-mono text-xs text-[var(--muted)]">
                      {r.prr_a ?? "—"} / {r.prr_b ?? "—"} /{" "}
                      <strong className="text-[var(--fg)]">{r.prr_ab}</strong>
                    </td>
                    <td className="p-3">
                      {r.signal_omega ? (
                        <Badge tone="ok">Ω₀₂₅ &gt; 0</Badge>
                      ) : (
                        <Badge tone="default">—</Badge>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
