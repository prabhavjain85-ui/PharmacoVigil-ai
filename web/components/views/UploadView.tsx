"use client";

import { useState } from "react";
import { useData } from "@/lib/context/DataContext";
import { parseCsv } from "@/lib/pipeline/parseCsv";
import { HelpTip, PageHeader } from "@/components/AppShell";

export function UploadView() {
  const { loadSample, loadUpload, analysis, error } = useData();
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [demoF, setDemoF] = useState<File | null>(null);
  const [drugF, setDrugF] = useState<File | null>(null);
  const [reacF, setReacF] = useState<File | null>(null);

  async function onLoad() {
    if (!demoF || !drugF || !reacF) {
      setLocalErr("Select DEMO, DRUG, and REAC files.");
      return;
    }
    setBusy(true);
    setLocalErr(null);
    try {
      const [d, dr, rc] = await Promise.all([demoF.text(), drugF.text(), reacF.text()]);
      loadUpload(parseCsv(d), parseCsv(dr), parseCsv(rc), {
        demo: demoF.name,
        drug: drugF.name,
        reac: reacF.name,
      });
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Data upload"
        hint="Upload FDA FAERS quarterly ASCII/CSV files (DEMO, DRUG, REAC). Parsing and signal detection run entirely in the browser."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold">Upload files</h2>
          <HelpTip>Supported delimiters: comma, pipe, $, or tab. Required columns: DEMO primaryid; DRUG primaryid, drugname; REAC primaryid, pt.</HelpTip>
          <div className="mt-4 space-y-3">
            <FilePick label="DEMO" onPick={setDemoF} />
            <FilePick label="DRUG" onPick={setDrugF} />
            <FilePick label="REAC" onPick={setReacF} />
          </div>
          <button
            type="button"
            disabled={busy}
            className="mt-4 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={onLoad}
          >
            {busy ? "Processing…" : "Load & analyze"}
          </button>
          {(localErr || error) && <p className="mt-3 text-sm text-red-500">{localErr || error}</p>}
        </div>
        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold">Sample dataset</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Synthetic ~200-case FAERS-shaped data shipped with the app for demos and parity testing.
          </p>
          <button
            type="button"
            className="mt-4 rounded-xl border border-[var(--border)] px-4 py-2 font-semibold"
            onClick={() => loadSample()}
          >
            Reset to sample
          </button>
          {analysis && (
            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-[var(--muted)]">Cases</dt><dd className="font-semibold">{analysis.meta.case_count}</dd></div>
              <div><dt className="text-[var(--muted)]">Pairs</dt><dd className="font-semibold">{analysis.meta.pair_count}</dd></div>
            </dl>
          )}
        </div>
      </div>
    </>
  );
}

function FilePick({ label, onPick }: { label: string; onPick: (f: File) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input type="file" accept=".csv,.txt" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} className="text-xs" />
    </label>
  );
}
