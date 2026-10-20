import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { CategoryDto } from "@/shared/ipc";
import { tuneCategoryColor } from "@/shared/lib/color";
import { categoryLabel, UNCATEGORIZED_ID } from "@/shared/lib/labels";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";

import { suggestColor } from "../lib/palette";
import type { Submit } from "../lib/submit";
import { CategoryForm } from "./CategoryForm";

interface Props {
  categories: readonly CategoryDto[];
  /** Number of rules that point at each category id. */
  ruleCounts: ReadonlyMap<number, number>;
  dark: boolean;
  onCreate: Submit<{ name: string; color: string }>;
  onUpdate: Submit<CategoryDto>;
  onDelete: Submit<number>;
}

type Mode = { kind: "idle" } | { kind: "create" } | { kind: "edit"; id: number };

/** Category list with inline create/edit and a confirmed delete (R9.1). */
export function CategoryPanel({ categories, ruleCounts, dark, onCreate, onUpdate, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [pendingDelete, setPendingDelete] = useState<CategoryDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const close = () => setMode({ kind: "idle" });

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
    <section aria-label="Categories" className="space-y-2">
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Categories</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Group apps and window titles to see where your time goes.</p>
        </div>
        <Button size="sm" onClick={() => setMode({ kind: "create" })} disabled={mode.kind === "create"}>
          <Plus aria-hidden="true" /> New category
        </Button>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        {mode.kind === "create" && (
          <CategoryForm
            editing={null}
            existing={categories}
            initialColor={suggestColor(categories.map((c) => c.color))}
            dark={dark}
            onSubmit={async (value) => {
              const result = await onCreate(value);
              if (!result) close();
              return result;
            }}
            onCancel={close}
          />
        )}
        <ul aria-label="Category list" className="divide-y divide-border">
          {categories.map((category) => {
            const system = category.id === UNCATEGORIZED_ID;
            const count = ruleCounts.get(category.id) ?? 0;
            const label = categoryLabel(category.id, category.name);
            if (mode.kind === "edit" && mode.id === category.id) {
              return (
                <li key={category.id}>
                  <CategoryForm
                    editing={category}
                    existing={categories}
                    initialColor={category.color}
                    dark={dark}
                    onSubmit={async (value) => {
                      const result = await onUpdate({ ...category, ...value });
                      if (!result) close();
                      return result;
                    }}
                    onCancel={close}
                  />
                </li>
              );
            }
            return (
              <li key={category.id} className="group flex items-center gap-2.5 px-3 py-2">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: tuneCategoryColor(category.color, dark) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" title={label}>
                    {label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {system
                      ? "Default for anything without a rule"
                      : count === 0
                        ? "No rules"
                        : `${count} ${count === 1 ? "rule" : "rules"}`}
                  </span>
                </span>
                {!system && (
                  <span className="flex gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${label}`}
                      onClick={() => setMode({ kind: "edit", id: category.id })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${label}`}
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDelete(category);
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
              Time already tracked in this category moves to Uncategorized.
              {rulesOfDeleted > 0 &&
                ` Its ${rulesOfDeleted} ${rulesOfDeleted === 1 ? "rule is" : "rules are"} deleted too.`}
            </p>
            <p>The tracked time itself is kept. This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete category"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
