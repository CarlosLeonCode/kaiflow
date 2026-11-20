import { Check, X } from "lucide-react";

import { useT } from "@/shared/i18n";
import type { SuggestionDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";

import type { Submit } from "../lib/submit";

/** Id of the suggestions section, so the Unassigned row and the guide can take the user there. */
export const SUGGESTIONS_ID = "activity-suggestions";

interface Props {
  suggestions: readonly SuggestionDto[];
  onAccept: Submit<string>;
  onDismiss: Submit<string>;
  onFailure: (message: string) => void;
}

/**
 * Apps from your history that no rule covers, with a guess at where they belong. Nothing
 * happens until you accept; accepting adds an app rule, so past time is sorted too.
 */
export function SuggestionsPanel({ suggestions, onAccept, onDismiss, onFailure }: Props) {
  const t = useT();
  const words = t.activities.suggestions;
  if (suggestions.length === 0) return null;

  async function run(action: Submit<string>, appId: string) {
    const result = await action(appId);
    if (result) onFailure(result.message);
  }

  return (
    <section id={SUGGESTIONS_ID} tabIndex={-1} aria-label={words.title} className="mb-6 space-y-2">
      <div className="px-1">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{words.title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{words.intro}</p>
      </div>
      <ul aria-label={words.list} className="divide-y divide-border rounded-lg border border-border bg-background">
        {suggestions.map((suggestion) => (
          <li key={suggestion.app_id} className="flex items-center gap-2.5 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={suggestion.app_name}>
                {suggestion.app_name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {words.suggested(suggestion.activity_name)}
                {suggestion.activity_id === null && words.isNew}
              </span>
            </span>
            <Button
              size="sm"
              aria-label={words.acceptLabel(suggestion.app_name, suggestion.activity_name)}
              onClick={() => void run(onAccept, suggestion.app_id)}
            >
              <Check aria-hidden="true" /> {words.accept}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={words.dismissLabel(suggestion.app_name)}
              onClick={() => void run(onDismiss, suggestion.app_id)}
            >
              <X aria-hidden="true" /> {t.common.dismiss}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
