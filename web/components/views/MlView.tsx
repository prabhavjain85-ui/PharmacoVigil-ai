"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useData } from "@/lib/context/DataContext";
import { HelpTip, PageHeader } from "@/components/AppShell";

export function MlView() {
  const { analysis } = useData();
  if (!analysis) return null;

  const top = analysis.signals.slice(0, 12);
  const imp = analysis.globalImportance;

  return (
    <>
      <PageHeader
        title="ML prioritisation"
        hint="Logistic regression trained in-browser on weak labels (same feature set as the Python pipeline). Scores rank pairs for analyst triage."
      />
      <HelpTip>
        Weak labels combine planted demo signals and a small literature reference set — not ground truth. Retrained automatically when you load new data.
      </HelpTip>
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-display font-semibold">Priority scores</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top.map((s) => ({ name: s.adverse_event.slice(0, 18), score: s.priority_score ?? 0 }))} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="score" fill="#34d399" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="glass rounded-2xl p-6">
          <h2 className="font-display font-semibold">Feature weights (|coefficient|)</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={imp.slice(0, 8)} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="importance" fill="#1a7ff5" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="glass mt-8 rounded-2xl p-6">
        <h2 className="font-semibold">Explainability (top drivers per pair)</h2>
        <ul className="mt-4 space-y-3 text-sm">
          {top.slice(0, 8).map((s) => (
            <li key={`${s.drug}-${s.adverse_event}`}>
              <strong>{s.drug}</strong> · {s.adverse_event} — score {s.priority_score?.toFixed(3)}
              <div className="text-[var(--muted)]">
                {(s.priority_explain ?? []).map((e) => `${e.label} (${e.contribution})`).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
