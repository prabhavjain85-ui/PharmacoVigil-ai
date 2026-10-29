"use client";

import { useState } from "react";
import { data } from "@/lib/data";
import { extractFromNarrative } from "@/lib/nlp";
import { Badge } from "./ui/Badge";

export function NlpDemo() {
  const [sampleId, setSampleId] = useState(data.nlp_samples[0]?.id ?? "");
  const sample = data.nlp_samples.find((s) => s.id === sampleId) ?? data.nlp_samples[0];
  const [text, setText] = useState(sample?.text ?? "");
  const extraction = extractFromNarrative(text);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-xl font-semibold">Case narrative</h3>
          <Badge tone="warn">Rule-based demo — not clinical NLP</Badge>
        </div>
        <select
          className="mt-4 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          value={sampleId}
          onChange={(e) => {
            setSampleId(e.target.value);
            const s = data.nlp_samples.find((x) => x.id === e.target.value);
            if (s) setText(s.text);
          }}
        >
          {data.nlp_samples.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="mt-4 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-sm leading-relaxed"
        />
        <p className="mt-2 text-xs text-[var(--muted)]">{sample?.note}</p>
      </div>
      <div className="glass rounded-2xl p-6">
        <h3 className="font-display text-xl font-semibold">Extracted entities</h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Lightweight keyword/regex patterns map brands to canonical drugs for illustration.
        </p>
        <dl className="mt-6 space-y-4 text-sm">
          <div>
            <dt className="text-[var(--muted)]">Suspected drugs</dt>
            <dd className="mt-1 flex flex-wrap gap-2">
              {extraction.drugs.length ? extraction.drugs.map((d) => <Badge key={d} tone="ok">{d}</Badge>) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Reactions (MedDRA-like PTs)</dt>
            <dd className="mt-1 flex flex-wrap gap-2">
              {extraction.reactions.length ? extraction.reactions.map((r) => <Badge key={r}>{r}</Badge>) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Onset hint</dt>
            <dd className="mt-1 font-medium">{extraction.onset ?? "Not detected"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
