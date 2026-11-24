import { useState } from "react";

import { useT } from "@/shared/i18n";
import type { PresetDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";

import { exampleApps } from "../lib/presets";
import { productivityLabel } from "../lib/productivity";
import type { Submit } from "../lib/submit";

interface Props {
  packs: readonly PresetDto[];
  /** Applies the pack with this key; resolves with an error to show, or `null`. */
  onApply: Submit<string>;
  /** "Start empty": nothing is created; the guided setup offers to name a first activity. */
  onStartEmpty: () => void;
}

/**
 * Step 1 of the guided setup: optional ready-made sets of activities next to "Start empty".
 * Every option is a card of the same size and weight, none is preselected, and nothing is
 * created until the user confirms a pack after seeing what it contains.
 */
export function PresetChooser({ packs, onApply, onStartEmpty }: Props) {
  const t = useT();
  const words = t.activities.presets;
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
      <section aria-label={words.packTitle(selected.name)} className="rounded-card border border-border bg-background p-5">
        <h4 className="text-sm font-semibold">{words.packTitle(selected.name)}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{words.adds}</p>
        <ul aria-label={words.activitiesIn(selected.name)} className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {selected.activities.map((activity) => (
            <li key={activity.key} className="flex items-center gap-2.5 px-3 py-2">
              <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: activity.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{activity.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {productivityLabel(activity.productivity, t)}
                  {activity.example_apps.length > 0 && words.examples(exampleApps(activity))}
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
            {words.add(selected.name)}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setError(null);
            }}
          >
            {words.back}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">{words.intro}</p>
      <ul aria-label={words.waysToStart} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {packs.map((pack) => (
          <li key={pack.key} className="flex flex-col rounded-2xl border border-border bg-background p-4">
            <h4 className="font-medium">{pack.name}</h4>
            <p className="mt-0.5 flex-1 text-xs text-muted-foreground">{pack.description}</p>
            <Button className="mt-3 self-start" aria-label={words.previewLabel(pack.name)} onClick={() => setSelected(pack)}>
              {words.preview}
            </Button>
          </li>
        ))}
        <li className="flex flex-col rounded-2xl border border-border bg-background p-4">
          <h4 className="font-medium">{words.startEmpty}</h4>
          <p className="mt-0.5 flex-1 text-xs text-muted-foreground">{words.startEmptyText}</p>
          <Button className="mt-3 self-start" onClick={onStartEmpty}>
            {words.startEmpty}
          </Button>
        </li>
      </ul>
    </div>
  );
}
