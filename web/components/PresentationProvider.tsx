"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const PRESENTATION_SECTIONS = [
  "hero",
  "pv-faers",
  "problem",
  "classical",
  "bayesian",
  "ml",
  "nlp",
  "explorer",
  "limitations",
  "references",
] as const;

export type SectionId = (typeof PRESENTATION_SECTIONS)[number];

type PresentationContextValue = {
  active: boolean;
  step: number;
  total: number;
  sectionId: SectionId;
  toggle: () => void;
  exit: () => void;
  go: (index: number) => void;
  next: () => void;
  prev: () => void;
};

const PresentationContext = createContext<PresentationContextValue | null>(null);

export function PresentationProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const total = PRESENTATION_SECTIONS.length;
  const sectionId = PRESENTATION_SECTIONS[step];

  const scrollToSection = useCallback((id: SectionId) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const go = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(total - 1, index));
      setStep(next);
      scrollToSection(PRESENTATION_SECTIONS[next]);
    },
    [scrollToSection, total],
  );

  const next = useCallback(() => go(step + 1), [go, step]);
  const prev = useCallback(() => go(step - 1), [go, step]);

  const toggle = useCallback(() => {
    setActive((v) => {
      const nextActive = !v;
      if (nextActive) {
        setStep(0);
        setTimeout(() => scrollToSection("hero"), 50);
      }
      return nextActive;
    });
  }, [scrollToSection]);

  const exit = useCallback(() => setActive(false), []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("present") === "1") {
      setActive(true);
      const stepParam = parseInt(params.get("step") ?? "0", 10);
      if (!Number.isNaN(stepParam)) {
        const s = Math.max(0, Math.min(total - 1, stepParam));
        setStep(s);
        setTimeout(() => scrollToSection(PRESENTATION_SECTIONS[s]), 100);
      }
    }
  }, [scrollToSection, total]);

  useEffect(() => {
    if (!active) return;
    document.documentElement.classList.add("presentation-mode");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        next();
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      }
      if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("presentation-mode");
      window.removeEventListener("keydown", onKey);
    };
  }, [active, exit, next, prev]);

  const value = useMemo(
    () => ({
      active,
      step,
      total,
      sectionId,
      toggle,
      exit,
      go,
      next,
      prev,
    }),
    [active, step, total, sectionId, toggle, exit, go, next, prev],
  );

  return (
    <PresentationContext.Provider value={value}>{children}</PresentationContext.Provider>
  );
}

export function usePresentation() {
  const ctx = useContext(PresentationContext);
  if (!ctx) throw new Error("usePresentation must be used within PresentationProvider");
  return ctx;
}
