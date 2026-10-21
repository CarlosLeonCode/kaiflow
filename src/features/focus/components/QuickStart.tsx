import { useId, useState } from "react";

import { Input } from "@/shared/ui/input";

import { DURATION_PRESETS, MAX_INTENT_LENGTH } from "../lib/focus";

interface Props {
  busy?: boolean;
  /** Why starting failed, when it did. */
  error?: string | null;
  onStart: (minutes: number, intent: string) => void;
}

/** The popover's one-click timer: an optional task name and a chip per preset length. */
export function QuickStart({ busy = false, error, onStart }: Props) {
  const id = useId();
  const [intent, setIntent] = useState("");
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-border bg-surface p-3">
      <h2 id={`${id}-title`} className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Start a timer
      </h2>
      <Input
        aria-label="Task (optional)"
        placeholder="What are you working on? (optional)"
        className="mt-2 h-8 w-full"
        maxLength={MAX_INTENT_LENGTH}
        value={intent}
        onChange={(event) => setIntent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !busy) onStart(DURATION_PRESETS[0], intent);
        }}
      />
      <div className="mt-2 grid grid-cols-3 gap-2">
        {DURATION_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            disabled={busy}
            aria-label={`${minutes} min`}
            onClick={() => onStart(minutes, intent)}
            className="flex h-12 flex-col items-center justify-center rounded-lg border border-border bg-background transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-50"
          >
            <span className="tabular text-lg font-semibold leading-none">{minutes}</span>{" "}
            <span className="mt-1 text-2xs text-muted-foreground">min</span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
