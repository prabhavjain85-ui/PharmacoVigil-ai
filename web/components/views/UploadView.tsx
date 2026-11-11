"use client";

import { useState } from "react";
import { useData } from "@/lib/context/DataContext";
import { parseCsv } from "@/lib/pipeline/parseCsv";
import { HelpTip, PageHeader } from "@/components/AppShell";
import type { FileNames, OptionalTables } from "@/lib/pipeline/types";

export function UploadView() {
  const { loadSample, loadUpload, analysis, error } = useData();
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
      const [d, dr, rc, outcTxt, indiTxt, therTxt] = await Promise.all([
        demoF.text(),
        drugF.text(),
        reacF.text(),
        outcF ? outcF.text() : Promise.resolve(null),
        indiF ? indiF.text() : Promise.resolve(null),
        therF ? therF.text() : Promise.resolve(null),
      ]);

      const names: FileNames = {
        demo: demoF.name,
        drug: drugF.name,
        reac: reacF.name,
        outc: outcF?.name,
        indi: indiF?.name,
        ther: therF?.name,
      };

      const optional: OptionalTables = {
        outc: outcTxt ? parseCsv(outcTxt) : undefined,
        indi: indiTxt ? parseCsv(indiTxt) : undefined,
        ther: therTxt ? parseCsv(therTxt) : undefined,
      };

      loadUpload(parseCsv(d), parseCsv(dr), parseCsv(rc), names, optional);
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
        hint="Upload FDA FAERS quarterly ASCII/CSV files. DEMO, DRUG, and REAC are required; OUTC, INDI, and THER are optional and supply case-level ML features."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold">Required tables</h2>
          <HelpTip>
            Supported delimiters: comma, pipe, $, or tab. Required columns: DEMO (primaryid), DRUG (primaryid, drugname), REAC (primaryid, pt).
          </HelpTip>
          <div className="mt-4 space-y-3">
            <FilePick label="DEMO (demographics & event_dt, occp_cod)" onPick={setDemoF} />
            <FilePick label="DRUG (suspect drugs, role_cod, drug_seq)" onPick={setDrugF} />
            <FilePick label="REAC (MedDRA preferred terms)" onPick={setReacF} />
          </div>

          <h3 className="mt-6 font-semibold">Optional tables (case-level ML features)</h3>
          <HelpTip>
            When supplied, these populate case-level features (seriousness fractions, indication confounding, and time-to-onset). When omitted, missing features are imputed at the training mean and contribute 0 to log-odds.
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
              note="Adds therapy start dates (start_dt) to compute median time-to-onset and ≤30-day onset fraction."
              onPick={setTherF}
            />
          </div>

          <button
            type="button"
            disabled={busy}
            className="mt-6 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={onLoad}
          >
            {busy ? "Processing…" : "Load & analyze"}
          </button>
          {(localErr || error) && <p className="mt-3 text-sm text-red-500">{localErr || error}</p>}
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold">Sample dataset</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Synthetic 200-case FAERS-shaped dataset including all six tables (DEMO, DRUG, REAC, OUTC, INDI, THER) for demos and Python–browser parity verification.
          </p>
          <button
            type="button"
            className="mt-4 rounded-xl border border-[var(--border)] px-4 py-2 font-semibold"
            onClick={() => loadSample()}
          >
            Reset to sample
          </button>
          {analysis && (
            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[var(--muted)]">Cases</dt>
                <dd className="font-semibold">{analysis.meta.case_count}</dd>
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
