import { ChevronRight } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId, useState, type FormEvent } from "react";

import type { Submit } from "@/features/activities/lib/submit";
import { useT } from "@/shared/i18n";
import type { ActivityDto, FocusStartDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { activityLabel } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { CARD_HEADING } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

import {
  DURATION_PRESETS,
  MAX_INTENT_LENGTH,
  MAX_MINUTES,
  MIN_MINUTES,
  draftKind,
  draftProblem,
  emptyDraft,
  startOf,
  toggled,
  type DurationChoice,
  type FocusDraft,
} from "../lib/focus";

interface Props {
  activities: readonly ActivityDto[];
  /** Apps seen recently, to pick from. */
  apps: readonly AppOption[];
  /** Drift nudges cannot work right now (tracking is degraded): only plain timers start. */
  driftUnavailable: boolean;
  onSubmit: Submit<FocusStartDto>;
}

function Choice({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/60">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="size-3.5 accent-primary" />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  );
}

const tile =
  "group flex flex-col items-center justify-center rounded-2xl border-[1.5px] border-border bg-background transition-colors hover:border-mark-stroke/50 focus-visible:outline-2 data-[state=checked]:border-mark-stroke data-[state=checked]:bg-pop-sun data-[state=checked]:text-on-pop data-[state=checked]:shadow-(--shadow-sticker-sm)";

/**
 * Start view of the Focus section: an optional task, a big choice of length, and (under
 * Advanced) what counts as on track. Picking anything there turns the block into a focus block
 * with gentle drift nudges; otherwise it is a plain timer.
 */
export function FocusStartPanel({ activities, apps, driftUnavailable, onSubmit }: Props) {
  const t = useT();
  const m = t.focus.start;
  const id = useId();
  const [draft, setDraft] = useState<FocusDraft>(emptyDraft);
  const [failure, setFailure] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const change = (changes: Partial<FocusDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setFailure(null);
  };

  const problem = draftProblem(draft, t);
  const shown = failure ?? (touched ? problem : null);
  const kind = draftKind(draft);
  const pickedCount = draft.activityIds.length + draft.appIds.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    const result = await onSubmit(startOf(draft));
    setBusy(false);
    if (result) setFailure(result.message);
    else setDraft((current) => ({ ...emptyDraft(), duration: current.duration, customMinutes: current.customMinutes }));
  }

  return (
    <form onSubmit={submit} noValidate aria-label={m.label} className="rounded-card bg-paper-surface p-6">
      <label htmlFor={`${id}-intent`} className={`block ${CARD_HEADING}`}>
        {m.task}
      </label>
      <Input
        id={`${id}-intent`}
        className="mt-1.5 h-9 w-full text-base"
        maxLength={MAX_INTENT_LENGTH + 20}
        placeholder={m.placeholder}
        value={draft.intent}
        onChange={(event) => change({ intent: event.target.value })}
      />

      <p id={`${id}-length`} className={`mt-5 ${CARD_HEADING}`}>
        {m.length}
      </p>
      <RadioGroup.Root
        aria-labelledby={`${id}-length`}
        value={`${draft.duration}`}
        onValueChange={(value) => change({ duration: value === "custom" ? "custom" : (Number(value) as DurationChoice) })}
        orientation="horizontal"
        className="mt-1.5 grid grid-cols-4 gap-2"
      >
        {DURATION_PRESETS.map((minutes) => (
          <RadioGroup.Item key={minutes} value={`${minutes}`} aria-label={t.focus.minutes(minutes)} className={cn(tile, "h-20")}>
            <span className="tabular font-display text-2xl leading-none font-extrabold">{minutes}</span>{" "}
            <span className="mt-1.5 text-2xs text-muted-foreground group-data-[state=checked]:text-on-pop-muted">min · {m.presetHints[minutes]}</span>
          </RadioGroup.Item>
        ))}
        <RadioGroup.Item value="custom" aria-label={m.custom} className={cn(tile, "h-20")}>
          <span className="font-display text-base leading-none font-extrabold">{m.custom}</span>
          <span className="mt-1.5 text-2xs text-muted-foreground group-data-[state=checked]:text-on-pop-muted">{m.customHint}</span>
        </RadioGroup.Item>
      </RadioGroup.Root>
      {draft.duration === "custom" && (
        <div className="mt-2 flex items-center gap-1.5">
          <Input
            type="number"
            inputMode="numeric"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            aria-label={m.minutesLabel}
            className="w-20"
            value={Number.isNaN(draft.customMinutes) ? "" : draft.customMinutes}
            onChange={(event) => change({ customMinutes: event.target.valueAsNumber })}
          />
          <span className="text-xs text-muted-foreground">{m.minutesUnit}</span>
        </div>
      )}

      <div className="mt-5 rounded-card border border-border bg-background">
        <button
          type="button"
          aria-expanded={advanced}
          aria-controls={`${id}-advanced`}
          onClick={() => setAdvanced((open) => !open)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn("size-4 text-muted-foreground motion-safe:transition-transform", advanced && "rotate-90")}
          />
          {m.advanced}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {pickedCount === 0 ? m.off : m.picked(pickedCount)}
          </span>
        </button>
        {advanced && (
          <fieldset id={`${id}-advanced`} className="border-t border-border px-3 pt-2 pb-3">
            <legend className="sr-only">{m.legend}</legend>
            <p className="mb-2 text-xs text-muted-foreground">
              {driftUnavailable ? m.driftUnavailable : m.pickHelp}
            </p>
            {!driftUnavailable && (
            <div className="max-h-48 space-y-2 overflow-y-auto">
              <div role="group" aria-label={m.allowedActivities}>
                <p className="px-1 font-display text-sm leading-[1.2] font-bold text-foreground">{m.activities}</p>
                {activities.map((activity) => (
                  <Choice
                    key={activity.id}
                    label={activityLabel(activity.id, activity.name, t)}
                    disabled={driftUnavailable}
                    checked={draft.activityIds.includes(activity.id)}
                    onChange={() => change({ activityIds: toggled(draft.activityIds, activity.id) })}
                  />
                ))}
              </div>
              <div role="group" aria-label={m.allowedApps}>
                <p className="px-1 font-display text-sm leading-[1.2] font-bold text-foreground">{m.recentApps}</p>
                {apps.length === 0 ? (
                  <p className="px-1 py-1 text-xs text-muted-foreground">
                    {m.noApps}
                  </p>
                ) : (
                  apps.map((app) => (
                    <Choice
                      key={app.id}
                      label={app.name}
                      disabled={driftUnavailable}
                      checked={draft.appIds.includes(app.id)}
                      onChange={() => change({ appIds: toggled(draft.appIds, app.id) })}
                    />
                  ))
                )}
              </div>
            </div>
            )}
          </fieldset>
        )}
      </div>

      {shown && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {shown}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {kind === "focus" ? m.kindFocus : m.kindTimer}
        </p>
        <Button type="submit" variant="primary" disabled={busy} className="h-9 px-5">
          {kind === "focus" ? t.focus.endCard.startFocus : t.focus.endCard.startTimer}
        </Button>
      </div>
    </form>
  );
}
