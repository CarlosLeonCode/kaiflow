import { Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import type { AppOption } from "@/shared/lib/apps";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Select } from "@/shared/ui/select";

import { bundleIdProblem, MODE_LABEL, type PrivacyMode, type PrivacyRow } from "../lib/apps";

const MODES: readonly SegmentedOption<PrivacyMode>[] = [
  { value: "exclude", label: MODE_LABEL.exclude },
  { value: "redact_title", label: MODE_LABEL.redact_title },
];

interface Props {
  rows: readonly PrivacyRow[];
  /** Apps seen recently, offered as suggestions. */
  apps: readonly AppOption[];
  /** Resolves to an error message, or `null` on success. */
  onSet: (appId: string, mode: PrivacyMode | null) => Promise<string | null>;
  onFailure: (message: string) => void;
}

/**
 * Per-app privacy rules. "Never record" drops the app entirely (no segment, no title);
 * "Hide titles" keeps the time but never stores the window title (R10.2, R10.3). Both only
 * affect what is recorded from now on (R10.5).
 */
export function AppRulesPanel({ rows, apps, onSet, onFailure }: Props) {
  const id = useId();
  const [appId, setAppId] = useState("");
  const [mode, setMode] = useState<PrivacyMode>("exclude");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = `${id}-error`;
  const listId = `${id}-apps`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid = bundleIdProblem(appId);
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
    <section aria-label="Apps" className="space-y-2">
      <div className="px-1">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Apps</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Applies from now on. Time and titles already recorded stay until you delete them below.
        </p>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        <form onSubmit={submit} aria-label="Add app rule" className="space-y-2.5 px-3 py-3">
          <div>
            <label htmlFor={`${id}-app`} className="mb-1 block text-xs font-medium text-muted-foreground">
              App
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
              placeholder="Pick a recent app or type a bundle id"
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
            <Segmented aria-label="Privacy mode" value={mode} options={MODES} onChange={setMode} />
            <Button type="submit" variant="primary" disabled={busy}>
              Add app
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "exclude"
              ? "Nothing is recorded while this app is in front: no time, no title."
              : "Time is recorded, but the window title is never stored."}
          </p>
        </form>

        {rows.length === 0 ? (
          <p className="px-3 py-5 text-center text-xs text-muted-foreground">
            No apps listed. Add a password manager or a private chat app to keep it out of your records.
          </p>
        ) : (
          <ul aria-label="App privacy rules" className="px-1.5 py-1.5">
            {rows.map((row) => (
              <li key={row.appId} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50">
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
                  aria-label={`Privacy for ${row.name}`}
                  value={row.mode}
                  onChange={(event) => void change(row, event.target.value as PrivacyMode)}
                >
                  <option value="exclude">{MODE_LABEL.exclude}</option>
                  <option value="redact_title">{MODE_LABEL.redact_title}</option>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${row.name}`}
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
