"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useData } from "@/lib/context/DataContext";
import { HelpTip, PageHeader } from "@/components/AppShell";

function monthKey(eventDt?: string): string | null {
  if (!eventDt || eventDt.length < 6) return null;
  return `${eventDt.slice(0, 4)}-${eventDt.slice(4, 6)}`;
}

export function TrendsView() {
  const { analysis } = useData();
  const drugs = useMemo(() => [...new Set(analysis?.pairs.map((p) => p.drugname) ?? [])].sort(), [analysis]);
  const [drug, setDrug] = useState("");

  const series = useMemo(() => {
    if (!analysis) return [];
    const d = drug || drugs[0];
    if (!d) return [];
    const counts = new Map<string, number>();
    for (const p of analysis.pairs) {
      if (p.drugname !== d) continue;
      const m = monthKey(p.event_dt);
      if (!m) continue;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count }));
  }, [analysis, drug, drugs]);

  if (!analysis) return null;

  const hasDates = analysis.pairs.some((p) => p.event_dt);

  return (
    <>
      <PageHeader title="Trends over time" hint="Monthly case counts for drug–reaction pairs when DEMO.event_dt is present (YYYYMMDD)." />
      {!hasDates && <p className="text-[var(--muted)]">No event dates in the current dataset.</p>}
      <label className="mt-4 block text-sm">
        Drug{" "}
        <select value={drug || drugs[0] || ""} onChange={(e) => setDrug(e.target.value)} className="ml-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1">
          {drugs.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>
      <HelpTip>Counts pair rows per calendar month — a simple volume trend, not a formal temporal scan statistic.</HelpTip>
      <div className="glass mt-6 h-80 rounded-2xl p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#1a7ff5" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
