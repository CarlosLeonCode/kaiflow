import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useT } from "@/shared/i18n";
import type { ActivityDto, PresetDto } from "@/shared/ipc";
import { UNASSIGNED_ID } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Segmented } from "@/shared/ui/segmented";

import { suggestColor } from "../lib/palette";
import { productivityOptions, type ActivityFormValue } from "../lib/productivity";
import type { Submit } from "../lib/submit";
import { ActivityForm } from "./ActivityForm";
import { PresetChooser } from "./PresetChooser";

type Step = 0 | 1 | 2;

interface Props {
  /** Move focus to the guide when it appears (it was opened from "How this works"). */
  autoFocus: boolean;
  /** Suggested sets of activities; empty while they load. */
  packs: readonly PresetDto[];
  activities: readonly ActivityDto[];
  dark: boolean;
  /** Days the rule preview looks back, for the explanation. */
  previewDays: number;
  hasSuggestions: boolean;
  onApplyPreset: Submit<string>;
  onCreate: Submit<ActivityFormValue>;
  onUpdate: Submit<ActivityDto>;
  /** Brings the rule form into view and focuses it. */
  onAddRule: () => void;
  onShowSuggestions: () => void;
  /** Closes the guide for good; "How this works" reopens it. */
  onClose: () => void;
}

/**
 * Three-step guided setup of Activities: pick or create activities (ready-made sets are only
 * suggestions, with "Start empty" as an equal choice), add rules, then say how each activity
 * counts. Shown on first run, dismissible and reopened from the "How this works" button.
 */
export function GuidedSetup({
  autoFocus,
  packs,
  activities,
  dark,
  previewDays,
  hasSuggestions,
  onApplyPreset,
  onCreate,
  onUpdate,
  onAddRule,
  onShowSuggestions,
  onClose,
}: Props) {
  const t = useT();
  const words = t.activities.guide;
  const steps = words.steps;
  const options = productivityOptions(t);
  const id = useId();
  const [step, setStep] = useState<Step>(0);
  const [focusStep, setFocusStep] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const own = activities.filter((activity) => activity.id !== UNASSIGNED_ID);

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (focusStep) stepRef.current?.focus();
  }, [step, focusStep]);

  function goTo(next: Step) {
    setStep(next);
    setCreating(false);
    setUpdateError(null);
    setFocusStep(true);
  }

  async function setProductivity(activity: ActivityDto, productivity: ActivityDto["productivity"]) {
    const result = await onUpdate({ ...activity, productivity });
    setUpdateError(result ? result.message : null);
  }

  return (
    <section aria-labelledby={`${id}-title`} className="mb-6 rounded-card border border-border bg-background p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} className="text-sm font-semibold">
            {words.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{words.intro}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label={words.close} onClick={onClose}>
          <X />
        </Button>
      </div>

      <ol aria-label={words.stepsLabel} className="mt-3 flex flex-wrap gap-1.5">
        {steps.map((title, index) => (
          <li key={title}>
            <button
              type="button"
              aria-current={index === step ? "step" : undefined}
              onClick={() => goTo(index as Step)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                index === step
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {index + 1}. {title}
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-4">
        <h3 ref={stepRef} tabIndex={-1} className="text-sm font-medium">
          {words.stepHeading(step + 1, steps.length, steps[step] ?? "")}
        </h3>

        {step === 0 && (
          <div className="mt-1 space-y-3">
            <p className="text-xs text-muted-foreground">
              {words.activitiesIntro}
              {own.length > 0 && words.youHave(own.map((activity) => activity.name).join(", "))}
            </p>
            {creating ? (
              <div className="overflow-hidden rounded-xl border border-border">
                <ActivityForm
                  editing={null}
                  existing={activities}
                  initialColor={suggestColor(activities.map((activity) => activity.color))}
                  dark={dark}
                  onSubmit={async (value) => {
                    const result = await onCreate(value);
                    if (!result) goTo(1);
                    return result;
                  }}
                  onCancel={() => setCreating(false)}
                />
              </div>
            ) : (
              <PresetChooser
                packs={packs}
                onApply={async (key) => {
                  const result = await onApplyPreset(key);
                  if (!result) goTo(1);
                  return result;
                }}
                onStartEmpty={() => setCreating(true)}
              />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="mt-1 space-y-3 text-xs">
            <p className="text-muted-foreground">{words.rulesIntro}</p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-medium">{words.byApp}</span> {words.byAppText}
              </li>
              <li>
                <span className="font-medium">{words.byTitle}</span> {words.byTitleText}
              </li>
            </ul>
            <p className="text-muted-foreground">{words.previewNote(previewDays)}</p>
            <div className="flex flex-wrap items-center gap-2">
              {own.length === 0 ? (
                <p className="text-muted-foreground">{words.createFirst}</p>
              ) : (
                <Button variant="primary" size="sm" onClick={onAddRule}>
                  {words.addRule}
                </Button>
              )}
              {hasSuggestions && (
                <Button size="sm" onClick={onShowSuggestions}>
                  {words.reviewSuggestions}
                </Button>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-1 space-y-3 text-xs">
            <dl className="space-y-1">
              {options.map((option) => (
                <div key={option.value}>
                  <dt className="inline font-medium">{option.label}: </dt>
                  <dd className="inline text-muted-foreground">{t.activities.productivity.meaning[option.value]}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground">{t.activities.productivity.use}</p>
            {own.length > 0 ? (
              <ul aria-label={words.howEachCounts} className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {own.map((activity) => (
                  <li key={activity.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0 truncate text-sm font-medium">{activity.name}</span>
                    <Segmented
                      aria-label={words.howCounts(activity.name)}
                      value={activity.productivity}
                      options={options}
                      onChange={(next) => void setProductivity(activity, next)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{words.listedLater}</p>
            )}
            {updateError && (
              <p role="alert" className="text-destructive">
                {updateError}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-between gap-2 border-t border-border pt-3">
        <Button size="sm" disabled={step === 0} onClick={() => goTo((step - 1) as Step)}>
          {words.previous}
        </Button>
        {step < 2 ? (
          <Button size="sm" variant="primary" onClick={() => goTo((step + 1) as Step)}>
            {words.next(steps[step + 1] ?? "")}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onClose}>
            {words.finish}
          </Button>
        )}
      </div>
    </section>
  );
}
