import { useId, useState, type FormEvent } from "react";

import type { ActivityDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Segmented } from "@/shared/ui/segmented";

import { DEFAULT_PRODUCTIVITY, PRODUCTIVITY_OPTIONS, type ActivityFormValue } from "../lib/productivity";
import { MAX_NAME_LENGTH, nameProblem, nameProblemMessage } from "../lib/rules";
import type { Submit } from "../lib/submit";
import { ColorPicker } from "./ColorPicker";

interface Props {
  /** `null` creates a new activity. */
  editing: ActivityDto | null;
  existing: readonly ActivityDto[];
  initialColor: string;
  dark: boolean;
  onSubmit: Submit<ActivityFormValue>;
  onCancel: () => void;
}

/** Name + color form used for both creating and renaming (Enter saves, Escape cancels). */
export function ActivityForm({ editing, existing, initialColor, dark, onSubmit, onCancel }: Props) {
  const id = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.color ?? initialColor);
  const [productivity, setProductivity] = useState(editing?.productivity ?? DEFAULT_PRODUCTIVITY);
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
    const result = await onSubmit({ name: name.trim(), color, productivity });
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
      aria-label={editing ? `Edit activity ${editing.name}` : "New activity"}
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
      <div>
        <span id={`${id}-productivity`} className="mb-1 block text-xs font-medium text-muted-foreground">
          Counts as
        </span>
        <Segmented
          aria-label="Productivity"
          value={productivity}
          options={PRODUCTIVITY_OPTIONS}
          onChange={setProductivity}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Used for the focus ratio in your reports. Leave it on Neutral if you are unsure.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          {editing ? "Save" : "Add activity"}
        </Button>
      </div>
    </form>
  );
}
