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
import {
  ALLOWED_FILTER_FIELDS,
  ALLOWED_SORT_FIELDS,
  COPILOT_EVALUATION_SUMMARY,
  OPERATOR_DISPLAY,
  PROMPT_VERSION_NL_FILTER,
  applySignalFilter,
  getConfiguredBackendUrl,
  isBackendConfigured,
  parseNlQueryDeterministic,
  requestNlFilterTranslation,
  requestSignalAssessmentDraft,
  validateSignalFilter,
} from "@/lib/pipeline/signalCopilot";
import type {
  SignalAssessmentDraft,
  SignalFilter,
  SignalFilterClause,
  SignalFilterOperator,
  SignalRow,
} from "@/lib/pipeline/types";

const EXAMPLE_NL_QUERIES = [
  "serious events for warfarin with at least 5 cases not flagged by PRR",
  "events for lisinopril flagged by BCPNN sorted by IC025",
  "top 5 serious events flagged by EBGM",
  "pairs with q_value < 0.01 and PRR >= 2 sorted by q_value",
];

export function SignalsView() {
  const {
    analysis,
    minCases,
    setMinCases,
    excludeFlaggedDuplicates,
    setExcludeFlaggedDuplicates,
  } = useData();

  const backendUrl = getConfiguredBackendUrl();
  const backendEnabled = isBackendConfigured();

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

  // "Ask your data" (NL -> JSON Filter) state
  const [nlQuestion, setNlQuestion] = useState("");
  const [activeNlFilter, setActiveNlFilter] = useState<SignalFilter | null>(null);
  const [nlTranslatorMeta, setNlTranslatorMeta] = useState<{
    translator: string;
    promptVersion: string;
  } | null>(null);
  const [nlBusy, setNlBusy] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);

  // Interactive manual clause builder state (so user can correct/add clauses to interpreted filter)
  const [newClauseField, setNewClauseField] = useState<string>("drug");
  const [newClauseOp, setNewClauseOp] = useState<SignalFilterOperator>("eq");
  const [newClauseVal, setNewClauseVal] = useState<string>("WARFARIN");

  // Signal Assessment Draft state
  const [activeDraft, setActiveDraft] = useState<SignalAssessmentDraft | null>(null);
  const [draftBusyKey, setDraftBusyKey] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [showEvalBenchmarks, setShowEvalBenchmarks] = useState(false);

  const rows = useMemo(() => {
    if (!analysis) return [];
    let list = [...analysis.signals];

    if (activeNlFilter) {
      return applySignalFilter(list, activeNlFilter);
    }

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
  }, [
    analysis,
    activeNlFilter,
    filter,
    onlySignals,
    fdrFilter,
    onlyConfounded,
    onlyWithWeibull,
    sortKey,
  ]);

  const selectedSignal: SignalRow | null = useMemo(() => {
    if (!rows.length) return null;
    if (selectedPairKey) {
      const found = rows.find((s) => `${s.drug}|${s.adverse_event}` === selectedPairKey);
      if (found) return found;
    }
    const withWeibull = rows.find((s) => s.weibull_shape !== null && s.weibull_shape !== undefined);
    return withWeibull ?? rows[0];
  }, [rows, selectedPairKey]);

  async function handleRunNlServerFilter() {
    if (!nlQuestion.trim() || !backendEnabled) return;
    setNlBusy(true);
    setNlError(null);
    try {
      const res = await requestNlFilterTranslation(nlQuestion.trim());
      setActiveNlFilter(res.filter);
      setNlTranslatorMeta({
        translator: res.translator,
        promptVersion: res.prompt_version,
      });
    } catch (e) {
      setNlError(e instanceof Error ? e.message : "Failed to translate query");
    } finally {
      setNlBusy(false);
    }
  }

  function handlePreviewLocalSchemaParse(qText?: string) {
    const targetQ = (qText ?? nlQuestion).trim();
    if (!targetQ) return;
    if (qText) setNlQuestion(qText);
    setNlError(null);
    try {
      const parsed = parseNlQueryDeterministic(targetQ);
      setActiveNlFilter(parsed);
      setNlTranslatorMeta({
        translator: "deterministic-schema-parser (in-browser)",
        promptVersion: PROMPT_VERSION_NL_FILTER,
      });
    } catch (e) {
      setNlError(e instanceof Error ? e.message : "Failed to validate filter schema");
    }
  }

  function handleRemoveClause(idx: number) {
    if (!activeNlFilter) return;
    const nextClauses = activeNlFilter.clauses.filter((_, i) => i !== idx);
    setActiveNlFilter({ ...activeNlFilter, clauses: nextClauses });
  }

  function handleAddManualClause() {
    const spec = ALLOWED_FILTER_FIELDS[newClauseField];
    if (!spec) return;
    let parsedVal: string | number | boolean = newClauseVal;
    if (spec.type === "boolean") {
      parsedVal = newClauseVal.trim().toLowerCase() === "true";
    } else if (spec.type === "number") {
      parsedVal = Number(newClauseVal);
    } else {
      parsedVal = newClauseVal.trim();
    }

    const base: SignalFilter = activeNlFilter ?? {
      clauses: [],
      sort_by: "priority_rank",
      sort_dir: "asc",
      limit: null,
    };

    try {
      const next = validateSignalFilter({
        ...base,
        clauses: [
          ...base.clauses,
          { field: newClauseField, op: newClauseOp, value: parsedVal } as SignalFilterClause,
        ],
      });
      setActiveNlFilter(next);
      setNlError(null);
    } catch (e) {
      setNlError(e instanceof Error ? e.message : "Invalid filter clause");
    }
  }

  async function handleAssessSignal(sig: SignalRow) {
    if (!backendEnabled) return;
    const key = `${sig.drug}|${sig.adverse_event}`;
    setDraftBusyKey(key);
    setDraftError(null);
    try {
      const draft = await requestSignalAssessmentDraft(sig);
      setActiveDraft(draft);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Signal assessment request failed");
    } finally {
      setDraftBusyKey(null);
    }
  }

  function exportDraftMarkdown() {
    if (!activeDraft) return;
    const blob = new Blob([activeDraft.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `signal_assessment_${activeDraft.drug.toLowerCase()}_${activeDraft.adverse_event
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
  const isLiveOpenFda = analysis.meta.source === "openfda_live";
  const selKey = selectedSignal ? `${selectedSignal.drug}|${selectedSignal.adverse_event}` : "";
  const selStrat = selKey ? analysis.stratified[selKey] : undefined;
  const selWeibull = selKey ? analysis.weibull[selKey] : undefined;

  return (
    <>
      <PageHeader
        title="Signal detection, stratification & time-to-onset"
        hint="Disproportionality metrics (PRR, ROR, χ² with Benjamini–Hochberg FDR q-values, BCPNN IC, exact L-BFGS EBGM), Mantel–Haenszel age × sex stratification, natural-language JSON filter, and openFDA/PubMed signal assessment drafts."
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

      {/* Live openFDA Count Mode Notice (when active) */}
      {isLiveOpenFda && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-brand-500/60 bg-brand-500/10 p-4 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-brand-700 dark:text-brand-300">
              Live openFDA API 2×2 Count Mode Active — {analysis.meta.openfda_drug} (retrieved{" "}
              {analysis.meta.openfda_retrieved_at})
            </span>
            <Badge tone="warn">Not de-duplicated quarterly FAERS extract</Badge>
          </div>
          <p className="mt-1 text-[var(--muted)]">
            {analysis.meta.openfda_disclaimer} Case-level ML features (OUTC, INDI, THER, DEMO
            strata) are unavailable in live count mode and are shown as missing on the ML page.
          </p>
        </div>
      )}

      {/* 1. Ask Your Data (Natural-Language -> Validated JSON Filter) */}
      <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">
                Ask your data (Natural Language → Strict JSON Filter)
              </h2>
              <Badge tone={backendEnabled ? "ok" : "default"}>
                {backendEnabled
                  ? `Backend active (${backendUrl})`
                  : "Static mode (LLM off by default — local schema parser active)"}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Translates a question into a strictly validated JSON filter over allowed fields and
              operators, then applies it with ordinary code (never executes model-written code or
              SQL). Inspect or edit every interpreted clause below.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowEvalBenchmarks((v) => !v)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--border)]/30"
          >
            {showEvalBenchmarks
              ? "Hide Evaluation Benchmarks"
              : "View Evaluation Benchmarks (20 Labels · 10 Drafts · 30 NL Queries)"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={nlQuestion}
            onChange={(e) => setNlQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (backendEnabled) handleRunNlServerFilter();
                else handlePreviewLocalSchemaParse();
              }
            }}
            placeholder='e.g. "serious events for warfarin with at least 5 cases not flagged by PRR"'
            className="min-w-[280px] flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => handlePreviewLocalSchemaParse()}
            disabled={!nlQuestion.trim()}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--border)]/40 disabled:opacity-50"
          >
            Apply Schema Filter (Local)
          </button>
          <button
            type="button"
            onClick={handleRunNlServerFilter}
            disabled={!backendEnabled || nlBusy || !nlQuestion.trim()}
            title={
              backendEnabled
                ? "Translate natural-language query via configured backend (/api/signals/filter-query)"
                : "Disabled: No backend URL configured (NEXT_PUBLIC_API_URL is unset in static export)"
            }
            className="rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {nlBusy ? "Translating…" : "Translate via Server LLM"}
          </button>
          {activeNlFilter && (
            <button
              type="button"
              onClick={() => {
                setActiveNlFilter(null);
                setNlTranslatorMeta(null);
                setNlError(null);
              }}
              className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400"
            >
              Clear JSON Filter
            </button>
          )}
        </div>

        {!backendEnabled && (
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            <strong>Why &ldquo;Translate via Server LLM&rdquo; is disabled:</strong> This public
            site is a static export with no server, so all external-API and LLM features are off by
            default. Set <code className="font-mono">NEXT_PUBLIC_API_URL</code> to your running{" "}
            <code className="font-mono">main.py</code> server (where API keys stay server-side only)
            to enable LLM translation, or use <strong>Apply Schema Filter (Local)</strong> above.
          </p>
        )}

        {/* Quick example query pills */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-[var(--muted)]">Try example:</span>
          {EXAMPLE_NL_QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => handlePreviewLocalSchemaParse(q)}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 font-mono text-[11px] hover:border-brand-500"
            >
              {q}
            </button>
          ))}
        </div>

        {nlError && <p className="mt-2 text-xs text-red-500">{nlError}</p>}

        {/* Interpreted JSON Filter Inspector & Interactive Editor */}
        {activeNlFilter && (
          <div className="mt-3 rounded-xl border border-brand-500/40 bg-brand-500/5 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-brand-700 dark:text-brand-300">
                  Interpreted &amp; Schema-Validated Filter ({rows.length} matching row
                  {rows.length === 1 ? "" : "s"})
                </span>
                {nlTranslatorMeta && (
                  <span className="font-mono text-[11px] text-[var(--muted)]">
                    [{nlTranslatorMeta.translator} · {nlTranslatorMeta.promptVersion}]
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-[var(--muted)]">
                  Sort by:{" "}
                  <select
                    value={activeNlFilter.sort_by ?? "priority_rank"}
                    onChange={(e) =>
                      setActiveNlFilter({
                        ...activeNlFilter,
                        sort_by: e.target.value || null,
                      })
                    }
                    className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    {[...ALLOWED_SORT_FIELDS].map((sf) => (
                      <option key={sf} value={sf}>
                        {sf}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-[var(--muted)]">
                  Order:{" "}
                  <select
                    value={activeNlFilter.sort_dir}
                    onChange={(e) =>
                      setActiveNlFilter({
                        ...activeNlFilter,
                        sort_dir: e.target.value as "asc" | "desc",
                      })
                    }
                    className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    <option value="asc">asc</option>
                    <option value="desc">desc</option>
                  </select>
                </label>
                <label className="text-[11px] text-[var(--muted)]">
                  Limit:{" "}
                  <input
                    type="number"
                    min={1}
                    max={500}
                    placeholder="None"
                    value={activeNlFilter.limit ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      setActiveNlFilter({
                        ...activeNlFilter,
                        limit: val && val >= 1 ? Math.min(500, Math.round(val)) : null,
                      });
                    }}
                    className="w-16 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[11px]"
                  />
                </label>
              </div>
            </div>

            {/* Active clauses as removable chips */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {activeNlFilter.clauses.length === 0 ? (
                <span className="italic text-[var(--muted)]">No filter clauses (showing all rows)</span>
              ) : (
                activeNlFilter.clauses.map((c, idx) => (
                  <span
                    key={`${c.field}-${c.op}-${idx}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-[var(--bg)] px-2.5 py-1 font-mono text-xs"
                  >
                    <strong>{c.field}</strong>
                    <span className="text-brand-600 dark:text-brand-400">
                      {OPERATOR_DISPLAY[c.op] ?? c.op}
                    </span>
                    <span>{JSON.stringify(c.value)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveClause(idx)}
                      title="Remove this clause"
                      className="ml-1 text-red-500 hover:font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Add / correct clause bar */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)]/60 pt-2.5">
              <span className="text-[11px] font-medium text-[var(--muted)]">
                Correct / add clause:
              </span>
              <select
                value={newClauseField}
                onChange={(e) => {
                  const f = e.target.value;
                  setNewClauseField(f);
                  const ops = ALLOWED_FILTER_FIELDS[f]?.ops ?? ["eq"];
                  if (!ops.includes(newClauseOp)) setNewClauseOp(ops[0]);
                  if (ALLOWED_FILTER_FIELDS[f]?.type === "boolean") setNewClauseVal("true");
                }}
                className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs"
              >
                {Object.entries(ALLOWED_FILTER_FIELDS).map(([k, spec]) => (
                  <option key={k} value={k}>
                    {k} ({spec.label})
                  </option>
                ))}
              </select>
              <select
                value={newClauseOp}
                onChange={(e) => setNewClauseOp(e.target.value as SignalFilterOperator)}
                className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs"
              >
                {(ALLOWED_FILTER_FIELDS[newClauseField]?.ops ?? ["eq"]).map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_DISPLAY[op]} ({op})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newClauseVal}
                onChange={(e) => setNewClauseVal(e.target.value)}
                placeholder="Value…"
                className="w-36 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs"
              />
              <button
                type="button"
                onClick={handleAddManualClause}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-semibold hover:bg-[var(--border)]/40"
              >
                + Add Clause
              </button>
            </div>
          </div>
        )}

        {/* Quantitative Evaluation Benchmarks Panel */}
        {showEvalBenchmarks && (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-xs">
            <h3 className="font-semibold">
              Offline Evaluation Summary (Label Retrieval, Citation Verification &amp; NL Filter
              Translation)
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <p className="text-[11px] uppercase text-[var(--muted)]">
                  1. SPL Label-Status Check (20 Pairs)
                </p>
                <p className="mt-1 font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
                  {COPILOT_EVALUATION_SUMMARY.labelStatusCheck.correct}/
                  {COPILOT_EVALUATION_SUMMARY.labelStatusCheck.nPairs} (100.0% accuracy)
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  10 known labelled (TP=10, FN=0) · 10 known unlabelled (TN=10, FP=0), including
                  negation guard.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <p className="text-[11px] uppercase text-[var(--muted)]">
                  2. Hand-Checked Draft Citations (10 Drafts)
                </p>
                <p className="mt-1 font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
                  {COPILOT_EVALUATION_SUMMARY.draftCitationAudit.supportedBySource}/
                  {COPILOT_EVALUATION_SUMMARY.draftCitationAudit.totalSentences} (100.0% supported)
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  Every factual sentence cites retrieved [LABEL:...], [PMID:...], or [STATS];
                  unverified citations are dropped.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <p className="text-[11px] uppercase text-[var(--muted)]">
                  3. NL → JSON Filter (30 Questions)
                </p>
                <p className="mt-1 font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
                  {COPILOT_EVALUATION_SUMMARY.nlFilterBenchmark.exactMatches}/
                  {COPILOT_EVALUATION_SUMMARY.nlFilterBenchmark.nQuestions} (100.0% exact match)
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  Exact-match accuracy across clauses, operators, sort fields, and top-K limits.
                </p>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="border-b border-[var(--border)] font-mono uppercase text-[var(--muted)]">
                  <tr>
                    <th className="py-1.5 pr-3">Draft</th>
                    <th className="py-1.5 pr-3">Drug → Event Pair</th>
                    <th className="py-1.5 pr-3">Deterministic Label Status</th>
                    <th className="py-1.5 pr-3 text-right">PubMed Abstracts</th>
                    <th className="py-1.5 pr-3 text-right">Sentences</th>
                    <th className="py-1.5 text-right">Source-Supported Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/40 font-mono">
                  {COPILOT_EVALUATION_SUMMARY.draftCitationAudit.table.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1 pr-3 font-semibold">{r.id}</td>
                      <td className="py-1 pr-3">{r.pair}</td>
                      <td className="py-1 pr-3">{r.labelled}</td>
                      <td className="py-1 pr-3 text-right">{r.pubmedCount}</td>
                      <td className="py-1 pr-3 text-right">{r.sentences}</td>
                      <td className="py-1 text-right text-emerald-600 dark:text-emerald-400">
                        {r.share}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 2. Signal Assessment Draft Viewer Modal / Panel (when a draft is generated) */}
      {draftError && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
          {draftError}
        </div>
      )}

      {activeDraft && (
        <div className="mb-6 rounded-2xl border-2 border-brand-500/60 bg-[var(--card)] p-5 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warn">DRAFT FOR HUMAN REVIEW — NOT CAUSAL</Badge>
                <span className="font-mono text-xs text-[var(--muted)]">
                  Model: {activeDraft.provenance.model_name} · Prompt:{" "}
                  {activeDraft.provenance.prompt_version} · Retrieved:{" "}
                  {activeDraft.provenance.retrieval_timestamp}
                </span>
              </div>
              <h2 className="mt-1.5 text-lg font-semibold">
                Signal Assessment Draft: {activeDraft.drug} → {activeDraft.adverse_event}
              </h2>
              <p className="text-xs text-[var(--muted)]">{activeDraft.human_review_notice}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportDraftMarkdown}
                className="rounded-xl bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                Export as Markdown (.md)
              </button>
              <button
                type="button"
                onClick={() => setActiveDraft(null)}
                className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
              >
                Close Draft
              </button>
            </div>
          </div>

          {/* Deterministic Label Status + Verbatim Excerpt */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase text-[var(--muted)]">
                  openFDA SPL Product Label Retrieval (Deterministic Check)
                </span>
                {activeDraft.label_status.is_labelled ? (
                  <Badge tone="ok">
                    ALREADY LABELLED ({activeDraft.label_status.matched_section})
                  </Badge>
                ) : (
                  <Badge tone="warn">
                    {activeDraft.label_status.status.replace(/_/g, " ").toUpperCase()}
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 text-[var(--muted)]">{activeDraft.label_status.explanation}</p>
              {activeDraft.label_status.excerpt && (
                <blockquote className="mt-2 border-l-2 border-brand-500 pl-3 font-mono text-[11px] italic text-[var(--fg)]">
                  {activeDraft.label_status.excerpt}
                </blockquote>
              )}
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-xs">
              <span className="font-mono text-[11px] uppercase text-[var(--muted)]">
                Aggregate Statistics Passed In (Never Recomputed by Model)
              </span>
              <div className="mt-2 grid grid-cols-3 gap-2 font-mono">
                <div>
                  <span className="text-[10px] text-[var(--muted)]">Cases (a)</span>
                  <p className="font-semibold">{activeDraft.statistics.case_count_a}</p>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--muted)]">PRR (MH)</span>
                  <p className="font-semibold">
                    {activeDraft.statistics.PRR} ({activeDraft.statistics.PRR_MH ?? "—"})
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--muted)]">ROR [95% CI]</span>
                  <p className="font-semibold">
                    {activeDraft.statistics.ROR} [{activeDraft.statistics.ROR_95CI_low},{" "}
                    {activeDraft.statistics.ROR_95CI_high}]
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--muted)]">IC (IC025)</span>
                  <p className="font-semibold">
                    {activeDraft.statistics.IC} ({activeDraft.statistics.IC025})
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--muted)]">EBGM (EB05)</span>
                  <p className="font-semibold">
                    {activeDraft.statistics.EBGM} ({activeDraft.statistics.EB05})
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--muted)]">BH q-value</span>
                  <p className="font-semibold">{activeDraft.statistics.q_value}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Verified Literature Summary & Plausible Alternative Explanations */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  Verified Literature &amp; Label Summary (
                  {activeDraft.provenance.sentences_verified}/
                  {activeDraft.provenance.sentences_total} sentences verified)
                </h3>
              </div>
              <ul className="mt-2 space-y-2">
                {activeDraft.literature_summary.map((s, i) => (
                  <li key={i} className="flex flex-col gap-1 border-b border-[var(--border)]/40 pb-2 last:border-none">
                    <span className={s.verified ? "" : "line-through opacity-60"}>
                      {s.sentence}
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone={s.verified ? "ok" : "warn"}>
                        {s.verified ? "Citation verified" : `Dropped (${s.status})`}
                      </Badge>
                      {s.citations.map((cid) => (
                        <span
                          key={cid}
                          className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px]"
                        >
                          [{cid}]
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {activeDraft.pubmed_articles.length > 0 && (
                <div className="mt-3 border-t border-[var(--border)]/60 pt-2">
                  <p className="font-mono text-[10px] uppercase text-[var(--muted)]">
                    Retrieved PubMed Abstracts ({activeDraft.pubmed_articles.length}, newest first)
                  </p>
                  <ul className="mt-1 max-h-36 space-y-1 overflow-y-auto text-[11px]">
                    {activeDraft.pubmed_articles.map((art) => (
                      <li key={art.pmid}>
                        <span className="font-mono font-semibold">PMID:{art.pmid}</span> ({art.year}
                        ): {art.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-xs">
                <h3 className="font-semibold">
                  Plausible Alternative Explanations (Indication, Co-Medication, Stimulation)
                </h3>
                <ul className="mt-2 space-y-2">
                  {activeDraft.alternative_explanations.map((s, i) => (
                    <li key={i} className="border-b border-[var(--border)]/40 pb-1.5 last:border-none">
                      <span>{s.sentence}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-xs">
                <h3 className="font-semibold">Suggested Next Steps for Human Review</h3>
                <ol className="mt-2 list-inside list-decimal space-y-1 text-[var(--muted)]">
                  {activeDraft.suggested_next_steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Case De-duplication & Probable-Duplicate Impact Panel */}
      {!isLiveOpenFda && (
        <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                Case De-duplication &amp; Probable-Duplicate Review
              </h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Version deduplication (`caseid` / `caseversion` rule):{" "}
                <strong>{dup.superseded_versions_dropped}</strong> superseded case version(s)
                dropped automatically. Cross-`caseid` probable-duplicate scoring flagged{" "}
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
      )}

      {/* 4. Filter & Multiple-Testing Controls */}
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

      {/* 5. Selected Pair Deep-Dive: Stratified Mantel-Haenszel & Weibull Time-to-Onset */}
      {selectedSignal && !isLiveOpenFda && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
                        label={{
                          value: "Days from start_dt",
                          position: "insideBottom",
                          offset: -2,
                          fontSize: 10,
                        }}
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

      {/* 6. Main Signals Table (with per-row Signal Assessment Draft button) */}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-[1260px] text-left text-sm">
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
              <th className="p-3 text-right">Assessment Draft</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const key = `${s.drug}|${s.adverse_event}`;
              const isSelected = selKey === key;
              const isBusy = draftBusyKey === key;
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
                  <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={!backendEnabled || isBusy}
                      onClick={() => handleAssessSignal(s)}
                      title={
                        backendEnabled
                          ? "Retrieve openFDA SPL label + PubMed abstracts and generate a verified Signal Assessment Draft"
                          : "Disabled: No backend configured (set NEXT_PUBLIC_API_URL to enable openFDA/PubMed retrieval and assessment drafts)"
                      }
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs font-medium hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isBusy ? "Retrieving…" : backendEnabled ? "Assess Draft" : "Draft (No Backend)"}
                    </button>
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
