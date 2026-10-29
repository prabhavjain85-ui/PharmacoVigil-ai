"use client";

import { Moon, Presentation, Sun, X } from "lucide-react";
import Link from "next/link";
import { usePresentation } from "./PresentationProvider";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "#pv-faers", label: "PV & FAERS" },
  { href: "#classical", label: "Disproportionality" },
  { href: "#bayesian", label: "Bayesian" },
  { href: "#ml", label: "ML priority" },
  { href: "#explorer", label: "Explorer" },
];

export function SiteHeader() {
  const { toggle, active, exit } = usePresentation();
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur-md",
        active && "border-brand-500/30",
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <Link href="#" className="font-display text-lg font-semibold tracking-tight md:text-xl">
          <span className="text-brand-600 dark:text-brand-400">PharmacoVigil</span>{" "}
          <span className="text-[var(--fg)]">AI</span>
        </Link>
        {!active && (
          <nav className="hidden items-center gap-6 text-sm text-[var(--muted)] lg:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="hover:text-[var(--fg)] transition-colors">
                {item.label}
              </a>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-full border border-[var(--border)] p-2 text-[var(--muted)] hover:text-[var(--fg)]"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {active ? (
            <button
              type="button"
              onClick={exit}
              className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
            >
              <X size={16} /> Exit
            </button>
          ) : (
            <button
              type="button"
              onClick={toggle}
              className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-glow hover:bg-brand-500 transition"
            >
              <Presentation size={16} /> Present
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
