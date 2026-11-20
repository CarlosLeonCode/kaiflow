import { ChevronLeft, Moon } from "lucide-react";
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

/** Idle-return card (R1.6): discard, give the time to the previous app, or to an activity. */
export function IdlePromptCard({ gap, moreCount, activities, busy, error, onResolve }: Props) {
  const t = useT();
  const m = t.idlePrompt;
  const locale = useLocale();
  const [choosing, setChoosing] = useState(false);
  const previous = gap.prev_focus;

  return (
    <section
      aria-label={m.label}
      className="rounded-lg border border-border bg-background p-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Moon className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">
            {m.awayFor} <span className="tabular">{formatDuration(gap.ended_at - gap.started_at)}</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            <span className="tabular">
              {formatTimeOfDay(gap.started_at, locale)} – {formatTimeOfDay(gap.ended_at, locale)}
            </span>
            {previous && (
              <>
                {m.lastIn}
                <span className="font-medium text-foreground">{previous.app_name}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {choosing ? (
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
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onResolve({ kind: "discard" })}>
            {m.discard}
          </Button>
          {previous && (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => onResolve({ kind: "assign_previous" })}
            >
              {m.assignPrevious}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setChoosing(true)}>
            {m.assignActivity}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="mt-2 text-2xs text-muted-foreground">
        {m.expires} <span className="tabular">{formatTimeOfDay(gap.expires_at, locale)}</span>.
        {moreCount > 0 && ` ${m.moreWaiting(moreCount)}`}
      </p>
    </section>
  );
}
