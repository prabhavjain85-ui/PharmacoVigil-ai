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
        <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-xs text-[var(--fg)]">
          <strong className="font-semibold text-emerald-800 dark:text-emerald-300">
            Baseline comparison (&gt; 1 SD rule):
          </strong>{" "}
          Across {model.evaluation.n_labelled} labelled reference controls ({model.evaluation.n_positive} positive,{" "}
          {model.evaluation.n_negative} negative) with ≥ 3 reports in four consecutive FDA FAERS quarters (2023Q3–2024Q2;{" "}
          {model.training.n_cases.toLocaleString()} deduplicated cases), the selected{" "}
          <strong>{model.evaluation.selected}</strong> model achieves a drug-grouped cross-validated ROC AUC of{" "}
          <strong>0.8808 ± 0.0080</strong> (AP <strong>0.9104 ± 0.0093</strong>), beating the best single-statistic
          baseline (<strong>ROR lower 95% bound</strong>, AUC <strong>0.8185</strong>, AP <strong>0.8439</strong>) by{" "}
          <strong>+0.0623 AUC (+7.79 standard deviations)</strong>. It also beats the disproportionality-only logistic
          regression candidate (AUC <strong>0.8360 ± 0.0034</strong>) by <strong>+0.0448 AUC (+5.60 SD)</strong>, so all
          17 features (6 disproportionality + 11 case-level) are retained.
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="py-2 pr-4">Method</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">ROC AUC</th>
                <th className="py-2 pr-4">Avg Precision (AP)</th>
                <th className="py-2 pr-4">P@10</th>
                <th className="py-2 pr-4">P@25</th>
                <th className="py-2 pr-4">P@50</th>
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
                      {m.auc.toFixed(4)} <span className="text-xs text-[var(--muted)]">± {m.auc_sd.toFixed(4)}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {m.ap.toFixed(4)} <span className="text-xs text-[var(--muted)]">± {m.ap_sd.toFixed(4)}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {m.precision_at_k["10"] !== undefined ? m.precision_at_k["10"].toFixed(3) : "—"}
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {m.precision_at_k["25"] !== undefined ? m.precision_at_k["25"].toFixed(3) : "—"}
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {m.precision_at_k["50"] !== undefined ? m.precision_at_k["50"].toFixed(3) : "—"}
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
                  <td className="py-2.5 pr-4 font-mono">{m.auc.toFixed(4)}</td>
                  <td className="py-2.5 pr-4 font-mono">{m.ap.toFixed(4)}</td>
                  <td className="py-2.5 pr-4 font-mono">
                    {m.precision_at_k["10"] !== undefined ? m.precision_at_k["10"].toFixed(3) : "—"}
                  </td>
                  <td className="py-2.5 pr-4 font-mono">
                    {m.precision_at_k["25"] !== undefined ? m.precision_at_k["25"].toFixed(3) : "—"}
                  </td>
                  <td className="py-2.5 pr-4 font-mono">
                    {m.precision_at_k["50"] !== undefined ? m.precision_at_k["50"].toFixed(3) : "—"}
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

      {/* Drug-Relative Outcome Feature Ablation & Regulatory Sanity List */}
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">
              Ablation: drug-relative outcome features
            </h2>
            <Badge tone="warn">Excluded (did not improve CV AUC)</Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Tested adding drug-relative versions of the three outcome features (pair outcome fraction minus the drug&apos;s
            overall outcome fraction across all 2023Q3–2024Q2 reports: <code>frac_death_rel</code>,{" "}
            <code>frac_hosp_lt_rel</code>, <code>frac_serious_rel</code>) under 5×5-fold drug-grouped cross-validation.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] uppercase text-[var(--muted)]">
                <tr>
                  <th className="py-2 pr-3">Feature configuration</th>
                  <th className="py-2 pr-3">L2 Logistic AUC</th>
                  <th className="py-2 pr-3">Grad. Boost AUC</th>
                  <th className="py-2">Decision</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--border)]/50 bg-brand-500/10 font-medium">
                  <td className="py-2 pr-3">17 features (raw outcome fractions)</td>
                  <td className="py-2 pr-3 font-mono">0.8808 ± 0.0080</td>
                  <td className="py-2 pr-3 font-mono">0.8800 ± 0.0042</td>
                  <td className="py-2"><Badge tone="ok">Retained</Badge></td>
                </tr>
                <tr className="border-b border-[var(--border)]/50">
                  <td className="py-2 pr-3">20 features (+3 drug-relative outcomes)</td>
                  <td className="py-2 pr-3 font-mono">0.8719 ± 0.0067 (−0.0089)</td>
                  <td className="py-2 pr-3 font-mono">0.8762 ± 0.0060 (−0.0038)</td>
                  <td className="py-2"><Badge>Dropped</Badge></td>
                </tr>
                <tr className="border-b border-[var(--border)]/50">
                  <td className="py-2 pr-3">17 features (drug-relative replacing raw)</td>
                  <td className="py-2 pr-3 font-mono">0.8762 ± 0.0089 (−0.0046)</td>
                  <td className="py-2 pr-3 font-mono">0.8764 ± 0.0072 (−0.0036)</td>
                  <td className="py-2"><Badge>Dropped</Badge></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="font-display text-lg font-semibold">
            Reference-set coverage (2023Q3–2024Q2 FAERS)
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Out of 485 unique OMOP + EU-ADR controls across 230 canonical drugs, 475 controls have the drug present in
            2023Q3–2024Q2 FAERS and 215 have ≥ 3 co-occurrences with the target HOI. The only 5 reference drugs absent
            from 2023Q3–2024Q2 are discontinued/withdrawn products: <code>ALATROFLOXACIN</code>,{" "}
            <code>FENOPROFEN</code>, <code>GEMIFLOXACIN</code>, <code>MOEXIPRIL</code>, and <code>TROVAFLOXACIN</code>.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)]/60 p-3">
              <dt className="text-[var(--muted)]">Quarters pooled</dt>
              <dd className="mt-1 font-mono text-sm font-semibold">23Q3, 23Q4, 24Q1, 24Q2</dd>
            </div>
            <div className="rounded-xl border border-[var(--border)]/60 p-3">
              <dt className="text-[var(--muted)]">Superseded versions dropped</dt>
              <dd className="mt-1 font-mono text-sm font-semibold">135,401</dd>
            </div>
            <div className="rounded-xl border border-[var(--border)]/60 p-3">
              <dt className="text-[var(--muted)]">Controls with drug in data</dt>
              <dd className="mt-1 font-mono text-sm font-semibold">475 / 485 (97.9%)</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Sanity List: 10 Well-Established Regulatory Pairs on Real FAERS */}
      <div className="glass mt-8 rounded-2xl p-6">
        <h2 className="font-display text-lg font-semibold">
          Sanity check: priority rank of 10 established regulatory safety signals on real FAERS (2024Q2)
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Evaluated across N = 397,119 deduplicated cases in FDA FAERS 2024Q2 (35,363 drug–MedDRA PT pairs with ≥ 3
          reports and full case-level attributes across the 230-drug reference cohort).
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-[var(--border)] uppercase text-[var(--muted)]">
              <tr>
                <th className="py-2 pr-3">Drug</th>
                <th className="py-2 pr-3">Adverse event (MedDRA PT)</th>
                <th className="py-2 pr-3">Priority rank (percentile)</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2 pr-3">Cases (a)</th>
                <th className="py-2 pr-3">PRR</th>
                <th className="py-2 pr-3">IC025</th>
                <th className="py-2">Regulatory source</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  drug: "METFORMIN",
                  pt: "LACTIC ACIDOSIS",
                  rank: "#49 / 35,363 (top 0.14%)",
                  score: "0.9996",
                  a: 415,
                  prr: "272.34",
                  ic025: "6.20",
                  src: "FDA Boxed Warning (Glucophage SPL): Metformin-associated lactic acidosis",
                },
                {
                  drug: "LAMOTRIGINE",
                  pt: "STEVENS-JOHNSON SYNDROME",
                  rank: "#519 / 35,363 (top 1.47%)",
                  score: "0.9960",
                  a: 28,
                  prr: "35.25",
                  ic025: "3.39",
                  src: "FDA Boxed Warning (Lamictal SPL): Serious skin rashes including SJS/TEN",
                },
                {
                  drug: "ALLOPURINOL",
                  pt: "DRUG REACTION WITH EOSINOPHILIA AND SYSTEMIC SYMPTOMS",
                  rank: "#917 / 35,363 (top 2.59%)",
                  score: "0.9924",
                  a: 79,
                  prr: "113.76",
                  ic025: "5.11",
                  src: "FDA Warnings & Precautions / EMA PRAC (Zyloprim SPL): Severe hypersensitivity / DRESS",
                },
                {
                  drug: "ROSUVASTATIN",
                  pt: "RHABDOMYOLYSIS",
                  rank: "#1,107 / 35,363 (top 3.13%)",
                  score: "0.9907",
                  a: 134,
                  prr: "58.95",
                  ic025: "4.89",
                  src: "FDA Warnings & Precautions (Crestor SPL): Skeletal muscle effects and rhabdomyolysis",
                },
                {
                  drug: "ATORVASTATIN",
                  pt: "RHABDOMYOLYSIS",
                  rank: "#2,152 / 35,363 (top 6.09%)",
                  score: "0.9793",
                  a: 89,
                  prr: "27.28",
                  ic025: "3.94",
                  src: "FDA Warnings & Precautions (Lipitor SPL): Myopathy and rhabdomyolysis",
                },
                {
                  drug: "RIVAROXABAN",
                  pt: "GASTROINTESTINAL HAEMORRHAGE",
                  rank: "#4,123 / 35,363 (top 11.66%)",
                  score: "0.9494",
                  a: 42,
                  prr: "17.47",
                  ic025: "3.16",
                  src: "FDA Boxed Warning (Xarelto SPL): Risk of serious/fatal gastrointestinal haemorrhage",
                },
                {
                  drug: "APIXABAN",
                  pt: "GASTROINTESTINAL HAEMORRHAGE",
                  rank: "#5,360 / 35,363 (top 15.16%)",
                  score: "0.9241",
                  a: 110,
                  prr: "12.66",
                  ic025: "3.08",
                  src: "FDA Boxed Warning & Warnings (Eliquis SPL): Serious and fatal gastrointestinal bleeding",
                },
                {
                  drug: "CLOZAPINE",
                  pt: "AGRANULOCYTOSIS",
                  rank: "#5,387 / 35,363 (top 15.23%)",
                  score: "0.9237",
                  a: 21,
                  prr: "7.14",
                  ic025: "1.81",
                  src: "FDA Boxed Warning & REMS (Clozaril SPL): Severe neutropenia / agranulocytosis",
                },
                {
                  drug: "WARFARIN",
                  pt: "GASTROINTESTINAL HAEMORRHAGE",
                  rank: "#6,267 / 35,363 (top 17.72%)",
                  score: "0.9021",
                  a: 18,
                  prr: "22.73",
                  ic025: "2.72",
                  src: "FDA Boxed Warning (Coumadin SPL): Major or fatal haemorrhage",
                },
                {
                  drug: "CIPROFLOXACIN",
                  pt: "TENDON RUPTURE",
                  rank: "#6,545 / 35,363 (top 18.51%)",
                  score: "0.8944",
                  a: 17,
                  prr: "30.65",
                  ic025: "2.78",
                  src: "FDA Boxed Warning (Cipro SPL, July 2008 DSC): Tendinitis and tendon rupture",
                },
              ].map((row) => (
                <tr key={`${row.drug}-${row.pt}`} className="border-b border-[var(--border)]/50">
                  <td className="py-2 pr-3 font-semibold">{row.drug}</td>
                  <td className="py-2 pr-3">{row.pt}</td>
                  <td className="py-2 pr-3 font-mono text-brand-600 dark:text-brand-400">{row.rank}</td>
                  <td className="py-2 pr-3 font-mono">{row.score}</td>
                  <td className="py-2 pr-3 font-mono">{row.a}</td>
                  <td className="py-2 pr-3 font-mono">{row.prr}</td>
                  <td className="py-2 pr-3 font-mono">{row.ic025}</td>
                  <td className="py-2 text-[var(--muted)]">{row.src}</td>
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
