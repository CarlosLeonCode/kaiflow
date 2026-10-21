import { useId, useState, type FormEvent } from "react";

import type { ActivityDto, GoalDto, GoalScopeDto, PeriodDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { activityLabel } from "@/shared/lib/labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import type { Submit } from "@/features/activities/lib/submit";

import {
  ALL_DAYS,
  DAY_NAMES,
  MAX_LABEL_LENGTH,
  WEEKDAYS,
  draftOf,
  draftProblem,
  emptyDraft,
  goalOf,
  goalSentence,
  suggestedLabel,
  type GoalDraft,
  type NameLookup,
} from "../lib/goals";

const KINDS: readonly SegmentedOption<GoalDraft["kind"]>[] = [
  { value: "minimum", label: "At least" },
  { value: "maximum", label: "No more than" },
];

const PERIODS: readonly SegmentedOption<PeriodDto>[] = [
  { value: "daily", label: "Per day" },
  { value: "weekly", label: "Per week" },
  { value: "monthly", label: "Per month" },
];

type ScopeKind = GoalScopeDto["kind"];

const SCOPES: readonly SegmentedOption<ScopeKind>[] = [
  { value: "activity", label: "An activity" },
  { value: "app", label: "An app" },
  { value: "total", label: "All tracked time" },
];

type DaysPreset = "every" | "weekdays" | "custom";

const DAYS_PRESETS: readonly SegmentedOption<DaysPreset>[] = [
  { value: "every", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "custom", label: "Pick days" },
];

function presetOf(days: number): DaysPreset {
  return days === ALL_DAYS ? "every" : days === WEEKDAYS ? "weekdays" : "custom";
}

interface Props {
  /** `null` creates a new goal. */
  editing: GoalDto | null;
  activities: readonly ActivityDto[];
  apps: readonly AppOption[];
  names: NameLookup;
  onSubmit: Submit<GoalDto>;
  onCancel: () => void;
}

function scopeFor(kind: ScopeKind, activities: readonly ActivityDto[], apps: readonly AppOption[]): GoalScopeDto {
  switch (kind) {
    case "activity":
      return { kind, activity_id: activities.find((a) => a.id !== 1)?.id ?? activities[0]?.id ?? 1 };
    case "app":
      return { kind, app_id: apps[0]?.id ?? "" };
    case "total":
      return { kind };
  }
}

/**
 * Create or edit a goal. Everything is chosen with plain words and a live sentence under the
 * form ("At least 4h of Deep work every weekday.") says exactly what will be tracked.
 */
export function GoalForm({ editing, activities, apps, names, onSubmit, onCancel }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<GoalDraft>(() =>
    editing ? draftOf(editing) : emptyDraft(scopeFor("activity", activities, apps)),
  );
  const [preset, setPreset] = useState<DaysPreset>(() => presetOf(draft.days));
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (changes: Partial<GoalDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setFailure(null);
  };

  const problem = draftProblem(draft);
  const shown = failure ?? (touched ? problem : null);
  const errorId = `${id}-error`;
  const preview = problem
    ? null
    : goalSentence(
        {
          scope: draft.scope,
          kind: draft.kind,
          period: draft.period,
          active_days: draft.period === "daily" ? draft.days : ALL_DAYS,
          target_ms: goalOf(draft, names).target_ms,
        },
        names,
      );
  const placeholder = problem ? "" : suggestedLabel(goalOf(draft, names), names);

  // The app of a goal being edited may not be among the recently seen ones.
  const appChoices =
    draft.scope.kind === "app" && !apps.some((app) => app.id === (draft.scope as { app_id: string }).app_id)
      ? [{ id: draft.scope.app_id, name: names.app(draft.scope.app_id) }, ...apps]
      : apps;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    const result = await onSubmit(goalOf(draft, names, editing?.id ?? 0, editing?.archived ?? false));
    setBusy(false);
    if (result) setFailure(result.message);
  }

  const label = "block text-xs font-medium text-muted-foreground mb-1";

  return (
    <form
      onSubmit={submit}
      aria-label={editing ? `Edit goal ${editing.label}` : "New goal"}
      className="space-y-3"
    >
      <div>
        <span className={label}>Track</span>
        <Segmented
          aria-label="What to track"
          value={draft.scope.kind}
          options={SCOPES}
          onChange={(kind) => change({ scope: scopeFor(kind, activities, apps) })}
        />
        {draft.scope.kind === "activity" && (
          <Select
            aria-label="Activity"
            className="mt-2 w-full"
            value={draft.scope.activity_id}
            onChange={(event) => change({ scope: { kind: "activity", activity_id: Number(event.target.value) } })}
          >
            {activities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activityLabel(activity.id, activity.name)}
              </option>
            ))}
          </Select>
        )}
        {draft.scope.kind === "app" &&
          (appChoices.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No apps have been tracked yet. Let tracking run for a while, then pick one here.
            </p>
          ) : (
            <Select
              aria-label="App"
              className="mt-2 w-full"
              value={draft.scope.app_id}
              onChange={(event) => change({ scope: { kind: "app", app_id: event.target.value } })}
            >
              {appChoices.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </Select>
          ))}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <span className={label}>Goal type</span>
          <Segmented aria-label="Goal type" value={draft.kind} options={KINDS} onChange={(kind) => change({ kind })} />
        </div>
        <div>
          <span className={label}>Amount</span>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              aria-label="Hours"
              className="w-16"
              value={Number.isNaN(draft.hours) ? "" : draft.hours}
              onChange={(event) => change({ hours: event.target.valueAsNumber })}
            />
            <span className="text-xs text-muted-foreground">h</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              aria-label="Minutes"
              className="w-16"
              value={Number.isNaN(draft.minutes) ? "" : draft.minutes}
              onChange={(event) => change({ minutes: event.target.valueAsNumber })}
            />
            <span className="text-xs text-muted-foreground">min</span>
          </div>
        </div>
      </div>

      <div>
        <span className={label}>Repeats</span>
        <Segmented
          aria-label="Period"
          value={draft.period}
          options={PERIODS}
          onChange={(period) => change({ period })}
        />
      </div>

      {draft.period === "daily" && (
        <div>
          <span className={label}>Active days</span>
          <Segmented
            aria-label="Active days preset"
            value={preset}
            options={DAYS_PRESETS}
            onChange={(next) => {
              setPreset(next);
              if (next === "every") change({ days: ALL_DAYS });
              else if (next === "weekdays") change({ days: WEEKDAYS });
            }}
          />
          {preset === "custom" && (
            <div role="group" aria-label="Days of the week" className="mt-2 flex gap-1">
              {DAY_NAMES.map((day, index) => {
                const on = (draft.days & (1 << index)) !== 0;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => change({ days: draft.days ^ (1 << index) })}
                    className={cn(
                      "h-7 w-10 rounded-md border text-xs font-medium",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Rest days are not counted and never break a streak.
          </p>
        </div>
      )}

      <div>
        <label htmlFor={`${id}-name`} className={label}>
          Name (optional)
        </label>
        <Input
          id={`${id}-name`}
          className="w-full"
          value={draft.label}
          maxLength={MAX_LABEL_LENGTH + 10}
          placeholder={placeholder}
          onChange={(event) => change({ label: event.target.value })}
        />
      </div>

      <p
        data-testid="goal-preview"
        aria-live="polite"
        className="rounded-md bg-surface px-3 py-2 text-sm"
      >
        {preview ?? "Fill in the details to see what this goal means."}
      </p>

      {shown && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {shown}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          {editing ? "Save goal" : "Add goal"}
        </Button>
      </div>
    </form>
  );
}
