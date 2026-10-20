import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/** A dashboard section: sticky title row (also draggable) above a scrolling body. */
export function Page({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-end justify-between gap-4 border-b border-border px-6 pb-2.5"
      >
        <div className="min-w-0" data-tauri-drag-region>
          <h1 className="truncate text-lg font-semibold leading-6" data-tauri-drag-region>
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground" data-tauri-drag-region>
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", className)}>{children}</div>
    </div>
  );
}
