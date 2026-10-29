import { cn } from "@/lib/cn";

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "ok" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tone === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
        tone === "default" && "border-[var(--border)] text-[var(--muted)]",
      )}
    >
      {children}
    </span>
  );
}
