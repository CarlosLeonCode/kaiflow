import { Archive, ArchiveRestore, CircleAlert, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ActivityDto, GoalDto, GoalStatusDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Dialog } from "@/shared/ui/dialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Page, type IntroSlot } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";
import type { Submit } from "@/features/activities/lib/submit";

import { goalSentence, unseenLabel, type NameLookup } from "../lib/goals";
import { GoalBar, StateBadge } from "./GoalBar";
import { GoalForm } from "./GoalForm";
import { StreakLine } from "./GoalSummary";

interface Props {
  /** Section intro and its header help button, rendered by `Page`. */
  intro?: IntroSlot;
  loading: boolean;
  error: string | null;
  /** Progress of the goals that are not archived. */
  statuses: readonly GoalStatusDto[];
  /** Archived goals (kept, but not shown as progress). */
  archived: readonly GoalDto[];
  activities: readonly ActivityDto[];
  apps: readonly AppOption[];
  names: NameLookup;
  onSave: Submit<GoalDto>;
  onDelete: Submit<number>;
  onMarkSeen: (goalId: number) => void;
}

type Mode = { kind: "idle" } | { kind: "create" } | { kind: "edit"; goal: GoalDto };

/** Goals section (presentational): the list with progress, and a dialog to create or edit. */
export function GoalsView({
  intro,
  loading,
  error,
  statuses,
  archived,
  activities,
  apps,
  names,
  onSave,
  onDelete,
  onMarkSeen,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [pendingDelete, setPendingDelete] = useState<GoalDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const close = () => setMode({ kind: "idle" });
  const empty = !loading && !error && statuses.length === 0 && archived.length === 0;

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

  async function setArchived(goal: GoalDto, value: boolean) {
    const result = await onSave({ ...goal, archived: value });
    setRowError(result ? result.message : null);
  }

  return (
    <Page
      title="Goals"
      subtitle="Targets for your time, and how you are doing."
      intro={intro}
      actions={
        <Button size="sm" variant="primary" onClick={() => setMode({ kind: "create" })}>
          <Plus aria-hidden="true" /> New goal
        </Button>
      }
    >
      <div className="max-w-2xl space-y-6">
        {error && (
          <Alert variant="warning" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>Could not load goals: {error}</AlertDescription>
          </Alert>
        )}
        {rowError && (
          <Alert variant="warning" role="alert">
            <AlertDescription>{rowError}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="space-y-3" aria-label="Loading goals">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : empty ? (
          <EmptyState
            title="No goals yet"
            action={{ label: "Create a goal", onClick: () => setMode({ kind: "create" }) }}
          >
            Set a target for an activity, an app or all your tracked time, like at least 4 hours of focused work every
            weekday or at most 30 minutes in email a day. Goals never block anything: they only keep you informed.
          </EmptyState>
        ) : (
          <>
            {statuses.length > 0 && (
              <section aria-label="Active goals" className="space-y-2">
                <h2 className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Active</h2>
                <ul aria-label="Goal list" className="divide-y divide-border rounded-lg border border-border bg-background">
                  {statuses.map((status) => {
                    const { goal, unseen } = status;
                    return (
                      <li key={goal.id} className="group space-y-1.5 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2">
                              <span className="truncate font-medium" title={goal.label}>
                                {goal.label}
                              </span>
                              {unseen && (
                                <button
                                  type="button"
                                  data-testid="goal-badge"
                                  onClick={() => onMarkSeen(goal.id)}
                                  aria-label={`${unseenLabel(unseen)}: ${goal.label}. Dismiss`}
                                  title="Dismiss"
                                  className="shrink-0 rounded-full bg-warning px-2 py-0.5 text-2xs font-medium text-warning-foreground hover:opacity-80"
                                >
                                  {unseenLabel(unseen)}
                                </button>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{goalSentence(goal, names)}</p>
                          </div>
                          <span className="flex shrink-0 items-center gap-1">
                            <StateBadge status={status} />
                            <span className="flex gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${goal.label}`}
                                onClick={() => setMode({ kind: "edit", goal })}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Archive ${goal.label}`}
                                onClick={() => void setArchived(goal, true)}
                              >
                                <Archive />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${goal.label}`}
                                onClick={() => {
                                  setDeleteError(null);
                                  setPendingDelete(goal);
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </span>
                          </span>
                        </div>
                        <GoalBar status={status} />
                        <StreakLine status={status} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {archived.length > 0 && (
              <section aria-label="Archived goals" className="space-y-2">
                <h2 className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Archived</h2>
                <ul aria-label="Archived list" className="divide-y divide-border rounded-lg border border-border bg-background">
                  {archived.map((goal) => (
                    <li key={goal.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={goal.label}>
                          {goal.label}
                        </p>
                        <p className="text-xs text-muted-foreground">{goalSentence(goal, names)}</p>
                      </div>
                      <span className="flex shrink-0 gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Restore ${goal.label}`}
                          onClick={() => void setArchived(goal, false)}
                        >
                          <ArchiveRestore />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${goal.label}`}
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete(goal);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <Dialog
        open={mode.kind !== "idle"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={mode.kind === "edit" ? "Edit goal" : "New goal"}
        description="Goals only keep you informed: nothing is ever blocked."
      >
        {mode.kind !== "idle" && (
          <GoalForm
            editing={mode.kind === "edit" ? mode.goal : null}
            activities={activities}
            apps={apps}
            names={names}
            onSubmit={async (goal) => {
              const result = await onSave(goal);
              if (!result) close();
              return result;
            }}
            onCancel={close}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title={`Delete "${pendingDelete?.label ?? ""}"?`}
        description={
          <>
            <p>The goal and its streak history are removed. Your tracked time is not touched.</p>
            <p>This cannot be undone. You can archive a goal instead to keep it.</p>
          </>
        }
        confirmLabel="Delete goal"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />
    </Page>
  );
}
