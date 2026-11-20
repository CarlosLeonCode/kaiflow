import { ChevronLeft, Ellipsis, Moon } from "lucide-react";
import { useState } from "react";

import { useLocale, useT } from "@/shared/i18n";
import type { ActivityDto, IdleGapDto, IdleResolutionDto } from "@/shared/ipc";
import { activityLabel } from "@/shared/lib/labels";
import { formatDuration, formatTimeOfDay } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";

interface Props {
  gap: IdleGapDto;
  /** Other gaps waiting behind this one. */
  moreCount: number;
  activities: ActivityDto[];
  busy: boolean;
  error: string | null;
  onResolve: (resolution: IdleResolutionDto) => void;
}

/**
 * Idle-return card (R1.6), one line: discard, keep the time for the previous app, or give it to
 * an activity. The exact range sits in the heading's tooltip; unanswered gaps still expire.
 */
export function IdlePromptCard({ gap, moreCount, activities, busy, error, onResolve }: Props) {
  const t = useT();
  const m = t.idlePrompt;
  const locale = useLocale();
  const [choosing, setChoosing] = useState(false);
  const previous = gap.prev_focus;
  const range = `${formatTimeOfDay(gap.started_at, locale)} – ${formatTimeOfDay(gap.ended_at, locale)}`;

  return (
    <section aria-label={m.label} className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 font-medium" title={range}>
          <Moon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="tabular shrink-0">{m.away(formatDuration(gap.ended_at - gap.started_at))}</span>
          {previous && <span className="truncate font-normal text-muted-foreground">· {previous.app_name}</span>}
          {moreCount > 0 && (
            <>
              <span aria-hidden="true" className="shrink-0 rounded bg-muted px-1 text-2xs font-normal text-muted-foreground">
                +{moreCount}
              </span>
              <span className="sr-only">{m.moreWaiting(moreCount)}</span>
            </>
          )}
        </h2>
        {!choosing && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onResolve({ kind: "discard" })}>
              {m.discard}
            </Button>
            {previous && (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                title={m.keepTitle(previous.app_name)}
                onClick={() => onResolve({ kind: "assign_previous" })}
              >
                {m.keep}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              aria-label={m.assignActivity}
              title={m.assignActivity}
              onClick={() => setChoosing(true)}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      {choosing && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label={m.back}
              onClick={() => setChoosing(false)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <p className="text-xs text-muted-foreground">{m.assignTitle}</p>
          </div>
          {activities.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">{m.noActivities}</p>
          ) : (
            <ul className="max-h-36 space-y-0.5 overflow-y-auto" aria-label={m.activities}>
              {activities.map((activity) => (
                <li key={activity.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onResolve({ kind: "assign_activity", activity_id: activity.id })}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent disabled:opacity-50"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: activity.color }}
                    />
                    <span className="truncate">{activityLabel(activity.id, activity.name, t)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
