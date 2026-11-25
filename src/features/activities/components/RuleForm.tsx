import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { useT } from "@/shared/i18n";
import type { ActivityDto, RuleSpecDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { activityLabel } from "@/shared/lib/labels";
import { Button } from "@/shared/ui/button";
import { HelpTip } from "@/shared/ui/help-tip";
import { Input } from "@/shared/ui/input";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Select } from "@/shared/ui/select";

import type { RuleKind } from "../lib/rules";
import type { Submit } from "../lib/submit";
import { containsPattern, type TitleMatchMode } from "../lib/titleMatch";
import { RulePreview, type RulePreviewState } from "./RulePreview";

const KINDS: readonly RuleKind[] = ["app", "title_pattern"];
const MATCH_MODES: readonly TitleMatchMode[] = ["contains", "pattern"];

/** Id of the rule form, so the guided setup can bring it into view. */
export const RULE_FORM_ID = "add-rule-form";

interface Props {
  activities: readonly ActivityDto[];
  apps: readonly AppOption[];
  onSubmit: Submit<{ spec: RuleSpecDto; activityId: number }>;
  /** The rule as currently written (`null` while incomplete), for the live preview. */
  onDraftChange?: (spec: RuleSpecDto | null) => void;
  preview?: RulePreviewState;
  /** Days the preview looks back. */
  previewDays?: number;
}

/**
 * Adds a rule: by app (picked from recently seen apps) or by window title, either "contains
 * text" (plain words, any case) or, for advanced users, a regular expression. Optionally limited
 * to one app. While the rule is written, a live preview says how much recent time it would
 * cover. A pattern the backend rejects is shown under the field and nothing is saved (R9.4).
 */
export function RuleForm({ activities, apps, onSubmit, onDraftChange, preview, previewDays = 7 }: Props) {
  const t = useT();
  const words = t.activities.ruleForm;
  const kinds: SegmentedOption<RuleKind>[] = KINDS.map((value) => ({ value, label: words.kinds[value] }));
  const modes: SegmentedOption<TitleMatchMode>[] = MATCH_MODES.map((value) => ({ value, label: words.modes[value] }));
  const id = useId();
  const [kind, setKind] = useState<RuleKind>("app");
  const [mode, setMode] = useState<TitleMatchMode>("contains");
  const [appId, setAppId] = useState("");
  const [pattern, setPattern] = useState("");
  const [limitApp, setLimitApp] = useState("");
  const [activityId, setActivityId] = useState<number | "">("");
  const [patternError, setPatternError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const patternErrorId = `${id}-pattern-error`;
  const patternHintId = `${id}-pattern-hint`;
  const trimmedPattern = pattern.trim();

  const spec = useMemo<RuleSpecDto | null>(() => {
    if (kind === "app") return appId === "" ? null : { kind: "app", app_id: appId };
    if (trimmedPattern === "") return null;
    return {
      kind: "title_pattern",
      pattern: mode === "contains" ? containsPattern(trimmedPattern) : trimmedPattern,
      app_id: limitApp === "" ? null : limitApp,
    };
  }, [kind, appId, trimmedPattern, mode, limitApp]);
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    onDraftChange?.(specKey === "null" ? null : (JSON.parse(specKey) as RuleSpecDto));
  }, [specKey, onDraftChange]);

  const incomplete = activityId === "" || spec === null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (spec === null || activityId === "") {
      setMissing(true);
      return;
    }
    setBusy(true);
    const result = await onSubmit({ spec, activityId });
    setBusy(false);
    if (!result) {
      setPattern("");
      setAppId("");
      setMissing(false);
      setPatternError(null);
      setFormError(null);
    } else if (result.field === "pattern") {
      setPatternError(result.message);
      setFormError(null);
    } else {
      setFormError(result.message);
    }
  }

  const appOptionsList = apps.map((app) => (
    <option key={app.id} value={app.id}>
      {app.name === app.id ? app.id : `${app.name} (${app.id})`}
    </option>
  ));
  const contains = mode === "contains";
  const describedBy = [patternError ? patternErrorId : null, patternHintId].filter(Boolean).join(" ");

  return (
    <form id={RULE_FORM_ID} onSubmit={submit} aria-label={words.label} className="space-y-2.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented
          aria-label={words.type}
          value={kind}
          options={kinds}
          onChange={(next) => {
            setKind(next);
            setPatternError(null);
            setMissing(false);
          }}
        />
        <span className="text-xs text-muted-foreground">
          {words.kindHints[kind]}
        </span>
      </div>

      {kind === "app" ? (
        <div>
          <label htmlFor={`${id}-app`} className="mb-1 block text-xs font-medium text-muted-foreground">
            {words.app}
          </label>
          <Select
            id={`${id}-app`}
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
            className="w-full"
          >
            <option value="">{apps.length === 0 ? words.noApps : words.chooseApp}</option>
            {appOptionsList}
          </Select>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              aria-label={words.howToMatch}
              value={mode}
              options={modes}
              onChange={(next) => {
                setMode(next);
                setPatternError(null);
              }}
            />
            <HelpTip label={words.matchHelpLabel}>
              <p>
                <strong className="font-medium">{words.containsHelpLead}</strong>
                {words.containsHelp}
              </p>
              <p className="mt-1.5">
                <strong className="font-medium">{words.patternHelpLead}</strong>
                {words.patternHelp}
              </p>
            </HelpTip>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <label htmlFor={`${id}-pattern`} className="mb-1 block text-xs font-medium text-muted-foreground">
                {contains ? words.titleContains : words.titlePattern}
              </label>
              <Input
                id={`${id}-pattern`}
                value={pattern}
                onChange={(event) => {
                  setPattern(event.target.value);
                  setPatternError(null);
                }}
                aria-invalid={patternError ? true : undefined}
                aria-describedby={describedBy}
                placeholder={contains ? words.containsPlaceholder : words.patternPlaceholder}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={contains ? "w-full" : "w-full font-mono"}
              />
              <p id={patternHintId} className="mt-1 text-xs text-muted-foreground">
                {contains ? words.containsHint : words.patternHint}
              </p>
              {patternError && (
                <p id={patternErrorId} role="alert" className="mt-1 text-xs text-destructive">
                  {patternError}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={`${id}-limit`} className="mb-1 block text-xs font-medium text-muted-foreground">
                {words.onlyIn}
              </label>
              <Select
                id={`${id}-limit`}
                value={limitApp}
                onChange={(event) => setLimitApp(event.target.value)}
                className="w-full"
              >
                <option value="">{words.anyApp}</option>
                {appOptionsList}
              </Select>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor={`${id}-activity`} className="mb-1 block text-xs font-medium text-muted-foreground">
            {words.activity}
          </label>
          <Select
            id={`${id}-activity`}
            value={activityId}
            onChange={(event) => setActivityId(event.target.value === "" ? "" : Number(event.target.value))}
            className="w-full"
          >
            <option value="">{words.chooseActivity}</option>
            {activities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activityLabel(activity.id, activity.name, t)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          {words.add}
        </Button>
      </div>
      {preview && <RulePreview state={preview} days={previewDays} />}
      {missing && incomplete && (
        <p role="alert" className="text-xs text-destructive">
          {kind === "app" ? words.missing.app : contains ? words.missing.contains : words.missing.pattern}
        </p>
      )}
      {formError && (
        <p role="alert" className="text-xs text-destructive">
          {formError}
        </p>
      )}
    </form>
  );
}
