"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";
import { useData } from "@/lib/context/DataContext";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";

export function MlView() {
  const { analysis } = useData();
  if (!analysis) return null;

  const { model, featureAvailability, signals } = analysis;
  const top = signals.slice(0, 12);
  const usedFeatures = model.features.filter((f) => f.used);
  const caseFeatures = model.features.filter((f) => f.group === "case");
  const isSynthetic = model.training.data === "synthetic";

  const weightChartData = usedFeatures
    .map((f) => ({
      name: `${f.weight >= 0 ? "[+] " : "[-] "}${f.label}`,
      shortLabel: f.label,
      weight: f.weight,
      direction: f.weight >= 0 ? "Positive (+)" : "Negative (−)",
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  const candidateEntries = Object.entries(model.evaluation.candidates);
  const baselineEntries = Object.entries(model.evaluation.baselines);

  return (
    <>
      <PageHeader
        title="ML prioritisation"
        hint="Offline-trained model on published OMOP and EU-ADR reference sets, exported to JSON and evaluated in-browser with exact Python parity."
      />

      <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-[var(--fg)]">
        <strong className="font-semibold text-amber-800 dark:text-amber-300">
          Methodological Limitations (Spontaneous Reporting):
        </strong>{" "}
        Supervised prioritisation models trained on spontaneous-report features inherit selective reporting biases, missing denominators, and confounding by indication. Priority scores rank pairs for human review and represent <strong>hypotheses, not causal findings</strong>.
      </div>

      {isSynthetic && (
        <div
          role="alert"
          className="mb-8 rounded-2xl border-2 border-amber-500/70 bg-amber-500/10 p-5 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warn">Synthetic training data — placeholder weights</Badge>
            <span className="font-semibold text-amber-900 dark:text-amber-200">
              Do not interpret these evaluation metrics as real pharmacovigilance performance.
            </span>
          </div>
          <p className="mt-2 text-[var(--muted)]">
            {model.training.description} Only the reporting rate in the synthetic benchmark depends on ground truth; case-level attributes are generated independently. To train on real FDA FAERS quarterly extracts, run:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs">
            python train_prioritizer.py --faers-dir &lt;ASCII folders&gt;
          </pre>
        </div>
      )}

      {/* Model Card */}
      <div className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Model card &amp; provenance</h2>
          <Badge tone={isSynthetic ? "warn" : "ok"}>
            Training source: {model.training.data.toUpperCase()}
          </Badge>
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-[var(--border)]/60 p-3">
            <dt className="text-xs uppercase text-[var(--muted)]">Model type</dt>
            <dd className="mt-1 font-semibold">{model.model_type}</dd>
            <dd className="text-xs text-[var(--muted)]">Selected: {model.evaluation.selected}</dd>
          </div>
          <div className="rounded-xl border border-[var(--border)]/60 p-3">
            <dt className="text-xs uppercase text-[var(--muted)]">Exported date</dt>
            <dd className="mt-1 font-semibold">{model.created}</dd>
            <dd className="text-xs text-[var(--muted)]">
              {model.training.n_cases.toLocaleString()} deduplicated reports
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border)]/60 p-3">
            <dt className="text-xs uppercase text-[var(--muted)]">Labelled controls</dt>
            <dd className="mt-1 font-semibold">
              {model.evaluation.n_labelled} / {model.training.controls_total}
            </dd>
            <dd className="text-xs text-[var(--muted)]">
              {model.evaluation.n_positive} positive · {model.evaluation.n_negative} negative
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border)]/60 p-3">
            <dt className="text-xs uppercase text-[var(--muted)]">Reference sets</dt>
            <dd className="mt-1 font-semibold">
              {model.training.reference_sets.join(" + ")}
            </dd>
            <dd className="text-xs text-[var(--muted)]">{model.training.label_unit}</dd>
          </div>
          <div className="rounded-xl border border-[var(--border)]/60 p-3">
            <dt className="text-xs uppercase text-[var(--muted)]">Active features</dt>
            <dd className="mt-1 font-semibold">
              {usedFeatures.length} of {model.features.length} features used
            </dd>
            <dd className="text-xs text-[var(--muted)]">
              Feature set: {model.feature_set} (intercept {model.intercept.toFixed(3)})
            </dd>
          </div>
        </dl>
      </div>

      {/* Held-out Evaluation vs Single-Statistic Baselines */}
      <div className="glass mt-8 rounded-2xl p-6">
        <h2 className="font-display text-lg font-semibold">
          Held-out evaluation vs. single-statistic baselines
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{model.evaluation.protocol}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="py-2 pr-4">Method</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">ROC AUC</th>
                <th className="py-2 pr-4">Avg Precision (AP)</th>
                <th className="py-2 pr-4">P@10</th>
                <th className="py-2 pr-4">P@25</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {candidateEntries.map(([name, m]) => {
                const isSelected = name === model.evaluation.selected;
                return (
                  <tr
                    key={name}
                    className={`border-b border-[var(--border)]/50 ${
                      isSelected ? "bg-brand-500/10 font-medium" : ""
                    }`}
                  >
                    <td className="py-2.5 pr-4">{name}</td>
                    <td className="py-2.5 pr-4 text-xs text-[var(--muted)]">ML candidate</td>
                    <td className="py-2.5 pr-4 font-mono">
                      {m.auc.toFixed(3)} <span className="text-xs text-[var(--muted)]">± {m.auc_sd.toFixed(3)}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {m.ap.toFixed(3)} <span className="text-xs text-[var(--muted)]">± {m.ap_sd.toFixed(3)}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {m.precision_at_k["10"] !== undefined ? m.precision_at_k["10"].toFixed(2) : "—"}
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {m.precision_at_k["25"] !== undefined ? m.precision_at_k["25"].toFixed(2) : "—"}
                    </td>
                    <td className="py-2.5">
                      {isSelected ? <Badge tone="ok">Selected model</Badge> : <Badge>Candidate</Badge>}
                    </td>
                  </tr>
                );
              })}
              {baselineEntries.map(([name, m]) => (
                <tr key={name} className="border-b border-[var(--border)]/50">
                  <td className="py-2.5 pr-4">Baseline: {name}</td>
                  <td className="py-2.5 pr-4 text-xs text-[var(--muted)]">Single statistic</td>
                  <td className="py-2.5 pr-4 font-mono">{m.auc.toFixed(3)}</td>
                  <td className="py-2.5 pr-4 font-mono">{m.ap.toFixed(3)}</td>
                  <td className="py-2.5 pr-4 font-mono">
                    {m.precision_at_k["10"] !== undefined ? m.precision_at_k["10"].toFixed(2) : "—"}
                  </td>
                  <td className="py-2.5 pr-4 font-mono">
                    {m.precision_at_k["25"] !== undefined ? m.precision_at_k["25"].toFixed(2) : "—"}
                  </td>
                  <td className="py-2.5">
                    <Badge>Baseline</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Priority Scores & Signed Feature Weights */}
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-display font-semibold">Top pair priority scores</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Predicted probability on the loaded dataset (ranked highest first).
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={top.map((s) => ({
                  name: `${s.drug.slice(0, 10)} · ${s.adverse_event.slice(0, 14)}`,
                  score: s.priority_score ?? 0,
                }))}
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="score" fill="#34d399" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="font-display font-semibold">
            Signed standardized weights (log-odds per SD)
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            [+] solid blue bars push priority score up; [−] dashed amber bars push priority score down.
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weightChartData} layout="vertical" margin={{ left: 12, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 10 }} />
                <ReferenceLine x={0} stroke="#64748b" strokeWidth={1.5} />
                <Tooltip
                  formatter={(val) => {
                    const n = Number(val ?? 0);
                    return [
                      `${n >= 0 ? "+" : ""}${n.toFixed(4)} (${n >= 0 ? "increases" : "decreases"} log-odds)`,
                      "Weight",
                    ];
                  }}
                />
                <Bar dataKey="weight" radius={4}>
                  {weightChartData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={entry.weight >= 0 ? "#1a7ff5" : "#f59e0b"}
                      stroke={entry.weight >= 0 ? "#1568e1" : "#b45309"}
                      strokeWidth={entry.weight >= 0 ? 1 : 2}
                      strokeDasharray={entry.weight >= 0 ? undefined : "4 2"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Case-level Feature Availability & Model Usage */}
      <div className="glass mt-8 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">
            Case-level feature coverage in loaded dataset
          </h2>
          {analysis.meta.source === "openfda_live" && (
            <Badge tone="warn">
              openFDA Live Count Mode — Case-level ML features unavailable (100% Missing)
            </Badge>
          )}
        </div>
        <HelpTip>
          Shows the share of scored drug–event pairs where each optional case-level feature is
          available in the currently loaded dataset, and whether the active model uses it. In live
          openFDA 2×2 count mode, report-level tables (DEMO, OUTC, INDI, THER) are not available, so
          all 11 case-level features are shown as missing and imputed at the training mean (0
          log-odds contribution).
        </HelpTip>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="py-2 pr-4">Feature</th>
                <th className="py-2 pr-4">Coverage in loaded data</th>
                <th className="py-2 pr-4">Model usage</th>
                <th className="py-2 pr-4">Training mean (imputation)</th>
                <th className="py-2">Weight</th>
              </tr>
            </thead>
            <tbody>
              {caseFeatures.map((f) => {
                const cov = featureAvailability[f.name] ?? 0;
                const pct = Math.round(cov * 100);
                return (
                  <tr key={f.name} className="border-b border-[var(--border)]/50">
                    <td className="py-2 pr-4 font-medium">{f.label}</td>
                    <td className="py-2 pr-4 font-mono">
                      {analysis.meta.source === "openfda_live" || pct === 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          Missing (0% — unavailable in count mode)
                        </span>
                      ) : (
                        `${pct}%`
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {f.used ? (
                        <Badge tone="ok">Used in model</Badge>
                      ) : (
                        <Badge>Unused (disproportionality-only model)</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono">{f.mean.toFixed(3)}</td>
                    <td className="py-2 font-mono">
                      {f.used ? `${f.weight >= 0 ? "+" : ""}${f.weight.toFixed(4)}` : "0.0000"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-pair signed drivers */}
      <div className="glass mt-8 rounded-2xl p-6">
        <h2 className="font-display text-lg font-semibold">
          Explainability (top signed log-odds drivers per pair)
        </h2>
        <HelpTip>
          Each driver shows contribution_j = weight_j × (x_j − mean_j) / std_j in log-odds. ↑ (+) pushes the priority score up; ↓ (−) pushes the priority score down.
        </HelpTip>
        <ul className="mt-4 space-y-3 text-sm">
          {top.slice(0, 8).map((s) => (
            <li
              key={`${s.drug}-${s.adverse_event}`}
              className="border-b border-[var(--border)]/50 pb-3 last:border-none"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{s.drug}</strong> · {s.adverse_event}
                </span>
                <span className="font-mono text-brand-600 dark:text-brand-400">
                  score {s.priority_score?.toFixed(4)} (rank #{s.priority_rank})
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                {(s.priority_explain ?? []).map((e) => {
                  const up = e.contribution >= 0;
                  return (
                    <span
                      key={e.feature}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-mono ${
                        up
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                      }`}
                    >
                      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
                      <span>{e.label}:</span>
                      <span>
                        {up ? "+" : ""}
                        {e.contribution.toFixed(4)}
                      </span>
                      <span className="text-[var(--muted)]">(val={e.value})</span>
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
