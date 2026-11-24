import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/** The heading style of a card or a group of rows: short, bold, in the display font. */
export const CARD_HEADING = "font-display text-sm leading-[1.2] font-bold text-foreground";

/** A big number (a total, a clock): the display font, heavy and tight, with tabular digits. */
export const BIG_NUMBER = "tabular font-display text-display font-extrabold tracking-[-0.03em]";

/** The shell of a list of rows: one rounded card, rows split by hairlines. */
export const LIST_CARD = "divide-y divide-border overflow-hidden rounded-card border border-border bg-background";

/** A small heading above a group of rows (outside the card that holds them). */
export function SectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("px-1", CARD_HEADING, className)}>{children}</h2>;
}

/**
 * A titled region of a section: a rounded card with a display-font heading and an optional
 * hint on the right. `tone="paper"` sets it on the warm paper surface for the one card on a
 * screen that should stand out (like the Progress panel).
 */
export function Card({
  title,
  hint,
  label,
  tone = "plain",
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  /** Accessible name of the region when it should differ from the visible title. */
  label?: string;
  tone?: "plain" | "paper";
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label ?? title}
      className={cn(
        "min-w-0 rounded-card p-5",
        tone === "paper" ? "bg-paper-surface" : "border border-border bg-background",
        className,
      )}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className={CARD_HEADING}>{title}</h2>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
