import { useT, type Messages } from "@/shared/i18n";
import type { RulePreviewDto } from "@/shared/ipc";
import { formatDuration } from "@/shared/lib/time";

/** What the rule form knows about the rule being written. */
export type RulePreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "error" }
  | { status: "ready"; preview: RulePreviewDto };

/** The sentence under the rule form; exported for tests. */
export function previewSentence(state: RulePreviewState, days: number, t: Messages): string {
  const words = t.activities.preview;
  switch (state.status) {
    case "idle":
      return words.idle(days);
    case "loading":
      return words.loading(days);
    case "invalid":
      return words.invalid;
    case "error":
      return words.error;
    case "ready": {
      const { total_ms: total, windows, unassigned_ms: unassigned } = state.preview;
      if (total <= 0) return words.none(days);
      const covered = words.covered(formatDuration(total), days, windows);
      if (unassigned <= 0) return covered;
      return `${covered} ${unassigned >= total ? words.allUnassigned : words.someUnassigned(formatDuration(unassigned))}`;
    }
  }
}

/** Live, politely announced preview of how much tracked time a rule would cover. */
export function RulePreview({ state, days }: { state: RulePreviewState; days: number }) {
  const t = useT();
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="rule-preview"
      className="rounded-md bg-surface px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      {previewSentence(state, days, t)}
    </p>
  );
}
