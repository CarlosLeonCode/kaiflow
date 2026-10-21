import type { RulePreviewDto } from "@/shared/ipc";
import { formatDuration } from "@/shared/lib/time";

/** What the rule form knows about the rule being written. */
export type RulePreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "error" }
  | { status: "ready"; preview: RulePreviewDto };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The sentence under the rule form; exported for tests. */
export function previewSentence(state: RulePreviewState, days: number): string {
  const period = `the last ${days} days`;
  switch (state.status) {
    case "idle":
      return `Pick an app or type some text to see how much of ${period} this rule would cover.`;
    case "loading":
      return `Checking ${period}…`;
    case "invalid":
      return "This pattern is not complete yet, so nothing can be matched.";
    case "error":
      return "Could not check your history right now. You can still add the rule.";
    case "ready": {
      const { total_ms: total, windows, unassigned_ms: unassigned } = state.preview;
      if (total <= 0) {
        return `This rule would not cover any time from ${period}. It still applies to new time.`;
      }
      const covered = `This rule would cover ${formatDuration(total)} from ${period} across ${plural(windows, "window", "windows")}.`;
      if (unassigned <= 0) return covered;
      return unassigned >= total
        ? `${covered} All of it is Unassigned now.`
        : `${covered} ${formatDuration(unassigned)} of it is Unassigned now.`;
    }
  }
}

/** Live, politely announced preview of how much tracked time a rule would cover. */
export function RulePreview({ state, days }: { state: RulePreviewState; days: number }) {
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="rule-preview"
      className="rounded-md bg-surface px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      {previewSentence(state, days)}
    </p>
  );
}
