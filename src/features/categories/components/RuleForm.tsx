import { useId, useState, type FormEvent } from "react";

import type { CategoryDto, RuleSpecDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { categoryLabel } from "@/shared/lib/labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Select } from "@/shared/ui/select";

import type { RuleKind } from "../lib/rules";
import type { Submit } from "../lib/submit";

const KINDS: readonly SegmentedOption<RuleKind>[] = [
  { value: "app", label: "App" },
  { value: "title_pattern", label: "Window title" },
];

interface Props {
  categories: readonly CategoryDto[];
  apps: readonly AppOption[];
  onSubmit: Submit<{ spec: RuleSpecDto; categoryId: number }>;
}

/**
 * Adds a rule: by app (bundle id picked from recently seen apps) or by a window-title
 * regular expression, optionally limited to one app. A pattern the backend rejects is shown
 * under the pattern field and nothing is saved (R9.4).
 */
export function RuleForm({ categories, apps, onSubmit }: Props) {
  const id = useId();
  const [kind, setKind] = useState<RuleKind>("app");
  const [appId, setAppId] = useState("");
  const [pattern, setPattern] = useState("");
  const [limitApp, setLimitApp] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [patternError, setPatternError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const patternErrorId = `${id}-pattern-error`;
  const trimmedPattern = pattern.trim();
  const incomplete = categoryId === "" || (kind === "app" ? appId === "" : trimmedPattern === "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (incomplete) {
      setMissing(true);
      return;
    }
    setBusy(true);
    const result = await onSubmit({
      spec:
        kind === "app"
          ? { kind: "app", app_id: appId }
          : { kind: "title_pattern", pattern: trimmedPattern, app_id: limitApp === "" ? null : limitApp },
      categoryId,
    });
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

  return (
    <form onSubmit={submit} aria-label="Add rule" className="space-y-2.5 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented
          aria-label="Rule type"
          value={kind}
          options={KINDS}
          onChange={(next) => {
            setKind(next);
            setPatternError(null);
            setMissing(false);
          }}
        />
        <span className="text-xs text-muted-foreground">
          {kind === "app" ? "Everything in one app" : "A regular expression matched against the title"}
        </span>
      </div>

      {kind === "app" ? (
        <div>
          <label htmlFor={`${id}-app`} className="mb-1 block text-xs font-medium text-muted-foreground">
            App
          </label>
          <Select
            id={`${id}-app`}
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
            className="w-full"
          >
            <option value="">{apps.length === 0 ? "No apps seen yet" : "Choose an app…"}</option>
            {appOptionsList}
          </Select>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor={`${id}-pattern`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Title pattern
            </label>
            <Input
              id={`${id}-pattern`}
              value={pattern}
              onChange={(event) => {
                setPattern(event.target.value);
                setPatternError(null);
              }}
              aria-invalid={patternError ? true : undefined}
              aria-describedby={patternError ? patternErrorId : undefined}
              placeholder="For example, Figma|Sketch"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="w-full font-mono"
            />
            {patternError && (
              <p id={patternErrorId} role="alert" className="mt-1 text-xs text-destructive">
                {patternError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${id}-limit`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Only in
            </label>
            <Select
              id={`${id}-limit`}
              value={limitApp}
              onChange={(event) => setLimitApp(event.target.value)}
              className="w-full"
            >
              <option value="">Any app</option>
              {appOptionsList}
            </Select>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor={`${id}-category`} className="mb-1 block text-xs font-medium text-muted-foreground">
            Category
          </label>
          <Select
            id={`${id}-category`}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value === "" ? "" : Number(event.target.value))}
            className="w-full"
          >
            <option value="">Choose a category…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryLabel(category.id, category.name)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          Add rule
        </Button>
      </div>
      {missing && incomplete && (
        <p role="alert" className="text-xs text-destructive">
          {kind === "app" ? "Choose an app and a category." : "Enter a pattern and choose a category."}
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
