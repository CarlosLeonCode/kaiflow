import { Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { useT } from "@/shared/i18n";
import type { AppOption } from "@/shared/lib/apps";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Select } from "@/shared/ui/select";

import { bundleIdProblem, type PrivacyMode, type PrivacyRow } from "../lib/apps";

const MODES: readonly PrivacyMode[] = ["exclude", "redact_title"];

interface Props {
  rows: readonly PrivacyRow[];
  /** Apps seen recently, offered as suggestions. */
  apps: readonly AppOption[];
  /** Resolves to an error message, or `null` on success. */
  onSet: (appId: string, mode: PrivacyMode | null) => Promise<string | null>;
  onFailure: (message: string) => void;
}

/**
 * Excluded apps (per-app privacy rules in code). "Never record" drops the app entirely (no segment, no title);
 * "Hide titles" keeps the time but never stores the window title (R10.2, R10.3). Both only
 * affect what is recorded from now on (R10.5).
 */
export function AppRulesPanel({ rows, apps, onSet, onFailure }: Props) {
  const t = useT();
  const words = t.privacy.apps;
  const modes: SegmentedOption<PrivacyMode>[] = MODES.map((value) => ({ value, label: words.modes[value] }));
  const id = useId();
  const [appId, setAppId] = useState("");
  const [mode, setMode] = useState<PrivacyMode>("exclude");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = `${id}-error`;
  const listId = `${id}-apps`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid = bundleIdProblem(appId, t);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setBusy(true);
    const failure = await onSet(appId.trim(), mode);
    setBusy(false);
    if (failure) setProblem(failure);
    else {
      setAppId("");
      setProblem(null);
    }
  }

  async function change(row: PrivacyRow, next: PrivacyMode | null) {
    const failure = await onSet(row.appId, next);
    if (failure) onFailure(failure);
  }

  return (
    <section aria-label={words.title} className="space-y-2">
      <div className="px-1">
        <h2 className="font-display text-sm leading-[1.2] font-bold text-foreground">{words.title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{words.intro}</p>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-background">
        <form onSubmit={submit} aria-label={words.formLabel} className="space-y-2.5 px-4 py-3">
          <div>
            <label htmlFor={`${id}-app`} className="mb-1 block text-xs font-medium text-muted-foreground">
              {words.app}
            </label>
            <Input
              id={`${id}-app`}
              list={listId}
              value={appId}
              onChange={(event) => {
                setAppId(event.target.value);
                setProblem(null);
              }}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? errorId : undefined}
              placeholder={words.placeholder}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="w-full"
            />
            <datalist id={listId}>
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </datalist>
            {problem && (
              <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
                {problem}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented aria-label={words.mode} value={mode} options={modes} onChange={setMode} />
            <Button type="submit" variant="primary" disabled={busy}>
              {words.add}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {words.modeHints[mode]}
          </p>
        </form>

        {rows.length === 0 ? (
          <p className="px-4 py-5 text-center text-xs text-muted-foreground">{words.none}</p>
        ) : (
          <ul aria-label={words.list} className="px-2.5 py-2">
            {rows.map((row) => (
              <li key={row.appId} className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-accent/50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={row.name}>
                    {row.name}
                  </span>
                  {row.name !== row.appId && (
                    <span data-selectable className="block truncate text-2xs text-muted-foreground">
                      {row.appId}
                    </span>
                  )}
                </span>
                <Select
                  aria-label={words.privacyFor(row.name)}
                  value={row.mode}
                  onChange={(event) => void change(row, event.target.value as PrivacyMode)}
                >
                  <option value="exclude">{words.modes.exclude}</option>
                  <option value="redact_title">{words.modes.redact_title}</option>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={words.remove(row.name)}
                  onClick={() => void change(row, null)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
