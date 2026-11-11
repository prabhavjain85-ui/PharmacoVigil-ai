"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";
import { useData } from "@/lib/context/DataContext";
import { signalsToCsv } from "@/lib/pipeline/analyze";
import type { SignalRow } from "@/lib/pipeline/types";

export function SignalsView() {
  const {
    analysis,
    minCases,
    setMinCases,
    excludeFlaggedDuplicates,
    setExcludeFlaggedDuplicates,
  } = useData();

  const [filter, setFilter] = useState("");
  const [onlySignals, setOnlySignals] = useState(false);
  const [fdrFilter, setFdrFilter] = useState<"all" | "0.05" | "0.01" | "0.10">("all");
  const [onlyConfounded, setOnlyConfounded] = useState(false);
  const [onlyWithWeibull, setOnlyWithWeibull] = useState(false);
  const [sortKey, setSortKey] = useState<"priority_rank" | "PRR" | "q_value" | "EB05">(
    "priority_rank",
  );
  const [selectedPairKey, setSelectedPairKey] = useState<string | null>(null);
  const [showDuplicateTable, setShowDuplicateTable] = useState(false);

  const rows = useMemo(() => {
    if (!analysis) return [];
    let list = [...analysis.signals];
    if (onlySignals) {
      list = list.filter(
        (s) => s.signal_detected || s.signal_bcpnn || s.signal_ebgm || s.signal_fdr,
      );
    }
    if (fdrFilter !== "all") {
      const thresh = Number(fdrFilter);
      list = list.filter((s) => s.q_value < thresh);
    }
    if (onlyConfounded) {
      list = list.filter((s) => Boolean(s.confounding_flagged));
    }
    if (onlyWithWeibull) {
      list = list.filter((s) => s.weibull_shape !== null && s.weibull_shape !== undefined);
    }
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter(
        (s) => s.drug.toLowerCase().includes(q) || s.adverse_event.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      if (sortKey === "PRR") return b.PRR - a.PRR;
      if (sortKey === "EB05") return b.EB05 - a.EB05;
      if (sortKey === "q_value") return a.q_value - b.q_value || b.chi_square - a.chi_square;
      return (a.priority_rank ?? 999) - (b.priority_rank ?? 999);
    });
    return list;
  }, [analysis, filter, onlySignals, fdrFilter, onlyConfounded, onlyWithWeibull, sortKey]);

  const selectedSignal: SignalRow | null = useMemo(() => {
    if (!rows.length) return null;
    if (selectedPairKey) {
      const found = rows.find((s) => `${s.drug}|${s.adverse_event}` === selectedPairKey);
      if (found) return found;
    }
    const withWeibull = rows.find((s) => s.weibull_shape !== null && s.weibull_shape !== undefined);
    return withWeibull ?? rows[0];
  }, [rows, selectedPairKey]);

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

  const dup = analysis.duplicates;
  const selKey = selectedSignal ? `${selectedSignal.drug}|${selectedSignal.adverse_event}` : "";
  const selStrat = selKey ? analysis.stratified[selKey] : undefined;
  const selWeibull = selKey ? analysis.weibull[selKey] : undefined;

  return (
    <>
      <PageHeader
        title="Signal detection, stratification & time-to-onset"
        hint="Disproportionality metrics (PRR, ROR, χ² with Benjamini–Hochberg FDR q-values, BCPNN IC, exact L-BFGS EBGM), Mantel–Haenszel age × sex stratification, probable-duplicate review, and Weibull time-to-onset modeling."
      />

      {/* Methodological Limitations Banner */}
      <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs">
        <p className="font-semibold text-amber-800 dark:text-amber-300">
          Methodological Limitations — Signals Are Hypotheses, Not Causal Findings
        </p>
        <p className="mt-1 text-[var(--muted)]">
          Spontaneous adverse event reports suffer from under-reporting, stimulated reporting
          (Weber effect / publicity bias), missing clinical detail,{" "}
          <strong>no exposure denominator</strong> (true number of patients taking the drug is
          unknown), and <strong>confounding by indication</strong>. Disproportionality, stratified
          Mantel–Haenszel, and Weibull time-to-onset metrics generate quantitative hypotheses for
          pharmacovigilance review and do not establish causation or incidence.
        </p>
      </div>

      {/* 1. Case De-duplication & Probable-Duplicate Impact Panel */}
      <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              Case De-duplication &amp; Probable-Duplicate Review
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Version deduplication (`caseid` / `caseversion` rule):{" "}
              <strong>{dup.superseded_versions_dropped}</strong> superseded case version(s) dropped
              automatically. Cross-`caseid` probable-duplicate scoring flagged{" "}
              <strong>{dup.flagged_pairs.length}</strong> report pair(s) (involving{" "}
              <strong>{dup.flagged_secondary_primaryids.length}</strong> secondary report(s)) for
              human review.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs font-medium">
              <input
                type="checkbox"
                checked={excludeFlaggedDuplicates}
                onChange={(e) => setExcludeFlaggedDuplicates(e.target.checked)}
              />
              Exclude flagged probable duplicates ({dup.flagged_secondary_primaryids.length})
            </label>
            {dup.flagged_pairs.length > 0 && (
              <button
                type="button"
                onClick={() => setShowDuplicateTable((v) => !v)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--border)]/30"
              >
                {showDuplicateTable
                  ? "Hide Flagged Pairs"
                  : `Inspect Flagged Pairs (${dup.flagged_pairs.length})`}
              </button>
            )}
          </div>
        </div>

        {/* Signal Count Comparison: All Cases vs Flagged Duplicates Excluded */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          {[
            {
              label: "Unique Cases",
              base: dup.baseline_counts.cases,
              dedup: dup.excluded_counts.cases,
            },
            {
              label: "PRR Signals",
              base: dup.baseline_counts.signals_prr,
              dedup: dup.excluded_counts.signals_prr,
            },
            {
              label: "BCPNN (IC025>0)",
              base: dup.baseline_counts.signals_bcpnn,
              dedup: dup.excluded_counts.signals_bcpnn,
            },
            {
              label: "EBGM (EB05>2)",
              base: dup.baseline_counts.signals_ebgm,
              dedup: dup.excluded_counts.signals_ebgm,
            },
            {
              label: "FDR (q<0.05 & PRR≥2)",
              base: dup.baseline_counts.signals_fdr,
              dedup: dup.excluded_counts.signals_fdr,
            },
          ].map((item) => {
            const delta = item.dedup - item.base;
            return (
              <div
                key={item.label}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              >
                <p className="text-[11px] text-[var(--muted)]">{item.label}</p>
                <p className="mt-0.5 font-mono text-sm font-semibold">
                  {excludeFlaggedDuplicates ? item.dedup : item.base}{" "}
                  <span className="text-xs font-normal text-[var(--muted)]">
                    (base {item.base} → excl {item.dedup}
                    {delta !== 0 ? `, Δ=${delta > 0 ? `+${delta}` : delta}` : ""})
                  </span>
                </p>
              </div>
            );
          })}
        </div>

        {showDuplicateTable && dup.flagged_pairs.length > 0 && (
          <div className="mt-4 max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg)]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] font-mono text-[10px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="p-2">Primary ID A (caseid)</th>
                  <th className="p-2">Primary ID B (caseid)</th>
                  <th className="p-2 text-right">Score</th>
                  <th className="p-2">Matching Fields</th>
                  <th className="p-2">Shared Suspect Drugs</th>
                  <th className="p-2">Shared Reactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/50">
                {dup.flagged_pairs.map((p) => (
                  <tr key={`${p.primaryid_a}-${p.primaryid_b}`}>
                    <td className="p-2 font-mono">
                      {p.primaryid_a} ({p.caseid_a})
                    </td>
                    <td className="p-2 font-mono">
                      {p.primaryid_b} ({p.caseid_b})
                    </td>
                    <td className="p-2 text-right font-mono font-semibold">
                      {(p.score * 100).toFixed(1)}%
                    </td>
                    <td className="p-2 font-mono text-[11px]">{p.matching_fields.join(", ")}</td>
                    <td className="p-2">{p.shared_drugs.join(", ")}</td>
                    <td className="p-2">{p.shared_reactions.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. Filter & Multiple-Testing Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Min cases{" "}
          <input
            type="number"
            min={1}
            value={minCases}
            onChange={(e) => setMinCases(Number(e.target.value) || 3)}
            className="ml-1.5 w-16 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
          />
        </label>

        <input
          placeholder="Filter drug or event…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
        />

        <label className="text-sm">
          BH FDR q-value{" "}
          <select
            value={fdrFilter}
            onChange={(e) => setFdrFilter(e.target.value as "all" | "0.05" | "0.01" | "0.10")}
            className="ml-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
          >
            <option value="all">All q-values</option>
            <option value="0.05">q &lt; 0.05 (5% FDR)</option>
            <option value="0.01">q &lt; 0.01 (1% FDR)</option>
            <option value="0.10">q &lt; 0.10 (10% FDR)</option>
          </select>
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={onlySignals}
            onChange={(e) => setOnlySignals(e.target.checked)}
          />
          Any method flagged
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={onlyConfounded}
            onChange={(e) => setOnlyConfounded(e.target.checked)}
          />
          Pooled vs MH-adjusted disagree (≥20%)
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={onlyWithWeibull}
            onChange={(e) => setOnlyWithWeibull(e.target.checked)}
          />
          Has Weibull TTO fit (n≥10)
        </label>

        <select
          value={sortKey}
          onChange={(e) =>
            setSortKey(e.target.value as "priority_rank" | "PRR" | "q_value" | "EB05")
          }
          className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
        >
          <option value="priority_rank">Sort by ML rank</option>
          <option value="PRR">Sort by PRR</option>
          <option value="q_value">Sort by BH q-value</option>
          <option value="EB05">Sort by EB05</option>
        </select>

        <button
          type="button"
          onClick={exportCsv}
          className="rounded-xl bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white"
        >
          Export CSV
        </button>
      </div>

      <HelpTip>
        PRR signal: PRR ≥ 2, χ² ≥ 4, cases ≥ min. FDR signal: Benjamini–Hochberg q &lt; 0.05 and PRR
        ≥ 2. BCPNN: IC025 &gt; 0. EBGM: EB05 &gt; 2 (Gamma prior α={analysis.prior.alpha.toFixed(2)},
        β={analysis.prior.beta.toFixed(2)}). Click any row below to inspect its Age × Sex
        Mantel–Haenszel stratification and Weibull time-to-onset fit.
      </HelpTip>

      {/* 3. Selected Pair Deep-Dive: Stratified Mantel-Haenszel & Weibull Time-to-Onset */}
      {selectedSignal && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* A. Stratified Analysis (Age Band & Sex + Mantel-Haenszel) */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div>
                <p className="font-mono text-[11px] uppercase text-[var(--muted)]">
                  Stratified Analysis (Age Band &amp; Sex · Mantel–Haenszel)
                </p>
                <h3 className="text-base font-semibold">
                  {selectedSignal.drug} → {selectedSignal.adverse_event}
                </h3>
              </div>
              {selStrat?.confounding_flagged ? (
                <Badge tone="warn">
                  Pooled vs MH shift: {selStrat.prr_change_pct?.toFixed(1)}%
                </Badge>
              ) : (
                <Badge tone="default">Strata consistent</Badge>
              )}
            </div>

            {selStrat && (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                    <p className="text-[11px] text-[var(--muted)]">Pooled vs MH PRR</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold">
                      {selStrat.pooled_PRR} → {selStrat.adjusted_PRR_MH ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                    <p className="text-[11px] text-[var(--muted)]">Pooled vs MH ROR</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold">
                      {selStrat.pooled_ROR} → {selStrat.adjusted_ROR_MH ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                    <p className="text-[11px] text-[var(--muted)]">Pooled vs Stratified IC</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold">
                      {selStrat.pooled_IC} → {selStrat.stratified_IC ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[var(--border)] font-mono text-[10px] uppercase text-[var(--muted)]">
                      <tr>
                        <th className="py-1.5">Stratum</th>
                        <th className="py-1.5 text-right">Cases (a)</th>
                        <th className="py-1.5 text-right">Stratum N</th>
                        <th className="py-1.5 text-right">PRR</th>
                        <th className="py-1.5 text-right">IC (IC025)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/40 font-mono text-[11px]">
                      {selStrat.by_age_band.map((st) => (
                        <tr key={`age-${st.stratum}`}>
                          <td className="py-1">Age {st.stratum}</td>
                          <td className="py-1 text-right">{st.a}</td>
                          <td className="py-1 text-right">{st.n_total}</td>
                          <td className="py-1 text-right">{st.PRR ?? "—"}</td>
                          <td className="py-1 text-right">
                            {st.IC} ({st.IC025})
                          </td>
                        </tr>
                      ))}
                      {selStrat.by_sex.map((st) => (
                        <tr key={`sex-${st.stratum}`}>
                          <td className="py-1">Sex {st.stratum}</td>
                          <td className="py-1 text-right">{st.a}</td>
                          <td className="py-1 text-right">{st.n_total}</td>
                          <td className="py-1 text-right">{st.PRR ?? "—"}</td>
                          <td className="py-1 text-right">
                            {st.IC} ({st.IC025})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* B. Weibull Time-to-Onset Distribution Fit (when n >= 10) */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div>
                <p className="font-mono text-[11px] uppercase text-[var(--muted)]">
                  Weibull Time-to-Onset Distribution (THER.start_dt → DEMO.event_dt)
                </p>
                <h3 className="text-base font-semibold">
                  {selectedSignal.drug} → {selectedSignal.adverse_event}
                </h3>
              </div>
              {selWeibull ? (
                <Badge tone="ok">
                  k = {selWeibull.shape_k.toFixed(2)} ({selWeibull.regime.replace("_", " ")})
                </Badge>
              ) : (
                <Badge tone="default">Requires ≥10 onset times</Badge>
              )}
            </div>

            {!selWeibull ? (
              <p className="mt-4 text-xs text-[var(--muted)]">
                This drug–event pair has fewer than 10 valid time-to-onset observations in{" "}
                <code>THER</code> / <code>DEMO</code>. Select a pair with ≥10 onset times (or check{" "}
                <em>&ldquo;Has Weibull TTO fit (n≥10)&rdquo;</em> above) to view the fitted Weibull
                shape parameter, 95% confidence interval, hazard regime, and distribution curves.
              </p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                    <p className="text-[11px] text-[var(--muted)]">Shape k (95% CI)</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold">
                      {selWeibull.shape_k.toFixed(2)} [{selWeibull.shape_ci_low.toFixed(2)},{" "}
                      {selWeibull.shape_ci_high.toFixed(2)}]
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                    <p className="text-[11px] text-[var(--muted)]">Scale λ / Sample n</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold">
                      {selWeibull.scale_lambda} d (n={selWeibull.n_cases_with_tto})
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                    <p className="text-[11px] text-[var(--muted)]">Median (IQR) Onset</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold">
                      {selWeibull.median_days} d ({selWeibull.iqr_low}–{selWeibull.iqr_high} d)
                    </p>
                  </div>
                </div>

                <p className="mt-2 text-xs text-[var(--muted)]">{selWeibull.interpretation}</p>

                <div className="mt-3 h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selWeibull.curve}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10 }}
                        label={{ value: "Days from start_dt", position: "insideBottom", offset: -2, fontSize: 10 }}
                      />
                      <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="fitted_cdf"
                        name="Weibull Fitted CDF"
                        stroke="#1a7ff5"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="empirical_cdf"
                        name="Empirical CDF"
                        stroke="#10b981"
                        strokeWidth={1.5}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="survival"
                        name="Survival S(t)"
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 4. Main Signals Table */}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="p-3">Drug</th>
              <th>Event</th>
              <th className="text-right">Cases</th>
              <th className="text-right">PRR (MH)</th>
              <th className="text-right">χ²</th>
              <th className="text-right">p-value</th>
              <th className="text-right">BH q-value</th>
              <th className="text-right">IC025</th>
              <th className="text-right">EBGM (EB05)</th>
              <th className="text-right">Weibull k</th>
              <th className="text-right">Rank</th>
              <th className="p-3">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const key = `${s.drug}|${s.adverse_event}`;
              const isSelected = selKey === key;
              return (
                <tr
                  key={key}
                  onClick={() => setSelectedPairKey(key)}
                  className={`cursor-pointer border-b border-[var(--border)]/50 transition ${
                    isSelected ? "bg-brand-600/10" : "hover:bg-[var(--card)]/60"
                  }`}
                >
                  <td className="p-3 font-medium">{s.drug}</td>
                  <td>{s.adverse_event}</td>
                  <td className="text-right font-mono">{s.case_count_a}</td>
                  <td className="text-right font-mono">
                    {s.PRR}{" "}
                    <span className="text-xs text-[var(--muted)]">({s.PRR_MH ?? "—"})</span>
                  </td>
                  <td className="text-right font-mono">{s.chi_square}</td>
                  <td className="text-right font-mono text-xs">{s.p_value.toExponential(2)}</td>
                  <td className="text-right font-mono text-xs font-semibold">
                    {s.q_value < 0.001 ? s.q_value.toExponential(2) : s.q_value.toFixed(4)}
                  </td>
                  <td className="text-right font-mono">{s.IC025}</td>
                  <td className="text-right font-mono">
                    {s.EBGM} <span className="text-xs text-[var(--muted)]">({s.EB05})</span>
                  </td>
                  <td className="text-right font-mono text-xs">
                    {s.weibull_shape != null ? `${s.weibull_shape.toFixed(2)}` : "—"}
                  </td>
                  <td className="text-right font-mono">#{s.priority_rank}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {s.signal_detected && <Badge tone="ok">PRR</Badge>}
                      {s.signal_fdr && <Badge tone="ok">FDR q&lt;0.05</Badge>}
                      {s.signal_bcpnn && <Badge tone="ok">BCPNN</Badge>}
                      {s.signal_ebgm && <Badge tone="ok">EBGM</Badge>}
                      {s.confounding_flagged && <Badge tone="warn">MH Shift</Badge>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
