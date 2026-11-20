import type { ReactNode } from "react";

/** A titled card of the Insights section: a labelled region with a small muted heading. */
export function Card({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={`min-w-0 rounded-lg border border-border bg-background p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {hint && <p className="truncate text-2xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
