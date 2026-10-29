import { cn } from "@/lib/cn";
import type { SectionId } from "./PresentationProvider";
import type { ReactNode } from "react";

export function SectionShell({
  id,
  eyebrow,
  title,
  lead,
  children,
  className,
}: {
  id: SectionId;
  eyebrow?: string;
  title: string;
  lead?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-section
      className={cn("relative px-4 py-20 md:px-6 md:py-28", className)}
    >
      <div className="mx-auto max-w-6xl">
        {eyebrow && (
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">
            {eyebrow}
          </p>
        )}
        <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl lg:text-5xl">
          {title}
        </h2>
        {lead && (
          <p className="mt-4 max-w-3xl text-lg text-[var(--muted)] md:text-xl">{lead}</p>
        )}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
