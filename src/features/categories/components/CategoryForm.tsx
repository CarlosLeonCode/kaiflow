import { useId, useState, type FormEvent } from "react";

import type { CategoryDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { MAX_NAME_LENGTH, nameProblem, nameProblemMessage } from "../lib/rules";
import type { Submit } from "../lib/submit";
import { ColorPicker } from "./ColorPicker";

interface Props {
  /** `null` creates a new category. */
  editing: CategoryDto | null;
  existing: readonly CategoryDto[];
  initialColor: string;
  dark: boolean;
  onSubmit: Submit<{ name: string; color: string }>;
  onCancel: () => void;
}

/** Name + color form used for both creating and renaming (Enter saves, Escape cancels). */
export function CategoryForm({ editing, existing, initialColor, dark, onSubmit, onCancel }: Props) {
  const id = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.color ?? initialColor);
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problem = nameProblem(name, existing, editing?.id ?? null);
  const shown = failure ?? (touched && problem ? nameProblemMessage(problem) : null);
  const errorId = `${id}-error`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    const result = await onSubmit({ name: name.trim(), color });
    setBusy(false);
    if (result) setFailure(result.message);
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
      aria-label={editing ? `Edit category ${editing.name}` : "New category"}
      className="space-y-2.5 px-3 py-3"
    >
      <div>
        <label htmlFor={`${id}-name`} className="mb-1 block text-xs font-medium text-muted-foreground">
          Name
        </label>
        <Input
          id={`${id}-name`}
          autoFocus
          value={name}
          maxLength={MAX_NAME_LENGTH + 10}
          onChange={(event) => {
            setName(event.target.value);
            setFailure(null);
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? errorId : undefined}
          placeholder="For example, Deep work"
          className="w-full"
        />
        {shown && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
            {shown}
          </p>
        )}
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Color</span>
        <ColorPicker value={color} onChange={setColor} dark={dark} idPrefix={id} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          {editing ? "Save" : "Add category"}
        </Button>
      </div>
    </form>
  );
}
