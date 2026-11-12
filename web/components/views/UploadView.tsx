"use client";

import { useState } from "react";
import { useData } from "@/lib/context/DataContext";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";
import { getConfiguredBackendUrl, isBackendConfigured } from "@/lib/pipeline/signalCopilot";
import type { FileNames } from "@/lib/pipeline/types";

export function UploadView() {
  const {
    loadSample,
    loadUploadTexts,
    loadOpenFdaLive,
    analysis,
    error,
    loading,
    workerProgress,
  } = useData();
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [demoF, setDemoF] = useState<File | null>(null);
  const [drugF, setDrugF] = useState<File | null>(null);
  const [reacF, setReacF] = useState<File | null>(null);

  const [outcF, setOutcF] = useState<File | null>(null);
  const [indiF, setIndiF] = useState<File | null>(null);
  const [therF, setTherF] = useState<File | null>(null);

  // Live openFDA count query state
  const [openFdaDrug, setOpenFdaDrug] = useState("WARFARIN");
  const [openFdaMaxEvents, setOpenFdaMaxEvents] = useState(25);
  const [openFdaErr, setOpenFdaErr] = useState<string | null>(null);
  const backendEnabled = isBackendConfigured();
  const backendUrl = getConfiguredBackendUrl();

  async function onLoad() {
    if (!demoF || !drugF || !reacF) {
      setLocalErr("Select required DEMO, DRUG, and REAC files.");
      return;
    }
    setBusy(true);
    setLocalErr(null);
    try {
      const [demoText, drugText, reacText, outcText, indiText, therText] = await Promise.all([
        demoF.text(),
        drugF.text(),
        reacF.text(),
        outcF ? outcF.text() : Promise.resolve(undefined),
        indiF ? indiF.text() : Promise.resolve(undefined),
        therF ? therF.text() : Promise.resolve(undefined),
      ]);

      const names: FileNames = {
        demo: demoF.name,
        drug: drugF.name,
        reac: reacF.name,
        outc: outcF?.name,
        indi: indiF?.name,
        ther: therF?.name,
      };

      await loadUploadTexts({
        demoText,
        drugText,
        reacText,
        outcText,
        indiText,
        therText,
        names,
      });
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setBusy(false);
    }
  }

  async function onQueryOpenFda() {
    if (!backendEnabled) return;
    if (!openFdaDrug.trim()) {
      setOpenFdaErr("Enter a drug name to query openFDA.");
      return;
    }
    setBusy(true);
    setOpenFdaErr(null);
    setLocalErr(null);
    try {
      await loadOpenFdaLive(openFdaDrug.trim(), openFdaMaxEvents);
    } catch (e) {
      setOpenFdaErr(e instanceof Error ? e.message : "openFDA count query failed");
    } finally {
      setBusy(false);
    }
  }

  const isRunning = busy || loading;

  return (
    <>
      <PageHeader
        title="Data upload, Live openFDA counts & Web Worker pipeline"
        hint="Upload FDA FAERS quarterly ASCII/CSV files (processed off the main thread in a Web Worker) or query 2×2 drug/event counts from the live openFDA API when a backend is configured."
      />

      {/* Methodological Limitations Banner */}
      <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-[var(--fg)]">
        <strong className="font-semibold text-amber-800 dark:text-amber-300">
          Methodological Limitations (Spontaneous Reporting):
        </strong>{" "}
        FAERS extracts contain voluntary spontaneous reports subject to under-reporting, duplicate
        submissions across reporters, missing exposure denominators, and confounding by indication.
        All computed statistics represent <strong>hypotheses, not causal findings</strong>.
      </div>

      {isRunning && workerProgress && (
        <div className="mb-6 rounded-2xl border border-brand-500/40 bg-brand-500/10 p-4">
          <div className="flex items-center justify-between text-xs font-medium">
            <span>Pipeline: {workerProgress.step}</span>
            <span className="font-mono">{workerProgress.percent}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full bg-brand-600 transition-all duration-200"
              style={{ width: `${Math.max(5, workerProgress.percent)}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold">Required tables (Quarterly FAERS Upload)</h2>
          <HelpTip>
            Supported delimiters: comma, pipe, $, or tab. Required columns: DEMO (primaryid,
            optional caseid/caseversion), DRUG (primaryid, drugname), REAC (primaryid, pt).
          </HelpTip>
          <div className="mt-4 space-y-3">
            <FilePick
              label="DEMO (demographics, caseid, caseversion, event_dt)"
              onPick={setDemoF}
            />
            <FilePick label="DRUG (suspect drugs, role_cod, drug_seq)" onPick={setDrugF} />
            <FilePick label="REAC (MedDRA preferred terms)" onPick={setReacF} />
          </div>

          <h3 className="mt-6 font-semibold">
            Optional tables (case-level ML &amp; Weibull TTO features)
          </h3>
          <HelpTip>
            When supplied, these populate case-level features (seriousness fractions, indication
            confounding, and Weibull time-to-onset shapes). When omitted, missing ML features are
            imputed at the training mean and contribute 0 to log-odds.
          </HelpTip>
          <div className="mt-4 space-y-3">
            <FilePick
              label="OUTC (optional)"
              note="Adds fatal (DE), hospitalised/life-threatening (HO/LT), and serious outcome fractions."
              onPick={setOutcF}
            />
            <FilePick
              label="INDI (optional)"
              note="Adds fraction of reports where the adverse event matches the reported indication (indication confounding)."
              onPick={setIndiF}
            />
            <FilePick
              label="THER (optional)"
              note="Adds therapy start dates (start_dt) to fit Weibull time-to-onset distributions and compute median TTO."
              onPick={setTherF}
            />
          </div>

          <button
            type="button"
            disabled={isRunning}
            className="mt-6 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={onLoad}
          >
            {isRunning ? "Running in Web Worker…" : "Load & analyze in Web Worker"}
          </button>
          {(localErr || error) && (
            <p className="mt-3 text-sm text-red-500">{localErr || error}</p>
          )}
        </div>

        <div className="space-y-6">
          {/* Live Data from openFDA Option */}
          <div className="glass rounded-2xl border border-brand-500/30 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Live data from openFDA (2×2 Count Queries)</h2>
              <Badge tone={backendEnabled ? "ok" : "default"}>
                {backendEnabled ? `Backend connected (${backendUrl})` : "Off by default (No backend)"}
              </Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              For a drug you enter, queries the openFDA{" "}
              <code className="font-mono">drug/event</code> endpoint for the 4 count components —
              co-reports with drug &amp; event (<span className="font-mono">a</span>), drug total (
              <span className="font-mono">a+b</span>), global event total (
              <span className="font-mono">a+c</span>), and all reports (
              <span className="font-mono">N</span>) — builds the 2×2 contingency tables, and runs
              the existing disproportionality pipeline (PRR, ROR, Yates χ², Benjamini–Hochberg
              q-value, BCPNN IC, and exact EBGM).
            </p>

            <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                Important Differences vs. Uploaded FAERS Quarterly Extracts:
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[var(--muted)]">
                <li>
                  These are aggregate report counts from the openFDA API,{" "}
                  <strong>not de-duplicated quarterly FAERS ASCII extracts</strong>, and include all
                  drug roles (suspect + concomitant), so values will differ from an uploaded
                  quarter.
                </li>
                <li>
                  <strong>Case-level ML features are unavailable in this mode</strong> (no{" "}
                  <code>OUTC</code>, <code>INDI</code>, <code>THER</code>, or <code>DEMO</code>{" "}
                  case tables); all 11 case-level features are marked as{" "}
                  <strong>Missing (0% coverage)</strong> on the ML page.
                </li>
                <li>
                  Responses are cached in-memory and server-side with sliding-window rate limiting.
                </li>
              </ul>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
                <span>Drug name (ingredient or brand)</span>
                <input
                  type="text"
                  value={openFdaDrug}
                  onChange={(e) => setOpenFdaDrug(e.target.value)}
                  placeholder="e.g. WARFARIN, ATORVASTATIN, LISINOPRIL"
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                <span>Top reactions</span>
                <select
                  value={openFdaMaxEvents}
                  onChange={(e) => setOpenFdaMaxEvents(Number(e.target.value))}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                >
                  <option value={15}>Top 15</option>
                  <option value={25}>Top 25</option>
                  <option value={40}>Top 40</option>
                </select>
              </label>
              <button
                type="button"
                disabled={!backendEnabled || isRunning || !openFdaDrug.trim()}
                onClick={onQueryOpenFda}
                title={
                  backendEnabled
                    ? "Fetch live 2x2 counts from openFDA via configured backend"
                    : "Disabled: No backend URL configured (set NEXT_PUBLIC_API_URL to enable live openFDA queries)"
                }
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isRunning && analysis?.meta.source === "openfda_live"
                  ? "Querying openFDA…"
                  : "Fetch Live openFDA Counts"}
              </button>
            </div>

            {!backendEnabled && (
              <p className="mt-2.5 text-[11px] text-[var(--muted)]">
                <strong>Why this button is disabled:</strong> The public site is a static export
                with no server, so external API routes are off by default. Configure{" "}
                <code className="font-mono">NEXT_PUBLIC_API_URL</code> pointing to{" "}
                <code className="font-mono">main.py</code> to enable rate-limited, cached openFDA
                count queries.
              </p>
            )}

            {openFdaErr && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300"
              >
                <strong>openFDA API Error:</strong> {openFdaErr}
              </div>
            )}
          </div>

          <div className="glass rounded-2xl p-6">
            <h2 className="font-semibold">Sample dataset &amp; deduplication status</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Synthetic 200-case FAERS-shaped dataset including all six tables (DEMO, DRUG, REAC,
              OUTC, INDI, THER) for demos and Python–browser parity verification.
            </p>
            <button
              type="button"
              disabled={isRunning}
              className="mt-4 rounded-xl border border-[var(--border)] px-4 py-2 font-semibold disabled:opacity-50"
              onClick={() => loadSample()}
            >
              Reset to sample
            </button>
            {analysis && (
              <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[var(--muted)]">Active source</dt>
                  <dd className="font-mono font-semibold">{analysis.meta.source}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Total reports (N)</dt>
                  <dd className="font-semibold">{analysis.meta.case_count.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Superseded versions dropped</dt>
                  <dd className="font-semibold">
                    {analysis.meta.source === "openfda_live"
                      ? "N/A (API counts)"
                      : (analysis.meta.superseded_versions_dropped ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Probable duplicate pairs</dt>
                  <dd className="font-semibold">
                    {analysis.meta.source === "openfda_live"
                      ? "N/A (API counts)"
                      : `${analysis.duplicates.flagged_pairs.length} (${analysis.duplicates.flagged_secondary_primaryids.length} cases)`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Scored pairs</dt>
                  <dd className="font-semibold">{analysis.signals.length}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Drugs</dt>
                  <dd className="font-semibold">{analysis.meta.drug_count}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">OUTC rows</dt>
                  <dd className="font-semibold">
                    {analysis.meta.source === "openfda_live"
                      ? "Missing (live mode)"
                      : (analysis.meta.outc_rows ?? "—")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">INDI rows</dt>
                  <dd className="font-semibold">
                    {analysis.meta.source === "openfda_live"
                      ? "Missing (live mode)"
                      : (analysis.meta.indi_rows ?? "—")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">THER rows</dt>
                  <dd className="font-semibold">
                    {analysis.meta.source === "openfda_live"
                      ? "Missing (live mode)"
                      : (analysis.meta.ther_rows ?? "—")}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Web Worker performance &amp; scale benchmark</h2>
              <Badge tone="ok">Off-Main-Thread Worker</Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              CSV parsing (<span className="font-mono">parseCsv</span>),{" "}
              <span className="font-mono">caseid/caseversion</span> deduplication, bucketed
              probable-duplicate scoring, empirical Bayes L-BFGS/Newton prior fitting,
              Mantel–Haenszel stratification, Weibull MLE, and Ω interaction search execute inside{" "}
              <span className="font-mono">analysisWorker.ts</span> with staged progress callbacks so
              the browser UI remains responsive.
            </p>
            <div className="mt-3 rounded-xl border border-[var(--border)]/60 bg-[var(--bg)]/50 p-3 text-xs">
              <p className="font-semibold text-[var(--fg)]">Largest dataset tested:</p>
              <p className="mt-1 text-[var(--muted)]">
                Synthetic full-quarter FAERS stress benchmark:{" "}
                <strong>50,000 deduplicated DEMO cases</strong> (52,500 raw DEMO rows with 2,500
                superseded case versions dropped), <strong>152,500 DRUG rows</strong>, and{" "}
                <strong>152,500 REAC rows</strong> (<strong>300,000</strong> suspect drug–event pair
                rows) completed end-to-end in <strong>11.9 seconds</strong> (390 ms CSV parse + 11.5
                s full statistical, stratified, Weibull &amp; Ω analysis) inside the background Web
                Worker without blocking the main UI thread.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function FilePick({
  label,
  note,
  onPick,
}: {
  label: string;
  note?: string;
  onPick: (f: File | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
      <input
        type="file"
        accept=".csv,.txt"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        className="text-xs"
      />
    </label>
  );
}
