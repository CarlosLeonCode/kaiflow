import { useT } from "@/shared/i18n";
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
  const t = useT();
  return (
    <section aria-label={t.tracking.currentActivity} className="mx-4 rounded-2xl bg-paper-surface px-3.5 py-3">
      <p className="text-xs font-medium text-muted-foreground">{t.tracking.now}</p>
      {current ? (
        <div className="mt-1 flex items-baseline gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display font-bold" title={current.app_name}>
              {current.app_name}
            </p>
            <p
              className="truncate text-xs text-muted-foreground"
              title={current.window_title ?? undefined}
            >
              {current.window_title ?? t.common.labels.noTitle}
            </p>
          </div>
          {elapsedMs !== null && (
            <p className="tabular shrink-0 text-xs text-muted-foreground">{formatDuration(elapsedMs)}</p>
          )}
        </div>
      ) : (
        <p className="mt-1 text-muted-foreground">{emptyActivityText(state, t, os)}</p>
      )}
    </section>
  );
}
