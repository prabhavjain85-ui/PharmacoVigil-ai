"use client";

import { useData } from "@/lib/context/DataContext";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";

export function DashboardView() {
  const { loading, error, analysis } = useData();
  const m = analysis?.meta;

  if (loading) return <p className="text-[var(--muted)]">Loading sample dataset…</p>;
  if (error) return <p className="text-red-500">{error}</p>;
  if (!m || !analysis) return null;

  const prr = analysis.signals.filter((s) => s.signal_detected).length;
  const bcp = analysis.signals.filter((s) => s.signal_bcpnn).length;
  const ebg = analysis.signals.filter((s) => s.signal_ebgm).length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        hint="Overview of the loaded FAERS-style dataset. All statistics run in your browser — nothing is sent to a server."
      />
      <HelpTip>
        Default data is a synthetic sample for testing. Upload your quarterly DEMO / DRUG / REAC extracts under Data.
      </HelpTip>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cases" value={m.case_count} />
        <Stat label="Drug–event pairs" value={m.pair_count} />
        <Stat label="Drugs" value={m.drug_count} />
        <Stat label="Source" value={m.source === "sample" ? "Sample" : "Upload"} />
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <SignalCard title="PRR / χ² signals" count={prr} />
        <SignalCard title="BCPNN (IC025 > 0)" count={bcp} />
        <SignalCard title="EBGM (EB05 > 2)" count={ebg} />
      </div>
      <div className="glass mt-8 rounded-2xl p-6">
        <h2 className="font-display text-lg font-semibold">Top priority (ML triage)</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {analysis.signals.slice(0, 5).map((s) => (
            <li key={`${s.drug}-${s.adverse_event}`} className="flex justify-between gap-4 border-b border-[var(--border)]/50 pb-2">
              <span>
                <strong>{s.drug}</strong> · {s.adverse_event}
              </span>
              <span className="font-mono text-brand-600 dark:text-brand-400">{s.priority_score?.toFixed(3)}</span>
            </li>
          ))}
        </ul>
        <HelpTip>
          ML scores use weak reference labels (literature + planted demo pairs) — triage aid only, not validated performance.
        </HelpTip>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SignalCard({ title, count }: { title: string; count: number }) {
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-sm text-[var(--muted)]">{title}</p>
      <p className="mt-2 text-3xl font-semibold">{count}</p>
      <Badge tone="default">min 3 cases</Badge>
    </div>
  );
}
