"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useData } from "@/lib/context/DataContext";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";
import { computeTemporalSignalSeries } from "@/lib/pipeline/analyze";

export function TrendsView() {
  const { analysis } = useData();
  const [selectedDrug, setSelectedDrug] = useState<string>("");
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [granularity, setGranularity] = useState<"month" | "quarter">("quarter");

  const drugs = useMemo(() => {
    if (!analysis) return [];
    return [...new Set(analysis.signals.map((s) => s.drug))].sort();
  }, [analysis]);

  const activeDrug = selectedDrug && drugs.includes(selectedDrug) ? selectedDrug : drugs[0] ?? "";

  const eventsForDrug = useMemo(() => {
    if (!analysis || !activeDrug) return [];
    return analysis.signals
      .filter((s) => s.drug === activeDrug)
      .sort((a, b) => b.case_count_a - a.case_count_a)
      .map((s) => s.adverse_event);
  }, [analysis, activeDrug]);

  const activeEvent =
    selectedEvent && eventsForDrug.includes(selectedEvent)
      ? selectedEvent
      : eventsForDrug[0] ?? "";

  const temporalSeries = useMemo(() => {
    if (!analysis || !activeDrug || !activeEvent) return null;
    return computeTemporalSignalSeries(analysis.pairs, activeDrug, activeEvent, granularity);
  }, [analysis, activeDrug, activeEvent, granularity]);

  if (!analysis) return null;

  const hasDates = analysis.pairs.some((p) => p.event_dt && p.event_dt.length >= 6);

  return (
    <>
      <PageHeader
        title="Temporal signal evolution & change-point detection"
        hint="Cumulative Bayesian Information Component (IC) with 95% credible intervals over calendar months or quarters, date of first signal emergence (IC025 > 0), and sequential change-point detection on reporting rates."
      />

      {/* Methodological Limitations Banner */}
      <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-[var(--fg)]">
        <strong className="font-semibold text-amber-800 dark:text-amber-300">
          Methodological Limitations (Spontaneous Reporting):
        </strong>{" "}
        Temporal spikes in FAERS reporting rates reflect notoriety bias (Weber effect, regulatory advisories, media coverage, litigation), secular changes in prescribing volume without an exposed-patient denominator, and confounding by indication. Temporal disproportionality and change-points generate <strong>hypotheses for clinical review, not causal findings</strong>.
      </div>

      {!hasDates && (
        <p className="text-[var(--muted)]">No valid DEMO.event_dt dates in the current dataset.</p>
      )}

      {/* Controls */}
      <div className="glass rounded-2xl p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-[var(--muted)]">Suspect drug</span>
            <select
              value={activeDrug}
              onChange={(e) => {
                setSelectedDrug(e.target.value);
                setSelectedEvent("");
              }}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            >
              {drugs.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-[var(--muted)]">Adverse event (PT)</span>
            <select
              value={activeEvent}
              onChange={(e) => setSelectedEvent(e.target.value)}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            >
              {eventsForDrug.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-[var(--muted)]">Time granularity</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setGranularity("quarter")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${
                  granularity === "quarter"
                    ? "border-brand-500 bg-brand-600 text-white"
                    : "border-[var(--border)] bg-[var(--bg)]"
                }`}
              >
                Quarter (YYYY-Q#)
              </button>
              <button
                type="button"
                onClick={() => setGranularity("month")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${
                  granularity === "month"
                    ? "border-brand-500 bg-brand-600 text-white"
                    : "border-[var(--border)] bg-[var(--bg)]"
                }`}
              >
                Month (YYYY-MM)
              </button>
            </div>
          </div>
        </div>

        {/* Summary metrics for selected pair */}
        {temporalSeries && (
          <div className="mt-5 grid gap-4 border-t border-[var(--border)]/60 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[var(--border)]/60 p-3">
              <p className="text-xs uppercase text-[var(--muted)]">First IC025 &gt; 0 (Signal Emergence)</p>
              <p className="mt-1 font-mono text-lg font-semibold">
                {temporalSeries.first_ic025_gt0_period ?? "Not crossed"}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {temporalSeries.first_ic025_gt0_period
                  ? "Earliest period lower 95% bound exceeded 0"
                  : "Cumulative IC025 remained ≤ 0 across all periods"}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)]/60 p-3">
              <p className="text-xs uppercase text-[var(--muted)]">Change-point detected</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-lg font-semibold">
                  {temporalSeries.changepoint_detected
                    ? temporalSeries.changepoint_period
                    : "None (G² < 6.63)"}
                </span>
                {temporalSeries.changepoint_detected ? (
                  <Badge tone="warn">p = {temporalSeries.changepoint_p_value.toFixed(4)}</Badge>
                ) : (
                  <Badge>Stable</Badge>
                )}
              </div>
              <p className="text-xs text-[var(--muted)]">
                Max 2-segment Poisson LLR G² = {temporalSeries.changepoint_llr.toFixed(2)}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)]/60 p-3">
              <p className="text-xs uppercase text-[var(--muted)]">Pre vs. Post reporting rate</p>
              <p className="mt-1 font-mono text-lg font-semibold">
                {temporalSeries.points.length > 1
                  ? `${(temporalSeries.pre_rate * 100).toFixed(1)}% → ${(temporalSeries.post_rate * 100).toFixed(1)}%`
                  : "—"}
              </p>
              <p className="text-xs text-[var(--muted)]">
                Share of drug reports citing {activeEvent}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)]/60 p-3">
              <p className="text-xs uppercase text-[var(--muted)]">Final cumulative IC [95% CI]</p>
              {temporalSeries.points.length > 0 ? (
                <>
                  <p className="mt-1 font-mono text-lg font-semibold">
                    {temporalSeries.points[temporalSeries.points.length - 1].cum_ic.toFixed(2)}{" "}
                    <span className="text-xs font-normal text-[var(--muted)]">
                      [{temporalSeries.points[temporalSeries.points.length - 1].cum_ic025.toFixed(2)},{" "}
                      {temporalSeries.points[temporalSeries.points.length - 1].cum_ic975.toFixed(2)}]
                    </span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Cumulative a = {temporalSeries.points[temporalSeries.points.length - 1].cum_a} across{" "}
                    {temporalSeries.points.length} periods
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted)]">No dated reports</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chart 1: Cumulative IC & 95% Credible Interval */}
      {temporalSeries && temporalSeries.points.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="glass rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold">
                Cumulative Information Component (IC) &amp; 95% Interval
              </h2>
              {temporalSeries.first_ic025_gt0_period && (
                <Badge tone="ok">First IC025 &gt; 0: {temporalSeries.first_ic025_gt0_period}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Solid blue: posterior mean cumulative IC. Emerald line: lower 95% credible bound (IC025). Dashed slate: upper 95% bound (IC975). A BCPNN signal emerges when IC025 crosses above 0.
            </p>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={temporalSeries.points}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "IC = 0", fontSize: 10 }} />
                  {temporalSeries.first_ic025_gt0_period && (
                    <ReferenceLine
                      x={temporalSeries.first_ic025_gt0_period}
                      stroke="#10b981"
                      strokeDasharray="3 3"
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="cum_ic975"
                    name="Cumulative IC975 (Upper 95%)"
                    stroke="#94a3b8"
                    strokeDasharray="4 2"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="cum_ic"
                    name="Cumulative IC"
                    stroke="#1a7ff5"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cum_ic025"
                    name="Cumulative IC025 (Lower 95%)"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Period Reporting Rate & Change-point Statistics (Poisson LLR G² & CUSUM) */}
          <div className="glass rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold">
                Reporting Rate &amp; Change-Point Statistics (G² / CUSUM)
              </h2>
              {temporalSeries.changepoint_period && (
                <Badge tone="warn">Change-point @ {temporalSeries.changepoint_period}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Bars: period pair reports (a). Blue line: reporting rate (a / drug reports). Amber line: 2-segment Poisson LLR G² scan statistic. Purple dashed: Page&apos;s sequential CUSUM.
            </p>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={temporalSeries.points}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip />
                  {temporalSeries.changepoint_period && (
                    <ReferenceLine
                      yAxisId="left"
                      x={temporalSeries.changepoint_period}
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                    />
                  )}
                  <Bar
                    yAxisId="left"
                    dataKey="period_cases_a"
                    name="Period pair count (a)"
                    fill="#38bdf8"
                    opacity={0.35}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="llr_stat"
                    name="Poisson LLR (G²)"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="cusum_stat"
                    name="Page's CUSUM"
                    stroke="#a855f7"
                    strokeDasharray="4 2"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="period_rate"
                    name="Reporting rate (a / n_drug)"
                    stroke="#1a7ff5"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Method & False-Alarm Behaviour Documentation */}
      <div className="glass mt-6 rounded-2xl p-6 text-xs leading-relaxed text-[var(--muted)]">
        <h3 className="font-display text-sm font-semibold text-[var(--fg)]">
          Statistical Methodology &amp; False-Alarm Behaviour
        </h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="font-semibold text-[var(--fg)]">
              1. Cumulative BCPNN Information Component (Bate et al., 1998; Norén et al., 2006)
            </p>
            <p className="mt-1">
              At each calendar month or quarter <span className="font-mono">t</span>, cumulative counts{" "}
              <span className="font-mono">(A_t, n_drug,t, n_event,t, N_t)</span> are shrinks toward a Beta-Binomial / Dirichlet prior (<span className="font-mono">α = 0.5</span>):{" "}
              <span className="font-mono">IC_t = log₂((A_t + 0.5) / (E_t + 0.5))</span> with credible interval bounds{" "}
              <span className="font-mono">IC025_t, IC975_t = IC_t ∓ 1.96 / √(A_t + 0.5)</span>. The signal emergence date is the first period where <span className="font-mono">IC025_t &gt; 0</span>.
            </p>
          </div>
          <div>
            <p className="font-semibold text-[var(--fg)]">
              2. Change-Point Detection &amp; Sequential False-Alarm Inflation (Page, 1954; Kulldorff, 2001)
            </p>
            <p className="mt-1">
              We evaluate a 2-segment Poisson Log-Likelihood Ratio (<span className="font-mono">G²</span>) test across candidate split periods <span className="font-mono">k ∈ [1, K−1]</span> comparing pre-split rate{" "}
              <span className="font-mono">r₀ = A₀/M₀</span> against post-split rate <span className="font-mono">r₁ = A₁/M₁</span>, alongside Page&apos;s one-sided Poisson CUSUM{" "}
              <span className="font-mono">S_t = max(0, S_&#123;t-1&#125; + a_t − e_t − k_ref)</span>.{" "}
              <strong>False-alarm behaviour:</strong> Repeatedly scanning <span className="font-mono">K − 1</span> candidate split points or performing sequential looks after every quarter inflates the family-wise Type I error rate from a nominal <span className="font-mono">α = 0.05</span> (<span className="font-mono">χ²₁ = 3.84</span>) to approximately{" "}
              <span className="font-mono">1 − (1 − α)^&#123;K−1&#125;</span> (e.g., ~40% across 12 quarters). To control false alarms under maximally selected split scanning, we require{" "}
              <span className="font-mono">G² ≥ 6.63</span> (nominal <span className="font-mono">p &lt; 0.01</span> per split, keeping multi-period family-wise false-alarm probability near ~5% across typical 8–16 period horizons) and upward rate shift (<span className="font-mono">r₁ &gt; r₀</span>).
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
