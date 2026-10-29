"use client";

import { useMemo, useState } from "react";
import { data, fmt } from "@/lib/data";
import { computeFromCells } from "@/lib/stats";
import { Badge } from "./ui/Badge";

export function ContingencyCalculator() {
  const init = data.featured_contingency;
  const [a, setA] = useState(init.a);
  const [b, setB] = useState(init.b);
  const [c, setC] = useState(init.c);
  const [d, setD] = useState(init.d);

  const result = useMemo(
    () =>
      computeFromCells(
        { a, b, c, d, n: a + b + c + d },
        data.ebgm_prior,
      ),
    [a, b, c, d],
  );

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="glass rounded-2xl p-6">
        <h3 className="font-display text-xl font-semibold">2×2 contingency table</h3>
        <p className="mt-2 text-sm text-[var(--muted)]">Adjust cells to see PRR, BCPNN (IC), and EBGM update live.</p>
        <div className="mt-6 grid grid-cols-3 gap-2 text-center text-sm">
          <div />
          <div className="font-semibold text-[var(--muted)]">Event</div>
          <div className="font-semibold text-[var(--muted)]">Other events</div>
          <div className="flex items-center font-semibold text-[var(--muted)]">Drug</div>
          <CellInput value={a} onChange={setA} highlight />
          <CellInput value={b} onChange={setB} />
          <div className="flex items-center font-semibold text-[var(--muted)]">Other drugs</div>
          <CellInput value={c} onChange={setC} />
          <CellInput value={d} onChange={setD} />
        </div>
        <button
          type="button"
          className="mt-4 text-sm text-brand-600 dark:text-brand-400"
          onClick={() => {
            setA(init.a);
            setB(init.b);
            setC(init.c);
            setD(init.d);
          }}
        >
          Reset to featured demo pair
        </button>
      </div>
      <div className="glass rounded-2xl p-6">
        <h3 className="font-display text-xl font-semibold">Computed measures</h3>
        {result ? (
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <Stat label="PRR" value={fmt(result.prr)} flag={result.signalPrr && "PRR signal"} />
            <Stat label="ROR" value={fmt(result.ror)} />
            <Stat label="χ² (Yates)" value={fmt(result.chi2)} />
            <Stat label="IC" value={fmt(result.ic, 4)} />
            <Stat label="IC025" value={fmt(result.ic025, 4)} flag={result.signalBcpnn && "BCPNN"} />
            <Stat label="EBGM" value={fmt(result.ebgm, 4)} />
            <Stat label="EB05" value={fmt(result.eb05, 4)} flag={result.signalEbgm && "EBGM"} />
          </dl>
        ) : (
          <p className="mt-4 text-[var(--muted)]">Enter valid non-zero margins.</p>
        )}
      </div>
    </div>
  );
}

function CellInput({
  value,
  onChange,
  highlight,
}: {
  value: number;
  onChange: (n: number) => void;
  highlight?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className={`rounded-xl border bg-[var(--bg)] px-3 py-4 text-center text-lg font-semibold ${
        highlight ? "border-brand-500 shadow-glow" : "border-[var(--border)]"
      }`}
    />
  );
}

function Stat({ label, value, flag }: { label: string; value: string; flag?: string | false }) {
  return (
    <div>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
      {flag && (
        <Badge tone="ok" >
          {flag}
        </Badge>
      )}
    </div>
  );
}
