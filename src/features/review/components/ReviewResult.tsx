import { useT } from "@/shared/i18n";
import type { AiReviewDto } from "@/shared/ipc";

/** One stored answer: the structured review, or the plain text the model sent instead. */
export function ReviewResult({ review }: { review: AiReviewDto }) {
  const words = useT().review.result;
  const output = review.output;
  if (!output) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{words.unformatted}</p>
        <p data-selectable className="whitespace-pre-wrap">
          {review.text}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p data-selectable data-testid="review-summary">
        {output.summary}
      </p>
      {output.wins.length > 0 && (
        <section aria-label={words.wins}>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{words.wins}</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {output.wins.map((win) => (
              <li key={win} data-selectable>
                {win}
              </li>
            ))}
          </ul>
        </section>
      )}
      {output.patterns.length > 0 && (
        <section aria-label={words.patterns}>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{words.patterns}</h4>
          <ul className="mt-1 space-y-1.5">
            {output.patterns.map((pattern) => (
              <li key={pattern.observation} data-selectable>
                <span className="font-medium">{pattern.observation}</span>
                <span className="block text-xs text-muted-foreground">{pattern.evidence}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {output.goal_misses.length > 0 && (
        <section aria-label={words.goalMisses}>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{words.goalMisses}</h4>
          <ul className="mt-1 space-y-1.5">
            {output.goal_misses.map((miss) => (
              <li key={miss.goal} data-selectable>
                <span className="font-medium">{miss.goal}</span>
                <span className="block text-xs text-muted-foreground">{miss.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {output.suggestions.length > 0 && (
        <section aria-label={words.suggestions}>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{words.suggestions}</h4>
          <ul className="mt-1 space-y-1.5">
            {output.suggestions.map((suggestion) => (
              <li key={suggestion.action} data-selectable>
                <span className="font-medium">{suggestion.action}</span>
                <span className="block text-xs text-muted-foreground">{suggestion.rationale}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
