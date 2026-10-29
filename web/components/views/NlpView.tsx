"use client";

import { useState } from "react";
import { useData } from "@/lib/context/DataContext";
import { extractFromNarrative } from "@/lib/nlp";
import { HelpTip, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";

const SAMPLES = [
  "65-year-old on COUMADIN for AF. Melena and GI hemorrhage after dose increase, onset ~10 days.",
  "LIPITOR 40mg — severe myalgia, CK elevated (rhabdomyolysis pattern).",
  "Amoxicillin for otitis → lip swelling and dyspnoea within 2 hours (anaphylaxis).",
];

export function NlpView() {
  const [text, setText] = useState(SAMPLES[0]);
  const ex = extractFromNarrative(text);

  return (
    <>
      <PageHeader
        title="Case narrative NLP"
        hint="Paste a case narrative to extract suspected drugs, reactions, onset hints, and seriousness keywords."
      />
      <Badge tone="warn">Rule-based extraction — not a validated clinical NLP model</Badge>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button key={s.slice(0, 20)} type="button" className="text-xs text-brand-600 underline" onClick={() => setText(s)}>
                Sample
              </button>
            ))}
          </div>
        </div>
        <div className="glass rounded-2xl p-6 text-sm">
          <dl className="space-y-4">
            <div>
              <dt className="text-[var(--muted)]">Drugs (canonical)</dt>
              <dd className="mt-1 flex flex-wrap gap-2">{ex.drugs.map((d) => <Badge key={d} tone="ok">{d}</Badge>)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Reactions</dt>
              <dd className="mt-1 flex flex-wrap gap-2">{ex.reactions.map((r) => <Badge key={r}>{r}</Badge>)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Onset</dt>
              <dd className="font-medium">{ex.onset ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Seriousness hint</dt>
              <dd>{ex.serious ? <Badge tone="warn">Serious terms detected</Badge> : "None matched"}</dd>
            </div>
          </dl>
          <HelpTip>Maps brand names (e.g. COUMADIN → WARFARIN) using the same alias table as signal detection.</HelpTip>
        </div>
      </div>
    </>
  );
}
