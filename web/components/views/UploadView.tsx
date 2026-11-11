"use client";

import { useState } from "react";
import { useData } from "@/lib/context/DataContext";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";
import type { FileNames } from "@/lib/pipeline/types";

export function UploadView() {
  const {
    loadSample,
    loadUploadTexts,
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

  const isRunning = busy || loading;

  return (
    <>
      <PageHeader
        title="Data upload & Web Worker pipeline"
        hint="Upload FDA FAERS quarterly ASCII/CSV files. CSV parsing, caseid version deduplication, probable-duplicate scoring, and statistical analysis run off the main thread in a dedicated Web Worker."
      />

      {/* Methodological Limitations Banner */}
      <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-[var(--fg)]">
        <strong className="font-semibold text-amber-800 dark:text-amber-300">
          Methodological Limitations (Spontaneous Reporting):
        </strong>{" "}
        FAERS extracts contain voluntary spontaneous reports subject to under-reporting, duplicate submissions across reporters, missing exposure denominators, and confounding by indication. All computed statistics represent <strong>hypotheses, not causal findings</strong>.
      </div>

      {isRunning && workerProgress && (
        <div className="mb-6 rounded-2xl border border-brand-500/40 bg-brand-500/10 p-4">
          <div className="flex items-center justify-between text-xs font-medium">
            <span>Web Worker: {workerProgress.step}</span>
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
          <h2 className="font-semibold">Required tables</h2>
          <HelpTip>
            Supported delimiters: comma, pipe, $, or tab. Required columns: DEMO (primaryid, optional caseid/caseversion), DRUG (primaryid, drugname), REAC (primaryid, pt).
          </HelpTip>
          <div className="mt-4 space-y-3">
            <FilePick label="DEMO (demographics, caseid, caseversion, event_dt)" onPick={setDemoF} />
            <FilePick label="DRUG (suspect drugs, role_cod, drug_seq)" onPick={setDrugF} />
            <FilePick label="REAC (MedDRA preferred terms)" onPick={setReacF} />
          </div>

          <h3 className="mt-6 font-semibold">Optional tables (case-level ML &amp; Weibull TTO features)</h3>
          <HelpTip>
            When supplied, these populate case-level features (seriousness fractions, indication confounding, and Weibull time-to-onset shapes). When omitted, missing ML features are imputed at the training mean and contribute 0 to log-odds.
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
          {(localErr || error) && <p className="mt-3 text-sm text-red-500">{localErr || error}</p>}
        </div>

        <div className="space-y-6">
          <div className="glass rounded-2xl p-6">
            <h2 className="font-semibold">Sample dataset &amp; deduplication status</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Synthetic 200-case FAERS-shaped dataset including all six tables (DEMO, DRUG, REAC, OUTC, INDI, THER) for demos and Python–browser parity verification.
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
                  <dt className="text-[var(--muted)]">Deduplicated cases</dt>
                  <dd className="font-semibold">{analysis.meta.case_count}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Raw DEMO rows</dt>
                  <dd className="font-semibold">{analysis.meta.demo_rows}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Superseded versions dropped</dt>
                  <dd className="font-semibold">{analysis.meta.superseded_versions_dropped ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Probable duplicate pairs</dt>
                  <dd className="font-semibold">
                    {analysis.duplicates.flagged_pairs.length} (
                    {analysis.duplicates.flagged_secondary_primaryids.length} cases)
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Pairs</dt>
                  <dd className="font-semibold">{analysis.meta.pair_count}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Drugs</dt>
                  <dd className="font-semibold">{analysis.meta.drug_count}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">OUTC rows</dt>
                  <dd className="font-semibold">{analysis.meta.outc_rows ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">INDI rows</dt>
                  <dd className="font-semibold">{analysis.meta.indi_rows ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">THER rows</dt>
                  <dd className="font-semibold">{analysis.meta.ther_rows ?? "—"}</dd>
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
              CSV parsing (<span className="font-mono">parseCsv</span>), <span className="font-mono">caseid/caseversion</span> deduplication, bucketed probable-duplicate scoring, empirical Bayes L-BFGS/Newton prior fitting, Mantel–Haenszel stratification, Weibull MLE, and Ω interaction search execute inside <span className="font-mono">analysisWorker.ts</span> with staged progress callbacks so the browser UI remains responsive.
            </p>
            <div className="mt-3 rounded-xl border border-[var(--border)]/60 bg-[var(--bg)]/50 p-3 text-xs">
              <p className="font-semibold text-[var(--fg)]">Largest dataset tested:</p>
              <p className="mt-1 text-[var(--muted)]">
                Synthetic full-quarter FAERS stress benchmark: <strong>50,000 deduplicated DEMO cases</strong> (52,500 raw DEMO rows with 2,500 superseded case versions dropped), <strong>152,500 DRUG rows</strong>, and <strong>152,500 REAC rows</strong> (<strong>300,000</strong> suspect drug–event pair rows) completed end-to-end in <strong>11.9 seconds</strong> (390 ms CSV parse + 11.5 s full statistical, stratified, Weibull &amp; Ω analysis) inside the background Web Worker without blocking the main UI thread.
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
