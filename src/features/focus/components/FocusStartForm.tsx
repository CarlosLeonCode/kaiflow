import { useId, useState, type FormEvent } from "react";

import type { Submit } from "@/features/activities/lib/submit";
import type { ActivityDto, FocusStartDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { activityLabel } from "@/shared/lib/labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";

import {
  DURATION_PRESETS,
  MAX_INTENT_LENGTH,
  MAX_MINUTES,
  MIN_MINUTES,
  draftProblem,
  emptyDraft,
  startOf,
  toggled,
  type DurationChoice,
  type FocusDraft,
} from "../lib/focus";

const DURATIONS: readonly SegmentedOption<`${DurationChoice}`>[] = [
  ...DURATION_PRESETS.map((minutes) => ({ value: `${minutes}` as const, label: `${minutes} min` })),
  { value: "custom", label: "Custom" },
];

interface Props {
  activities: readonly ActivityDto[];
  /** Apps seen recently, to pick from. */
  apps: readonly AppOption[];
  onSubmit: Submit<FocusStartDto>;
  onCancel: () => void;
}

function Choice({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/60">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-3.5 accent-primary" />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  );
}

/** Start a focus session: what for, how long, and what counts as being on track. */
export function FocusStartForm({ activities, apps, onSubmit, onCancel }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<FocusDraft>(emptyDraft);
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (changes: Partial<FocusDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setFailure(null);
  };

  const problem = draftProblem(draft);
  const shown = failure ?? (touched ? problem : null);
  const label = "block text-xs font-medium text-muted-foreground mb-1";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    const result = await onSubmit(startOf(draft));
    setBusy(false);
    if (result) setFailure(result.message);
  }

  return (
    <form onSubmit={submit} aria-label="New focus session" className="space-y-3">
      <div>
        <label htmlFor={`${id}-intent`} className={label}>
          What do you want to focus on?
        </label>
        <Input
          id={`${id}-intent`}
          className="w-full"
          autoFocus
          maxLength={MAX_INTENT_LENGTH + 20}
          placeholder="For example: Write the report"
          value={draft.intent}
          onChange={(event) => change({ intent: event.target.value })}
        />
      </div>

      <div>
        <span className={label}>How long?</span>
        <Segmented
          aria-label="Duration"
          value={`${draft.duration}`}
          options={DURATIONS}
          onChange={(value) => change({ duration: value === "custom" ? "custom" : (Number(value) as DurationChoice) })}
        />
        {draft.duration === "custom" && (
          <div className="mt-2 flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="numeric"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              aria-label="Minutes"
              className="w-20"
              value={Number.isNaN(draft.customMinutes) ? "" : draft.customMinutes}
              onChange={(event) => change({ customMinutes: event.target.valueAsNumber })}
            />
            <span className="text-xs text-muted-foreground">minutes</span>
          </div>
        )}
      </div>

      <fieldset>
        <legend className={label}>What counts as on track?</legend>
        <p className="mb-1 text-xs text-muted-foreground">
          Time in anything else for a while gets a gentle nudge. Nothing is ever blocked.
        </p>
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-2">
          <div role="group" aria-label="Allowed activities">
            <p className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Activities</p>
            {activities.map((activity) => (
              <Choice
                key={activity.id}
                label={activityLabel(activity.id, activity.name)}
                checked={draft.activityIds.includes(activity.id)}
                onChange={() => change({ activityIds: toggled(draft.activityIds, activity.id) })}
              />
            ))}
          </div>
          <div role="group" aria-label="Allowed apps">
            <p className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Apps you used recently</p>
            {apps.length === 0 ? (
              <p className="px-1 py-1 text-xs text-muted-foreground">
                No apps have been tracked yet. Let tracking run for a while, then pick apps here.
              </p>
            ) : (
              apps.map((app) => (
                <Choice
                  key={app.id}
                  label={app.name}
                  checked={draft.appIds.includes(app.id)}
                  onChange={() => change({ appIds: toggled(draft.appIds, app.id) })}
                />
              ))
            )}
          </div>
        </div>
      </fieldset>

      {shown && (
        <p role="alert" className="text-xs text-destructive">
          {shown}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          Start session
        </Button>
      </div>
    </form>
  );
}
