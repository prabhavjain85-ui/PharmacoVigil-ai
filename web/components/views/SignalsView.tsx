"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/context/DataContext";
import { signalsToCsv } from "@/lib/pipeline/analyze";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";

export function SignalsView() {
  const { analysis, minCases, setMinCases } = useData();
  const [filter, setFilter] = useState("");
  const [onlySignals, setOnlySignals] = useState(false);
  const [sortKey, setSortKey] = useState<"PRR" | "priority_rank">("priority_rank");

  const rows = useMemo(() => {
    if (!analysis) return [];
    let list = [...analysis.signals];
    if (onlySignals) list = list.filter((s) => s.signal_detected || s.signal_bcpnn || s.signal_ebgm);
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((s) => s.drug.toLowerCase().includes(q) || s.adverse_event.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sortKey === "PRR") return b.PRR - a.PRR;
      return (a.priority_rank ?? 999) - (b.priority_rank ?? 999);
    });
    return list;
  }, [analysis, filter, onlySignals, sortKey]);

  function exportCsv() {
    if (!analysis) return;
    const blob = new Blob([signalsToCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "signals.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!analysis) return null;

  return (
    <>
      <PageHeader
        title="Signal detection"
        hint="Disproportionality metrics computed on loaded data: PRR, ROR, χ², BCPNN (IC), EBGM (EB05)."
      />
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          Min cases{" "}
          <input
            type="number"
            min={1}
            value={minCases}
            onChange={(e) => setMinCases(Number(e.target.value) || 3)}
            className="ml-2 w-16 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
          />
        </label>
        <input
          placeholder="Filter drug or event…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlySignals} onChange={(e) => setOnlySignals(e.target.checked)} />
          Any method flagged
        </label>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as "PRR" | "priority_rank")} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm">
          <option value="priority_rank">Sort by ML rank</option>
          <option value="PRR">Sort by PRR</option>
        </select>
        <button type="button" onClick={exportCsv} className="rounded-xl bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white">
          Export CSV
        </button>
      </div>
      <HelpTip>PRR signal: PRR ≥ 2, χ² ≥ 4, cases ≥ min. BCPNN: IC025 &gt; 0. EBGM: EB05 &gt; 2.</HelpTip>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="p-3">Drug</th>
              <th>Event</th>
              <th>PRR</th>
              <th>IC025</th>
              <th>EB05</th>
              <th>Cases</th>
              <th>Rank</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={`${s.drug}-${s.adverse_event}`} className="border-b border-[var(--border)]/50">
                <td className="p-3 font-medium">{s.drug}</td>
                <td>{s.adverse_event}</td>
                <td>{s.PRR}</td>
                <td>{s.IC025}</td>
                <td>{s.EB05}</td>
                <td>{s.case_count_a}</td>
                <td>#{s.priority_rank}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {s.signal_detected && <Badge tone="ok">PRR</Badge>}
                    {s.signal_bcpnn && <Badge tone="ok">BCPNN</Badge>}
                    {s.signal_ebgm && <Badge tone="ok">EBGM</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
