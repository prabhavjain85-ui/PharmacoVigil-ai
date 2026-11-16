"use client";

import { useMemo, useState } from "react";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";
import { useData } from "@/lib/context/DataContext";
import type { MaskingCheckSummary, MaskingShiftRow } from "@/lib/pipeline/types";
import scaleBenchmarkData from "../../../evaluation/scale_benchmark_results.json";
import timeIndexedData from "../../../evaluation/time_indexed_evaluation.json";

export function ScaleMaskingView() {
  const { analysis } = useData();
  const [maskingSource, setMaskingSource] = useState<"active" | "2024q2">("active");
  const [changeFilter, setChangeFilter] = useState<"all" | "unmasked_new_signal" | "unmasked_lost_signal">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCutoff, setSelectedCutoff] = useState<string>("20240515");

  const activeMasking: MaskingCheckSummary | undefined = useMemo(() => {
    if (maskingSource === "2024q2") {
      const m = scaleBenchmarkData.masking_check;
      return {
        top_k_drugs: m.top_k_drugs,
        removed_drugs: m.removed_drugs,
        baseline_total_reports: m.baseline_total_reports,
        unmasked_total_reports: m.unmasked_total_reports,
        pairs_evaluated: m.pairs_evaluated,
        status_changed_count: m.status_changed_count,
        newly_unmasked_count: m.newly_unmasked_count,
        de_flagged_count: m.de_flagged_count,
        status_changed_pairs: m.top_status_changed_pairs as MaskingShiftRow[],
      };
    }
    return analysis?.masking;
  }, [analysis?.masking, maskingSource]);

  const filteredMaskingPairs: MaskingShiftRow[] = useMemo(() => {
    if (!activeMasking) return [];
    let list = [...activeMasking.status_changed_pairs];
    if (changeFilter !== "all") {
      list = list.filter((r) => r.change_type === changeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.drug.toLowerCase().includes(q) ||
          r.adverse_event.toLowerCase().includes(q),
      );
    }
    return list;
  }, [activeMasking, changeFilter, searchQuery]);

  const timeIndexedPairs = useMemo(() => {
    const cutoffObj = timeIndexedData.cutoffs.find((c) => c.cutoff_date === "20240515");
    return cutoffObj?.pairs ?? [];
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Scale, Competition-Bias (Masking) & Time-Indexed Validation"
        hint="Full-quarter FDA FAERS (2024Q2, 5.75M rows) scale benchmark, competition-bias (masking) sensitivity check removing top-K background drugs, and historical event_dt cutoff evaluation against published time-indexed controls."
      />

      {/* Section 1: Competition-Bias (Masking) Analysis */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">
              1. Competition-Bias (Masking) Sensitivity Check
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
              Extremely high-volume drugs (e.g., biologics with patient-support program reporting)
              can inflate background event totals <code className="font-mono">c</code> in the 2×2
              table and mask disproportionality signals for other drugs sharing those reactions.
              This check removes the top-5 most-reported drugs from the background cohort and
              recomputes <code className="font-mono">PRR</code>,{" "}
              <code className="font-mono">ROR</code>, <code className="font-mono">IC025</code>, and{" "}
              <code className="font-mono">EB05</code>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMaskingSource("active")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition ${
                maskingSource === "active"
                  ? "bg-brand-600 text-white"
                  : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              Active Dataset ({analysis?.masking?.baseline_total_reports.toLocaleString() ?? 0} cases)
            </button>
            <button
              type="button"
              onClick={() => setMaskingSource("2024q2")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition ${
                maskingSource === "2024q2"
                  ? "bg-brand-600 text-white"
                  : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              Full 2024Q2 FAERS Benchmark (397,119 cases)
            </button>
          </div>
        </div>

        {activeMasking ? (
          <div className="mt-5 space-y-5">
            {/* KPI summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
                <div className="text-xs text-[var(--muted)]">Baseline → Unmasked Cases</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  {activeMasking.baseline_total_reports.toLocaleString()} →{" "}
                  {activeMasking.unmasked_total_reports.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
                <div className="text-xs text-[var(--muted)]">Remaining Pairs Evaluated</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  {activeMasking.pairs_evaluated.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
                <div className="text-xs text-[var(--muted)]">Total Status Changes</div>
                <div className="mt-1 font-mono text-base font-semibold text-amber-600 dark:text-amber-400">
                  {activeMasking.status_changed_count.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
                <div className="text-xs text-[var(--muted)]">Newly Unmasked Signals</div>
                <div className="mt-1 font-mono text-base font-semibold text-emerald-600 dark:text-emerald-400">
                  +{activeMasking.newly_unmasked_count.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
                <div className="text-xs text-[var(--muted)]">De-flagged Signals</div>
                <div className="mt-1 font-mono text-base font-semibold text-rose-600 dark:text-rose-400">
                  -{activeMasking.de_flagged_count.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Removed Top-5 Drugs */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/30 p-3.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Top-{activeMasking.top_k_drugs} High-Volume Drugs Removed from Background Cohort
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {activeMasking.removed_drugs.map((d, idx) => (
                  <div
                    key={d.drug}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[var(--muted)]">#{idx + 1}</span>
                    <span className="font-semibold">{d.drug}</span>
                    <span className="font-mono text-[var(--muted)]">
                      {d.report_count.toLocaleString()} reports ({d.share_of_reports_pct}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Controls for shifted pairs table */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChangeFilter("all")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium cursor-pointer ${
                    changeFilter === "all"
                      ? "bg-brand-600 text-white"
                      : "border border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  All Status Changes ({activeMasking.status_changed_pairs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setChangeFilter("unmasked_new_signal")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium cursor-pointer ${
                    changeFilter === "unmasked_new_signal"
                      ? "bg-emerald-600 text-white"
                      : "border border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  Newly Unmasked Signals
                </button>
                <button
                  type="button"
                  onClick={() => setChangeFilter("unmasked_lost_signal")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium cursor-pointer ${
                    changeFilter === "unmasked_lost_signal"
                      ? "bg-rose-600 text-white"
                      : "border border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  De-flagged After Unmasking
                </button>
              </div>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter drug or adverse event..."
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs"
              />
            </div>

            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] bg-[var(--bg)]/60 text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2.5">Drug</th>
                    <th className="px-3 py-2.5">Adverse Event (PT)</th>
                    <th className="px-3 py-2.5 text-right">Cases (a)</th>
                    <th className="px-3 py-2.5">Shift Direction</th>
                    <th className="px-3 py-2.5 text-right">PRR (Base → Unmasked)</th>
                    <th className="px-3 py-2.5 text-right">IC025 (Base → Unmasked)</th>
                    <th className="px-3 py-2.5 text-right">EB05 (Base → Unmasked)</th>
                    <th className="px-3 py-2.5">Detectors Flipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredMaskingPairs.slice(0, 30).map((row) => (
                    <tr
                      key={`${row.drug}|${row.adverse_event}`}
                      className="hover:bg-[var(--border)]/20"
                    >
                      <td className="px-3 py-2 font-medium">{row.drug}</td>
                      <td className="px-3 py-2">{row.adverse_event}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.case_count_a}</td>
                      <td className="px-3 py-2">
                        {row.change_type === "unmasked_new_signal" ? (
                          <Badge tone="ok">Unmasked (+Signal)</Badge>
                        ) : (
                          <Badge tone="warn">De-flagged (-Signal)</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.baseline_PRR.toFixed(2)} →{" "}
                        <span className="font-semibold">{row.unmasked_PRR.toFixed(2)}</span>{" "}
                        <span
                          className={
                            row.delta_PRR >= 0 ? "text-emerald-600" : "text-rose-600"
                          }
                        >
                          ({row.delta_PRR >= 0 ? "+" : ""}
                          {row.delta_PRR.toFixed(2)})
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.baseline_IC025.toFixed(2)} →{" "}
                        <span className="font-semibold">{row.unmasked_IC025.toFixed(2)}</span>{" "}
                        <span
                          className={
                            row.delta_IC025 >= 0 ? "text-emerald-600" : "text-rose-600"
                          }
                        >
                          ({row.delta_IC025 >= 0 ? "+" : ""}
                          {row.delta_IC025.toFixed(2)})
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.baseline_EB05.toFixed(2)} →{" "}
                        <span className="font-semibold">{row.unmasked_EB05.toFixed(2)}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {[
                          row.baseline_signal_prr !== row.unmasked_signal_prr
                            ? `PRR:${row.baseline_signal_prr ? "1→0" : "0→1"}`
                            : null,
                          row.baseline_signal_bcpnn !== row.unmasked_signal_bcpnn
                            ? `IC025:${row.baseline_signal_bcpnn ? "1→0" : "0→1"}`
                            : null,
                          row.baseline_signal_ebgm !== row.unmasked_signal_ebgm
                            ? `EB05:${row.baseline_signal_ebgm ? "1→0" : "0→1"}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </td>
                    </tr>
                  ))}
                  {filteredMaskingPairs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-[var(--muted)]">
                        No pairs changed signal status under the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Run or load a dataset to inspect competition-bias masking results.
          </p>
        )}
      </section>

      {/* Section 2: Full-Quarter 2024Q2 Scale Benchmark */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
        <h2 className="font-display text-xl font-semibold">
          2. Full-Quarter FDA FAERS ({scaleBenchmarkData.quarter}) Scale Benchmark
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          End-to-end execution of the TypeScript pharmacovigilance pipeline (
          <code className="font-mono">scripts/benchmark_full_quarter.mjs</code>) across all 6 raw
          FDA FAERS <code className="font-mono">2024Q2</code> ASCII tables without row truncation.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
            <div className="text-xs text-[var(--muted)]">Total ASCII Rows</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {scaleBenchmarkData.row_counts.total_table_rows.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
            <div className="text-xs text-[var(--muted)]">Deduplicated Cases</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {scaleBenchmarkData.row_counts.deduplicated_cases.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
            <div className="text-xs text-[var(--muted)]">Case-Level Pairs</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {scaleBenchmarkData.row_counts.case_drug_event_pairs.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
            <div className="text-xs text-[var(--muted)]">Signals (a ≥ 3)</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {scaleBenchmarkData.row_counts.eligible_pairs_min_cases_3.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
            <div className="text-xs text-[var(--muted)]">Parse + Analysis Time</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {scaleBenchmarkData.timings.parse_time_sec}s +{" "}
              {scaleBenchmarkData.timings.analysis_time_sec}s
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3">
            <div className="text-xs text-[var(--muted)]">Peak Heap / RSS</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {scaleBenchmarkData.memory.peak_heap_used_mb} /{" "}
              {scaleBenchmarkData.memory.peak_rss_mb} MB
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/30 p-3.5 text-xs">
            <div className="font-semibold uppercase tracking-wider text-[var(--muted)]">
              2024Q2 Table Row Breakdown
            </div>
            <div className="mt-2 grid grid-cols-2 gap-y-1.5 font-mono">
              <span>DEMO24Q2:</span>
              <span className="text-right">
                {scaleBenchmarkData.row_counts.demo_rows.toLocaleString()}
              </span>
              <span>DRUG24Q2:</span>
              <span className="text-right">
                {scaleBenchmarkData.row_counts.drug_rows.toLocaleString()}
              </span>
              <span>REAC24Q2:</span>
              <span className="text-right">
                {scaleBenchmarkData.row_counts.reac_rows.toLocaleString()}
              </span>
              <span>OUTC24Q2:</span>
              <span className="text-right">
                {scaleBenchmarkData.row_counts.outc_rows.toLocaleString()}
              </span>
              <span>INDI24Q2:</span>
              <span className="text-right">
                {scaleBenchmarkData.row_counts.indi_rows.toLocaleString()}
              </span>
              <span>THER24Q2:</span>
              <span className="text-right">
                {scaleBenchmarkData.row_counts.ther_rows.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/30 p-3.5 text-xs">
            <div className="font-semibold uppercase tracking-wider text-[var(--muted)]">
              2024Q2 Detector & Statistical Output Counts
            </div>
            <div className="mt-2 grid grid-cols-2 gap-y-1.5 font-mono">
              <span>PRR Signals (PRR ≥ 2, χ² ≥ 4):</span>
              <span className="text-right">
                {scaleBenchmarkData.signal_counts.signals_prr.toLocaleString()}
              </span>
              <span>BCPNN Signals (IC025 &gt; 0):</span>
              <span className="text-right">
                {scaleBenchmarkData.signal_counts.signals_bcpnn.toLocaleString()}
              </span>
              <span>MGPS Signals (EB05 ≥ 2):</span>
              <span className="text-right">
                {scaleBenchmarkData.signal_counts.signals_ebgm.toLocaleString()}
              </span>
              <span>BH-FDR Signals (q &lt; 0.05):</span>
              <span className="text-right">
                {scaleBenchmarkData.signal_counts.signals_fdr.toLocaleString()}
              </span>
              <span>Weibull TTO Fitted Pairs:</span>
              <span className="text-right">
                {scaleBenchmarkData.signal_counts.weibull_pairs_fitted.toLocaleString()}
              </span>
              <span>Masking Status Changes (Top 5):</span>
              <span className="text-right">
                {scaleBenchmarkData.masking_check.status_changed_count.toLocaleString()} (+
                {scaleBenchmarkData.masking_check.newly_unmasked_count.toLocaleString()} unmasked)
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Time-Indexed Historical Evaluation */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">
              3. Time-Indexed Historical Cutoff Evaluation
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
              {timeIndexedData.methodology}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {timeIndexedData.cutoffs.map((c) => (
              <button
                key={c.cutoff_date}
                type="button"
                onClick={() => setSelectedCutoff(c.cutoff_date)}
                className={`rounded-lg px-2.5 py-1 text-xs font-mono font-medium cursor-pointer ${
                  selectedCutoff === c.cutoff_date
                    ? "bg-brand-600 text-white"
                    : "border border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                ≤ {c.cutoff_date}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--border)] bg-[var(--bg)]/60 text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2.5">Historical Cutoff (event_dt ≤)</th>
                <th className="px-3 py-2.5 text-right">Pre-Cutoff Cases</th>
                <th className="px-3 py-2.5 text-right">Scored Controls (a ≥ 3)</th>
                <th className="px-3 py-2.5 text-right">PRR Sens / Spec / PPV</th>
                <th className="px-3 py-2.5 text-right">BCPNN Sens / Spec / PPV</th>
                <th className="px-3 py-2.5 text-right">MGPS EB05 Sens / Spec / PPV</th>
                <th className="px-3 py-2.5 text-right">IC025 ROC-AUC</th>
                <th className="px-3 py-2.5 text-right">ML Prioritizer ROC-AUC / PR-AUC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] font-mono">
              {timeIndexedData.cutoffs.map((c) => {
                const prr = c.detectors.PRR_ge_2_chi2_ge_4;
                const bcp = c.detectors.BCPNN_IC025_gt_0;
                const ebgm = c.detectors.MGPS_EB05_ge_2;
                return (
                  <tr
                    key={c.cutoff_date}
                    className={
                      selectedCutoff === c.cutoff_date
                        ? "bg-brand-600/10 font-medium"
                        : "hover:bg-[var(--border)]/20"
                    }
                  >
                    <td className="px-3 py-2.5">{c.cutoff_date}</td>
                    <td className="px-3 py-2.5 text-right">
                      {c.cases_with_event_dt_le_cutoff.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {c.reference_controls_scored_ge_min_cases}/{c.reference_controls_total} (+
                      {c.reference_positives_scored}/-{c.reference_negatives_scored})
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {(prr.sensitivity_among_scored * 100).toFixed(1)}% /{" "}
                      {(prr.specificity_among_scored * 100).toFixed(1)}% /{" "}
                      {(prr.ppv * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {(bcp.sensitivity_among_scored * 100).toFixed(1)}% /{" "}
                      {(bcp.specificity_among_scored * 100).toFixed(1)}% /{" "}
                      {(bcp.ppv * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {(ebgm.sensitivity_among_scored * 100).toFixed(1)}% /{" "}
                      {(ebgm.specificity_among_scored * 100).toFixed(1)}% /{" "}
                      {(ebgm.ppv * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {c.ranking_metrics_on_scored.bcpnn_ic025_auc?.toFixed(4)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-brand-600 dark:text-brand-400">
                      {c.ranking_metrics_on_scored.ml_prioritizer_auc?.toFixed(4)} /{" "}
                      {c.ranking_metrics_on_scored.ml_prioritizer_ap?.toFixed(4)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Scored Time-Indexed Reference Controls at Historical Cutoff event_dt ≤ 20240515
          </div>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--card)] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Drug</th>
                  <th className="px-3 py-2">Adverse Event</th>
                  <th className="px-3 py-2">Control Type</th>
                  <th className="px-3 py-2 text-right">Pre-Cutoff Cases</th>
                  <th className="px-3 py-2 text-right">PRR</th>
                  <th className="px-3 py-2 text-right">IC025</th>
                  <th className="px-3 py-2 text-right">EB05</th>
                  <th className="px-3 py-2 text-right">ML Score</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {timeIndexedPairs
                  .filter((p) => p.present_ge_min_cases)
                  .map((p) => (
                    <tr key={`${p.drug}|${p.adverse_event}`} className="hover:bg-[var(--border)]/20">
                      <td className="px-3 py-1.5 font-medium">{p.drug}</td>
                      <td className="px-3 py-1.5">{p.adverse_event}</td>
                      <td className="px-3 py-1.5">
                        {p.label === 1 ? (
                          <Badge tone="ok">Positive (1)</Badge>
                        ) : (
                          <Badge tone="default">Negative (0)</Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{p.case_count_a}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {p.PRR !== null ? p.PRR.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {p.IC025 !== null ? p.IC025.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {p.EB05 !== null ? p.EB05.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold">
                        {p.priority_score !== null ? p.priority_score.toFixed(3) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--muted)]">{p.source}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <HelpTip>
          Note: MGPS (<code className="font-mono">EB05 ≥ 2</code>) achieves higher specificity (
          <code className="font-mono">64.3%–69.2%</code> vs.{" "}
          <code className="font-mono">46.2%–57.1%</code> for PRR/BCPNN) and higher PPV (
          <code className="font-mono">82.1%–84.0%</code>) across historical cutoffs due to empirical
          Bayes shrinkage toward the prior on low-count cells.
        </HelpTip>
      </section>
    </div>
  );
}
