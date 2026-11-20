import { useId } from "react";

import { useT } from "@/shared/i18n";

import { DURATION_PRESETS } from "../lib/focus";

interface Props {
  busy?: boolean;
  /** Why starting failed, when it did. */
  error?: string | null;
  onStart: (minutes: number) => void;
}

/** The popover's one-click timer: one chip per preset length. Naming the task lives in Focus. */
export function QuickStart({ busy = false, error, onStart }: Props) {
  const t = useT();
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={`${id}-title`} className="text-xs font-medium text-muted-foreground">
        {t.focus.quick.title}
      </h2>
      <div className="flex gap-1.5">
        {DURATION_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            disabled={busy}
            aria-label={t.focus.minutes(minutes)}
            onClick={() => onStart(minutes)}
            className="tabular h-7 min-w-11 rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-50"
          >
            {minutes}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
