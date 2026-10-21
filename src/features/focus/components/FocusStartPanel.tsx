import { ChevronRight } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId, useState, type FormEvent } from "react";

import type { Submit } from "@/features/activities/lib/submit";
import type { ActivityDto, FocusStartDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { activityLabel } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import {
  DURATION_PRESETS,
  MAX_INTENT_LENGTH,
  MAX_MINUTES,
  MIN_MINUTES,
  PRESET_HINTS,
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
  "flex flex-col items-center justify-center rounded-xl border border-border bg-background transition-colors hover:border-primary/40 focus-visible:outline-2 data-[state=checked]:border-primary data-[state=checked]:bg-primary/8 data-[state=checked]:shadow-[0_0_0_1px_var(--primary)]";

/**
 * Start view of the Focus section: an optional task, a big choice of length, and (under
 * Advanced) what counts as on track. Picking anything there turns the block into a focus block
 * with gentle drift nudges; otherwise it is a plain timer.
 */
export function FocusStartPanel({ activities, apps, driftUnavailable, onSubmit }: Props) {
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

  const problem = draftProblem(draft);
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
    <form onSubmit={submit} noValidate aria-label="Start a block" className="rounded-xl border border-border bg-surface p-5">
      <label htmlFor={`${id}-intent`} className="block text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Task
      </label>
      <Input
        id={`${id}-intent`}
        className="mt-1.5 h-9 w-full text-base"
        maxLength={MAX_INTENT_LENGTH + 20}
        placeholder="What are you working on? (optional)"
        value={draft.intent}
        onChange={(event) => change({ intent: event.target.value })}
      />

      <p id={`${id}-length`} className="mt-5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Length
      </p>
      <RadioGroup.Root
        aria-labelledby={`${id}-length`}
        value={`${draft.duration}`}
        onValueChange={(value) => change({ duration: value === "custom" ? "custom" : (Number(value) as DurationChoice) })}
        orientation="horizontal"
        className="mt-1.5 grid grid-cols-4 gap-2"
      >
        {DURATION_PRESETS.map((minutes) => (
          <RadioGroup.Item key={minutes} value={`${minutes}`} aria-label={`${minutes} min`} className={cn(tile, "h-20")}>
            <span className="tabular text-2xl font-semibold leading-none">{minutes}</span>{" "}
            <span className="mt-1.5 text-2xs text-muted-foreground">min · {PRESET_HINTS[minutes]}</span>
          </RadioGroup.Item>
        ))}
        <RadioGroup.Item value="custom" aria-label="Custom" className={cn(tile, "h-20")}>
          <span className="text-base font-semibold leading-none">Custom</span>
          <span className="mt-1.5 text-2xs text-muted-foreground">your length</span>
        </RadioGroup.Item>
      </RadioGroup.Root>
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

      <div className="mt-5 rounded-lg border border-border bg-background">
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
          Advanced: drift nudges
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {pickedCount === 0 ? "Off" : `${pickedCount} allowed`}
          </span>
        </button>
        {advanced && (
          <fieldset id={`${id}-advanced`} className="border-t border-border px-3 pt-2 pb-3">
            <legend className="sr-only">What counts as on track</legend>
            <p className="mb-2 text-xs text-muted-foreground">
              {driftUnavailable
                ? "Drift nudges need window tracking, which is unavailable right now. Timers still work."
                : "Pick what counts as on track. Time elsewhere for a while gets a gentle nudge; nothing is ever blocked. Leave it empty for a plain timer."}
            </p>
            {!driftUnavailable && (
            <div className="max-h-48 space-y-2 overflow-y-auto">
              <div role="group" aria-label="Allowed activities">
                <p className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Activities</p>
                {activities.map((activity) => (
                  <Choice
                    key={activity.id}
                    label={activityLabel(activity.id, activity.name)}
                    disabled={driftUnavailable}
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
          {kind === "focus" ? "Focus block with drift nudges" : "Plain timer: countdown and an alert"}
        </p>
        <Button type="submit" variant="primary" disabled={busy} className="h-9 px-5">
          {kind === "focus" ? "Start focus" : "Start timer"}
        </Button>
      </div>
    </form>
  );
}
