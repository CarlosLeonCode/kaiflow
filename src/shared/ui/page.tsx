import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

import { useDragRegion } from "./title-bar";

/**
 * A section's explanation: the dismissible intro shown above the content and the "?" button in
 * the header that brings it back (see `useSectionIntro`).
 */
export interface IntroSlot {
  body: ReactNode;
  help: ReactNode;
}

/**
 * A dashboard section: sticky title row above a scrolling body. The title row is the window's
 * drag area only with an overlay title bar (macOS, see `OverlayTitleBarContext`).
 */
export function Page({
  title,
  subtitle,
  actions,
  intro,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Dismissible explanation above the content plus its help button in the header. */
  intro?: IntroSlot;
  children: ReactNode;
  className?: string;
}) {
  const drag = useDragRegion();
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        {...drag}
        className="flex h-14 shrink-0 items-end justify-between gap-4 border-b border-border px-6 pb-2.5"
      >
        <div className="min-w-0" {...drag}>
          <h1 className="truncate font-display text-xl leading-6 font-extrabold tracking-[-0.025em]" {...drag}>
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground" {...drag}>
              {subtitle}
            </p>
          )}
        </div>
        {(actions || intro?.help) && (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {intro?.help}
          </div>
        )}
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", className)}>
        {intro?.body}
        {children}
      </div>
    </div>
  );
}
