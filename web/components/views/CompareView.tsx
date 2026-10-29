"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/context/DataContext";
import { HelpTip, PageHeader } from "@/components/AppShell";

export function CompareView() {
  const { analysis } = useData();
  const drugs = useMemo(() => [...new Set(analysis?.signals.map((s) => s.drug) ?? [])].sort(), [analysis]);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (d: string) => {
    setSelected((prev) => {
      if (prev.includes(d)) return prev.filter((x) => x !== d);
      if (prev.length >= 3) return prev;
      return [...prev, d];
    });
  };

  const matrix = useMemo(() => {
    if (!analysis || selected.length < 2) return [];
    const byEvent = new Map<string, Record<string, number>>();
    for (const s of analysis.signals) {
      if (!selected.includes(s.drug)) continue;
      if (!byEvent.has(s.adverse_event)) byEvent.set(s.adverse_event, {});
      byEvent.get(s.adverse_event)![s.drug] = s.PRR;
    }
    return [...byEvent.entries()]
      .filter(([, vals]) => Object.keys(vals).length >= 2)
      .map(([event, vals]) => ({ event, vals }))
      .sort((a, b) => Math.max(...Object.values(b.vals)) - Math.max(...Object.values(a.vals)))
      .slice(0, 30);
  }, [analysis, selected]);

  if (!analysis) return null;

  return (
    <>
      <PageHeader title="Drug comparison" hint="Select 2–3 drugs to compare PRR across shared adverse events." />
      <div className="flex flex-wrap gap-2">
        {drugs.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            className={`rounded-full border px-3 py-1 text-sm ${selected.includes(d) ? "border-brand-500 bg-brand-600 text-white" : "border-[var(--border)]"}`}
          >
            {d}
          </button>
        ))}
      </div>
      <HelpTip>Shared events appear in at least two selected drugs. Values shown are PRR.</HelpTip>
      {selected.length < 2 ? (
        <p className="mt-6 text-[var(--muted)]">Select at least two drugs.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase text-[var(--muted)]">
                <th className="p-3">Event</th>
                {selected.map((d) => (
                  <th key={d} className="p-3">{d} PRR</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.event} className="border-b border-[var(--border)]/50">
                  <td className="p-3">{row.event}</td>
                  {selected.map((d) => (
                    <td key={d} className="p-3">{row.vals[d]?.toFixed(3) ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
