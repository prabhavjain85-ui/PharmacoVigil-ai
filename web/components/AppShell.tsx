"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/components/ThemeProvider";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/upload", label: "Data" },
  { href: "/signals", label: "Signals" },
  { href: "/ml", label: "ML priority" },
  { href: "/nlp", label: "Narratives" },
  { href: "/compare", label: "Compare" },
  { href: "/trends", label: "Trends" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen pb-12 pt-16">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">
            <span className="text-brand-600 dark:text-brand-400">PharmacoVigil</span> AI
          </Link>
          <nav className="hidden flex-wrap items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  path === item.href
                    ? "bg-brand-600 text-white"
                    : "text-[var(--muted)] hover:bg-[var(--border)]/40 hover:text-[var(--fg)]",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggle}
            className="rounded-full border border-[var(--border)] p-2 text-[var(--muted)]"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-[var(--border)] px-4 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium",
                path === item.href ? "bg-brand-600 text-white" : "text-[var(--muted)]",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-7xl px-4 md:px-6">{children}</div>
    </div>
  );
}

export function PageHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
      {hint && <p className="mt-2 max-w-3xl text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/60 px-3 py-2 text-xs text-[var(--muted)]">
      {children}
    </p>
  );
}
