"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePresentation } from "./PresentationProvider";

export function PresentationBar() {
  const { active, step, total, next, prev } = usePresentation();
  if (!active) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 text-sm">
        <button
          type="button"
          onClick={prev}
          disabled={step === 0}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 disabled:opacity-40"
        >
          <ChevronLeft size={16} /> Previous
        </button>
        <span className="text-[var(--muted)]">
          Slide {step + 1} / {total} · <kbd className="rounded bg-[var(--border)] px-1">←</kbd>{" "}
          <kbd className="rounded bg-[var(--border)] px-1">→</kbd>
        </span>
        <button
          type="button"
          onClick={next}
          disabled={step >= total - 1}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 font-semibold text-white disabled:opacity-40"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
