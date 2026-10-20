import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/** Section card used by Settings and the onboarding steps: title, optional hint, rows. */
export function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn("space-y-2", className)}>
      <div className="px-1">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        {children}
      </div>
    </section>
  );
}

/**
 * One labelled setting: text on the left, the control on the right. `controlId` ties the
 * visible label to the control so it is announced; `error` renders under the row.
 */
export function Row({
  label,
  description,
  controlId,
  error,
  children,
}: {
  label: string;
  description?: string;
  controlId: string;
  error?: string | null;
  children: ReactNode;
}) {
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={controlId} className="block font-medium">
            {label}
          </label>
          {description && (
            <p id={hintId} className="text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
