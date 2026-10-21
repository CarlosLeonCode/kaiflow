import { useState } from "react";

import type { PresetDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";

import { exampleApps } from "../lib/presets";
import { productivityLabel } from "../lib/productivity";
import type { Submit } from "../lib/submit";

interface Props {
  packs: readonly PresetDto[];
  /** Applies the pack with this key; resolves with an error to show, or `null`. */
  onApply: Submit<string>;
  /** "Start empty": nothing is created, the choice is only remembered. */
  onStartEmpty: () => void;
}

/**
 * First-run choice for an empty Activities section. Every option is a card of the same size
 * and weight, none is preselected, and nothing is created until the user confirms a pack
 * after seeing what it contains.
 */
export function PresetChooser({ packs, onApply, onStartEmpty }: Props) {
  const [selected, setSelected] = useState<PresetDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(pack: PresetDto) {
    setBusy(true);
    const result = await onApply(pack.key);
    setBusy(false);
    if (result) setError(result.message);
  }

  if (selected) {
    return (
      <section aria-label={`${selected.name} pack`} className="mb-6 rounded-lg border border-border bg-background p-4">
        <h2 className="text-sm font-semibold">{selected.name} pack</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          This adds the activities below. Rules are created only for apps already in your history, and you can
          edit or delete everything afterwards.
        </p>
        <ul aria-label={`Activities in the ${selected.name} pack`} className="mt-3 divide-y divide-border rounded-md border border-border">
          {selected.activities.map((activity) => (
            <li key={activity.key} className="flex items-center gap-2.5 px-3 py-2">
              <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: activity.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{activity.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {productivityLabel(activity.productivity)}
                  {activity.example_apps.length > 0 && ` · e.g. ${exampleApps(activity)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void apply(selected)}>
            Add {selected.name} activities
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setError(null);
            }}
          >
            Back
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Get started" className="mb-6">
      <h2 className="text-sm font-semibold">How would you like to start?</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Pick a ready-made set of activities to preview, or start empty and build your own. Nothing is added until
        you confirm.
      </p>
      <ul aria-label="Ways to start" className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {packs.map((pack) => (
          <li key={pack.key} className="flex flex-col rounded-lg border border-border bg-background p-3">
            <h3 className="font-medium">{pack.name}</h3>
            <p className="mt-0.5 flex-1 text-xs text-muted-foreground">{pack.description}</p>
            <Button className="mt-3 self-start" aria-label={`Preview the ${pack.name} pack`} onClick={() => setSelected(pack)}>
              Preview
            </Button>
          </li>
        ))}
        <li className="flex flex-col rounded-lg border border-border bg-background p-3">
          <h3 className="font-medium">Start empty</h3>
          <p className="mt-0.5 flex-1 text-xs text-muted-foreground">
            Create your own activities and rules. Nothing is added for you.
          </p>
          <Button className="mt-3 self-start" onClick={onStartEmpty}>
            Start empty
          </Button>
        </li>
      </ul>
    </section>
  );
}
