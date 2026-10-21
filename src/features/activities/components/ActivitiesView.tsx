import { CircleAlert } from "lucide-react";

import type { ActivityDto, PresetDto, RuleDto, RuleInputDto, RuleSpecDto, SuggestionDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Page, type IntroSlot } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";

import { focusFirstControl } from "../lib/guide";
import type { ActivityFormValue } from "../lib/productivity";
import type { Submit } from "../lib/submit";
import { ActivityPanel } from "./ActivityPanel";
import { GuidedSetup } from "./GuidedSetup";
import { RULE_FORM_ID } from "./RuleForm";
import type { RulePreviewState } from "./RulePreview";
import { RulesPanel } from "./RulesPanel";
import { SUGGESTIONS_ID, SuggestionsPanel } from "./SuggestionsPanel";

interface Props {
  /** Section intro and its header help button, rendered by `Page`. */
  intro?: IntroSlot;
  loading: boolean;
  error: string | null;
  activities: readonly ActivityDto[];
  rules: readonly RuleDto[];
  apps: readonly AppOption[];
  ruleCounts: ReadonlyMap<number, number>;
  dark: boolean;
  /** `null` hides the guided setup; `"auto"` is the first-run showing, `"opened"` was asked for. */
  guide: "auto" | "opened" | null;
  /** Suggested sets of activities for step 1 of the guide. */
  packs: readonly PresetDto[];
  suggestions: readonly SuggestionDto[];
  /** Unassigned time over the last `recentDays` days. */
  unassignedMs: number | null;
  recentDays: number;
  preview: RulePreviewState;
  previewDays: number;
  /** Confirmation of the last pack applied or suggestion accepted. */
  notice: string | null;
  onOpenGuide: () => void;
  onCloseGuide: () => void;
  onRuleDraftChange: (spec: RuleSpecDto | null) => void;
  onApplyPreset: Submit<string>;
  onAcceptSuggestion: Submit<string>;
  onDismissSuggestion: Submit<string>;
  onDismissNotice: () => void;
  onCreate: Submit<ActivityFormValue>;
  onUpdate: Submit<ActivityDto>;
  onDeleteActivity: Submit<number>;
  onSaveRules: Submit<readonly RuleInputDto[]>;
  onDeleteRule: Submit<number>;
  onFailure: (message: string) => void;
  onDismissError: () => void;
}

/** Activities section (presentational): the guide, activities on the left, ordered rules on the right. */
export function ActivitiesView(props: Props) {
  const { loading, error, activities, suggestions, notice, guide } = props;
  const showSuggestions = suggestions.length > 0 ? () => focusFirstControl(SUGGESTIONS_ID) : undefined;

  return (
    <Page
      title="Activities"
      subtitle="Sort your time into the kinds of work you do."
      intro={props.intro}
      actions={
        <Button size="sm" variant="ghost" aria-expanded={guide !== null} onClick={props.onOpenGuide}>
          How this works
        </Button>
      }
    >
      {error && (
        <Alert variant="warning" role="alert" className="mb-4 items-start justify-between">
          <span className="flex gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </span>
          <button type="button" onClick={props.onDismissError} className="shrink-0 underline underline-offset-2">
            Dismiss
          </button>
        </Alert>
      )}
      {notice && (
        <Alert className="mb-4 items-start justify-between">
          <AlertDescription>{notice}</AlertDescription>
          <button type="button" onClick={props.onDismissNotice} className="shrink-0 underline underline-offset-2">
            Dismiss
          </button>
        </Alert>
      )}
      {!loading && guide && (
        <GuidedSetup
          autoFocus={guide === "opened"}
          packs={props.packs}
          activities={activities}
          dark={props.dark}
          previewDays={props.previewDays}
          hasSuggestions={suggestions.length > 0}
          onApplyPreset={props.onApplyPreset}
          onCreate={props.onCreate}
          onUpdate={props.onUpdate}
          onAddRule={() => focusFirstControl(RULE_FORM_ID)}
          onShowSuggestions={() => focusFirstControl(SUGGESTIONS_ID)}
          onClose={props.onCloseGuide}
        />
      )}
      {!loading && (
        <SuggestionsPanel
          suggestions={suggestions}
          onAccept={props.onAcceptSuggestion}
          onDismiss={props.onDismissSuggestion}
          onFailure={props.onFailure}
        />
      )}
      {loading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" aria-label="Loading activities">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ActivityPanel
            activities={activities}
            ruleCounts={props.ruleCounts}
            dark={props.dark}
            onCreate={props.onCreate}
            onUpdate={props.onUpdate}
            onDelete={props.onDeleteActivity}
            unassignedMs={props.unassignedMs}
            recentDays={props.recentDays}
            onShowSuggestions={showSuggestions}
          />
          <RulesPanel
            rules={props.rules}
            activities={activities}
            apps={props.apps}
            onSave={props.onSaveRules}
            onDelete={props.onDeleteRule}
            onFailure={props.onFailure}
            onDraftChange={props.onRuleDraftChange}
            preview={props.preview}
            previewDays={props.previewDays}
          />
        </div>
      )}
    </Page>
  );
}
