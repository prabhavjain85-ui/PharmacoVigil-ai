"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { data, fmt } from "@/lib/data";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { usePresentation } from "./PresentationProvider";
import { SectionShell } from "./SectionShell";
import { ContingencyCalculator } from "./ContingencyCalculator";
import { NlpDemo } from "./NlpDemo";
import { SignalExplorer } from "./SignalExplorer";
import { Badge } from "./ui/Badge";

export function HomePage() {
  const { toggle } = usePresentation();
  const fp = data.featured_pair;
  const mlImportance = [...data.ml_meta.global_importance].sort((a, b) => b.importance - a.importance);

  return (
    <>
      <section id="hero" data-section className="relative flex min-h-[90vh] items-center px-4 pt-24 pb-16 md:px-6">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Badge tone="ok">Live seminar demo · static data</Badge>
            <h1 className="mt-6 font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl lg:text-6xl">
              AI &amp; Machine Learning in Pharmacovigilance
            </h1>
            <p className="mt-6 text-lg text-[var(--muted)] md:text-xl">
              <strong className="text-[var(--fg)]">PharmacoVigil AI</strong> — a presenter-ready walkthrough of
              FAERS-style signal detection, Bayesian screens, and weak-label ML triage. No uploads required.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={toggle}
                className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 font-semibold text-white shadow-glow hover:bg-brand-500"
              >
                Start presentation <ArrowRight size={18} />
              </button>
              <a
                href="#explorer"
                className="inline-flex items-center rounded-full border border-[var(--border)] px-6 py-3 font-semibold"
              >
                Explore signals
              </a>
            </div>
            <p className="mt-6 text-sm text-[var(--muted)]">{data.disclaimer.data}</p>
          </motion.div>
          <motion.div
            className="glass relative rounded-3xl p-8 animate-float"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.5 }}
          >
            <Sparkles className="text-brand-500" />
            <p className="mt-4 font-display text-2xl font-semibold">{fp.drug}</p>
            <p className="text-[var(--muted)]">{fp.adverse_event}</p>
            <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-[var(--muted)]">PRR</dt><dd className="text-xl font-bold">{fmt(fp.PRR)}</dd></div>
              <div><dt className="text-[var(--muted)]">Priority</dt><dd className="text-xl font-bold">{fmt(fp.priority_score, 3)}</dd></div>
              <div><dt className="text-[var(--muted)]">IC025</dt><dd className="text-xl font-bold">{fmt(fp.IC025, 4)}</dd></div>
              <div><dt className="text-[var(--muted)]">EB05</dt><dd className="text-xl font-bold">{fmt(fp.EB05, 4)}</dd></div>
            </dl>
          </motion.div>
        </div>
      </section>

      <SectionShell id="pv-faers" eyebrow="Foundations" title="Pharmacovigilance & the FAERS schema" lead="Pharmacovigilance detects, assesses, and prevents adverse drug reactions after approval. The FDA Adverse Event Reporting System (FAERS) stores spontaneous reports in DEMO, DRUG, and REAC tables joined on primaryid.">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { t: "DEMO", d: "Demographics & report metadata per case" },
            { t: "DRUG", d: "Suspect/concomitant products (normalized to generic)" },
            { t: "REAC", d: "MedDRA preferred terms for reactions" },
          ].map((c) => (
            <div key={c.t} className="glass rounded-2xl p-6">
              <h3 className="font-display text-xl font-semibold text-brand-600 dark:text-brand-400">{c.t}</h3>
              <p className="mt-2 text-[var(--muted)]">{c.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-[var(--muted)]">
          This demo uses synthetic sample data ({data.dataset.case_count} cases) generated to mirror FAERS column shapes — not real post-marketing surveillance feeds.
        </p>
      </SectionShell>

      <SectionShell id="problem" eyebrow="The challenge" title="Why manual signal detection does not scale" lead="Analysts face combinatorial explosion, reporting bias, duplicates, and confounding by indication. Statistical screens prioritize pairs; humans adjudicate causality.">
        <ul className="grid gap-4 md:grid-cols-2 text-[var(--muted)]">
          <li className="glass rounded-xl p-5">Thousands of drug–event pairs per quarter; rare events hide in noise.</li>
          <li className="glass rounded-xl p-5">Multiple testing without shrinkage → false positives.</li>
          <li className="glass rounded-xl p-5">Brand names, off-label use, and incomplete narratives obscure truth.</li>
          <li className="glass rounded-xl p-5">Seminars need live, trustworthy tooling — not static slides alone.</li>
        </ul>
      </SectionShell>

      <SectionShell id="classical" eyebrow="Frequentist" title="Classical disproportionality" lead="PRR, ROR, and chi-square on the 2×2 table remain the workhorse in many agencies.">
        <ContingencyCalculator />
      </SectionShell>

      <SectionShell id="bayesian" eyebrow="Bayesian" title="BCPNN & EBGM compared to PRR" lead="WHO-UMC BCPNN uses the Information Component (IC) with IC025 &gt; 0. FDA MGPS-style EBGM applies gamma–Poisson shrinkage with EB05 &gt; 2.">
        <div className="glass rounded-2xl p-6">
          <p className="text-sm text-[var(--muted)]">
            Featured pair {fp.drug} · {fp.adverse_event}: PRR screen <Badge tone={fp.signal_detected ? "ok" : "default"}>{fp.signal_detected ? "yes" : "no"}</Badge>{" "}
            BCPNN <Badge tone={fp.signal_bcpnn ? "ok" : "default"}>{fp.signal_bcpnn ? "yes" : "no"}</Badge>{" "}
            EBGM <Badge tone={fp.signal_ebgm ? "ok" : "default"}>{fp.signal_ebgm ? "yes" : "no"}</Badge>
          </p>
          <div className="mt-6 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { m: "PRR", v: fp.PRR },
                  { m: "IC (log₂ scale)", v: fp.IC },
                  { m: "EBGM", v: fp.EBGM },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="m" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="v" fill="#1a7ff5" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </SectionShell>

      <SectionShell id="ml" eyebrow="Machine learning" title="Signal prioritisation model" lead={data.disclaimer.ml}>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="glass rounded-2xl p-6">
            <h3 className="font-display text-lg font-semibold">Top priority pairs</h3>
            <ul className="mt-4 space-y-3 text-sm">
              {data.priority_top.slice(0, 6).map((r) => (
                <li key={`${r.drug}-${r.adverse_event}`} className="flex justify-between gap-4 border-b border-[var(--border)]/50 pb-2">
                  <span><strong>{r.drug}</strong> · {r.adverse_event}</span>
                  <span className="font-semibold text-brand-600 dark:text-brand-400">{fmt(r.priority_score, 3)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="glass rounded-2xl p-6">
            <h3 className="font-display text-lg font-semibold">Global feature importances</h3>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mlImportance.slice(0, 8)} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="importance" fill="#34d399" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{data.ml_meta.weak_labels_note}</p>
          </div>
        </div>
      </SectionShell>

      <SectionShell id="nlp" eyebrow="NLP" title="Narratives complement structured coding" lead={data.disclaimer.nlp}>
        <NlpDemo />
      </SectionShell>

      <SectionShell id="explorer" eyebrow="Dashboard" title="Interactive signal explorer" lead="Pick a drug, compare multi-method flags, and review ML priority ranks — all from precomputed bundle.">
        <SignalExplorer />
      </SectionShell>

      <SectionShell id="limitations" eyebrow="Responsible use" title="Limitations, regulation & future" lead="Signals are hypotheses. AI assists triage; it does not establish causality or replace QPPV judgment.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="glass rounded-2xl p-6 text-sm text-[var(--muted)]">
            <ul className="list-disc space-y-2 pl-5">
              <li>Spontaneous reports ≠ incidence; under-reporting and stables bias ratios.</li>
              <li>Bayesian and frequentist criteria disagree on sparse cells.</li>
              <li>Weak-label ML is not validated; metrics on real reference sets are required for production.</li>
              <li>Align workflows with ICH E2B/E2E and local regulatory expectations.</li>
            </ul>
          </div>
          <div className="glass rounded-2xl p-6 text-sm text-[var(--muted)]">
            <p className="font-semibold text-[var(--fg)]">Future directions</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Transformer NLP on narrative fields with audit trails</li>
              <li>Active learning with pharmacologist labels</li>
              <li>Bayesian networks &amp; temporal scan statistics on longitudinal FAERS</li>
            </ul>
          </div>
        </div>
      </SectionShell>

      <SectionShell id="references" eyebrow="References" title="Further reading" lead="">
        <ul className="space-y-3">
          {data.references.map((r) => (
            <li key={r.url}>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline-offset-4 hover:underline dark:text-brand-400">
                {r.title}
              </a>
            </li>
          ))}
        </ul>
        <footer className="mt-16 border-t border-[var(--border)] pt-8 text-center text-sm text-[var(--muted)]">
          PharmacoVigil AI · AI &amp; Machine Learning in Pharmacovigilance · Seminar demo
        </footer>
      </SectionShell>
    </>
  );
}
