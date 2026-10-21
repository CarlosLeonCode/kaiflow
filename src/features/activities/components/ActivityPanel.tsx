import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ActivityDto } from "@/shared/ipc";
import { tuneActivityColor } from "@/shared/lib/color";
import { activityLabel, UNASSIGNED_ID } from "@/shared/lib/labels";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { HelpTip } from "@/shared/ui/help-tip";
import { formatDuration } from "@/shared/lib/time";

import { suggestColor } from "../lib/palette";
import { productivityLabel, type ActivityFormValue } from "../lib/productivity";
import type { Submit } from "../lib/submit";
import { ActivityForm } from "./ActivityForm";

interface Props {
  activities: readonly ActivityDto[];
  /** Number of rules that point at each activity id. */
  ruleCounts: ReadonlyMap<number, number>;
  dark: boolean;
  onCreate: Submit<ActivityFormValue>;
  onUpdate: Submit<ActivityDto>;
  onDelete: Submit<number>;
  /** Unassigned time over the last `recentDays` days; `null` while unknown. */
  unassignedMs?: number | null;
  recentDays?: number;
  /** Shown when there are suggestions for Unassigned apps: takes the user to them. */
  onShowSuggestions?: () => void;
}

type Mode = { kind: "idle" } | { kind: "create" } | { kind: "edit"; id: number };

/** Activity list with inline create/edit and a confirmed delete (R9.1). */
export function ActivityPanel({
  activities,
  ruleCounts,
  dark,
  onCreate,
  onUpdate,
  onDelete,
  unassignedMs = null,
  recentDays = 30,
  onShowSuggestions,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [pendingDelete, setPendingDelete] = useState<ActivityDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const close = () => setMode({ kind: "idle" });
  const onlySystem = activities.every((activity) => activity.id === UNASSIGNED_ID);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = await onDelete(pendingDelete.id);
    setDeleting(false);
    if (result) setDeleteError(result.message);
    else {
      setPendingDelete(null);
      setDeleteError(null);
    }
  }

  const rulesOfDeleted = pendingDelete ? (ruleCounts.get(pendingDelete.id) ?? 0) : 0;

  return (
    <section aria-label="Activities" className="space-y-2">
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Activities</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Labels for what you were doing, like Deep work or Client A.</p>
        </div>
        <Button size="sm" onClick={() => setMode({ kind: "create" })} disabled={mode.kind === "create"}>
          <Plus aria-hidden="true" /> New activity
        </Button>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        {mode.kind === "create" && (
          <ActivityForm
            editing={null}
            existing={activities}
            initialColor={suggestColor(activities.map((c) => c.color))}
            dark={dark}
            onSubmit={async (value) => {
              const result = await onCreate(value);
              if (!result) close();
              return result;
            }}
            onCancel={close}
          />
        )}
        {onlySystem && mode.kind === "idle" && (
          <EmptyState
            className="mt-0 px-3 py-6"
            title="No activities yet"
            action={{ label: "Create your first activity", onClick: () => setMode({ kind: "create" }) }}
          >
            Create an activity for each kind of work you want to see, then add a rule so time is sorted into it. Until
            then, all your time is Unassigned.
          </EmptyState>
        )}
        <ul aria-label="Activity list" className="divide-y divide-border">
          {activities.map((activity) => {
            const system = activity.id === UNASSIGNED_ID;
            const count = ruleCounts.get(activity.id) ?? 0;
            const label = activityLabel(activity.id, activity.name);
            if (mode.kind === "edit" && mode.id === activity.id) {
              return (
                <li key={activity.id}>
                  <ActivityForm
                    editing={activity}
                    existing={activities}
                    initialColor={activity.color}
                    dark={dark}
                    onSubmit={async (value) => {
                      const result = await onUpdate({ ...activity, ...value });
                      if (!result) close();
                      return result;
                    }}
                    onCancel={close}
                  />
                </li>
              );
            }
            return (
              <li key={activity.id} className="group flex items-center gap-2.5 px-3 py-2">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: tuneActivityColor(activity.color, dark) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="truncate font-medium" title={label}>
                      {label}
                    </span>
                    {system && (
                      <HelpTip label="Unassigned">
                        <p>
                          Unassigned is not an activity you create. It holds the time that no rule matches yet, so
                          nothing is lost.
                        </p>
                        <p className="mt-1.5">
                          Add a rule, or accept a suggestion, and that time moves to the right activity, past time
                          included.
                        </p>
                      </HelpTip>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {system
                      ? unassignedMs !== null && unassignedMs > 0
                        ? `Time no rule matches yet: ${formatDuration(unassignedMs)} in the last ${recentDays} days`
                        : "Time no rule matches yet"
                      : `${count === 0 ? "No rules" : `${count} ${count === 1 ? "rule" : "rules"}`} · ${productivityLabel(activity.productivity)}`}
                  </span>
                  {system && onShowSuggestions && (
                    <button
                      type="button"
                      onClick={onShowSuggestions}
                      className="mt-0.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      See suggestions
                    </button>
                  )}
                </span>
                {!system && (
                  <span className="flex gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${label}`}
                      onClick={() => setMode({ kind: "edit", id: activity.id })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${label}`}
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDelete(activity);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        description={
          <>
            <p>
              Time already tracked in this activity moves to Unassigned.
              {rulesOfDeleted > 0 &&
                ` Its ${rulesOfDeleted} ${rulesOfDeleted === 1 ? "rule is" : "rules are"} deleted too.`}
            </p>
            <p>The tracked time itself is kept. This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete activity"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
