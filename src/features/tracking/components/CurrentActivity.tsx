import type { FocusDto, OsDto, TrackingStateDto } from "@/shared/ipc";
import { formatDuration } from "@/shared/lib/time";

import { emptyActivityText } from "../lib/derive";

interface Props {
  state: TrackingStateDto;
  current: FocusDto | null;
  /** Milliseconds the current window has been in the foreground, if known. */
  elapsedMs: number | null;
  os?: OsDto;
}

export function CurrentActivity({ state, current, elapsedMs, os = "macos" }: Props) {
  return (
    <section aria-label="Current activity" className="mx-4 rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Now</p>
      {current ? (
        <div className="mt-1 flex items-baseline gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={current.app_name}>
              {current.app_name}
            </p>
            <p
              className="truncate text-xs text-muted-foreground"
              title={current.window_title ?? undefined}
            >
              {current.window_title ?? "No window title"}
            </p>
          </div>
          {elapsedMs !== null && (
            <p className="tabular shrink-0 text-xs text-muted-foreground">{formatDuration(elapsedMs)}</p>
          )}
        </div>
      ) : (
        <p className="mt-1 text-muted-foreground">{emptyActivityText(state, os)}</p>
      )}
    </section>
  );
}
