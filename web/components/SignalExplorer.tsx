"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { data, fmt } from "@/lib/data";
import type { SignalRow } from "@/lib/types";
import { Badge } from "./ui/Badge";

export function SignalExplorer() {
  const [drug, setDrug] = useState(data.default_drug);
  const rows = useMemo(
    () => [...(data.signals_by_drug[drug] || [])].sort((a, b) => (a.priority_rank ?? 99) - (b.priority_rank ?? 99)),
    [drug],
  );
  const chartData = rows.slice(0, 8).map((r) => ({
    name: r.adverse_event.length > 22 ? `${r.adverse_event.slice(0, 20)}…` : r.adverse_event,
    PRR: r.PRR,
    priority: r.priority_score ?? 0,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-[var(--muted)]">Select drug (synthetic demo)</span>
          <select
            value={drug}
            onChange={(e) => setDrug(e.target.value)}
            className="min-w-[220px] rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-base"
          >
            {data.drugs.map((d) => (
              <option key={d.drug} value={d.drug}>
                {d.drug} · {d.signal_count} PRR signals
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-[var(--muted)]">
          {data.dataset.case_count} cases · {data.dataset.pair_count} drug–event pairs · precomputed offline
        </p>
      </div>
      <div className="glass rounded-2xl p-4 md:p-6">
        <h3 className="font-display text-lg font-semibold">Top signals by PRR</h3>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="PRR" fill="#1a7ff5" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--card)] text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="p-3">Event</th>
              <th>PRR</th>
              <th>IC025</th>
              <th>EB05</th>
              <th>Cases</th>
              <th>Priority</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SignalTableRow key={r.adverse_event} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SignalTableRow({ row }: { row: SignalRow }) {
  return (
    <tr className="border-b border-[var(--border)]/60 hover:bg-brand-500/5">
      <td className="p-3 font-medium">{row.adverse_event}</td>
      <td className="p-3">{fmt(row.PRR)}</td>
      <td className="p-3">{fmt(row.IC025, 4)}</td>
      <td className="p-3">{fmt(row.EB05, 4)}</td>
      <td className="p-3">{row.case_count_a}</td>
      <td className="p-3">
        <span className="font-semibold">{fmt(row.priority_score, 3)}</span>
        <span className="text-[var(--muted)]"> #{row.priority_rank}</span>
      </td>
      <td className="p-3">
        <div className="flex flex-wrap gap-1">
          {row.signal_detected && <Badge tone="ok">PRR</Badge>}
          {row.signal_bcpnn && <Badge tone="ok">BCPNN</Badge>}
          {row.signal_ebgm && <Badge tone="ok">EBGM</Badge>}
        </div>
      </td>
    </tr>
  );
}
