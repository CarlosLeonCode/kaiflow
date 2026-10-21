import { Check, X } from "lucide-react";

import type { SuggestionDto } from "@/shared/ipc";
import { Button } from "@/shared/ui/button";

import type { Submit } from "../lib/submit";

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
  if (suggestions.length === 0) return null;

  async function run(action: Submit<string>, appId: string) {
    const result = await action(appId);
    if (result) onFailure(result.message);
  }

  return (
    <section aria-label="Suggestions" className="mb-6 space-y-2">
      <div className="px-1">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Suggestions</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          These apps are not in any activity yet. Accept a suggestion to add a rule for the app, or dismiss it and it
          will not come back.
        </p>
      </div>
      <ul aria-label="Suggestion list" className="divide-y divide-border rounded-lg border border-border bg-background">
        {suggestions.map((suggestion) => (
          <li key={suggestion.app_id} className="flex items-center gap-2.5 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={suggestion.app_name}>
                {suggestion.app_name}
              </span>
              <span className="block text-xs text-muted-foreground">
                Suggested activity: {suggestion.activity_name}
                {suggestion.activity_id === null && " (new)"}
              </span>
            </span>
            <Button
              size="sm"
              aria-label={`Accept ${suggestion.app_name} as ${suggestion.activity_name}`}
              onClick={() => void run(onAccept, suggestion.app_id)}
            >
              <Check aria-hidden="true" /> Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Dismiss suggestion for ${suggestion.app_name}`}
              onClick={() => void run(onDismiss, suggestion.app_id)}
            >
              <X aria-hidden="true" /> Dismiss
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
