import { useState } from "react";

import { Button } from "@/shared/ui/button";

import { MAX_NOTE_LENGTH } from "../lib/review";

interface Props {
  /** The saved note of the week. */
  note: string;
  saving: boolean;
  error: string | null;
  onSave: (note: string) => void;
}

/**
 * The personal note of a week. Mount it with `key={week}` so each week starts from its own
 * saved text; the draft is only sent when the user presses Save.
 */
export function NoteField({ note, saving, error, onSave }: Props) {
  const [draft, setDraft] = useState(note);
  const dirty = draft.trim() !== note.trim();
  return (
    <div className="space-y-2">
      <label htmlFor="review-note" className="sr-only">
        Your note about this week
      </label>
      <textarea
        id="review-note"
        data-selectable
        value={draft}
        maxLength={MAX_NOTE_LENGTH}
        rows={4}
        placeholder="What went well? What would you change next week? Only you see this note; it is never sent anywhere."
        onChange={(event) => setDraft(event.target.value)}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {error ? <span className="text-destructive">{error}</span> : dirty ? "Not saved yet." : note ? "Saved." : ""}
        </p>
        <Button size="sm" disabled={!dirty || saving} onClick={() => onSave(draft)}>
          Save note
        </Button>
      </div>
    </div>
  );
}
