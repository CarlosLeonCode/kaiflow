import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

import type { ActivityDto, PresetDto, RuleDto, RuleInputDto, SuggestionDto } from "@/shared/ipc";
import type { AppOption } from "@/shared/lib/apps";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Page } from "@/shared/ui/page";
import { Skeleton } from "@/shared/ui/skeleton";

import type { ActivityFormValue } from "../lib/productivity";
import type { Submit } from "../lib/submit";
import { ActivityPanel } from "./ActivityPanel";
import { PresetChooser } from "./PresetChooser";
import { RulesPanel } from "./RulesPanel";
import { SuggestionsPanel } from "./SuggestionsPanel";

interface Props {
  /** Dismissible section introduction, rendered by `Page`. */
  intro?: ReactNode;
  loading: boolean;
  error: string | null;
  activities: readonly ActivityDto[];
  rules: readonly RuleDto[];
  apps: readonly AppOption[];
  ruleCounts: ReadonlyMap<number, number>;
  dark: boolean;
  /** Preset packs to offer; `null` hides the first-run choice (already made, or not empty). */
  packs: readonly PresetDto[] | null;
  suggestions: readonly SuggestionDto[];
  /** Confirmation of the last pack applied or suggestion accepted. */
  notice: string | null;
  onApplyPreset: Submit<string>;
  onStartEmpty: () => void;
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

/** Activities section (presentational): activities on the left, ordered rules on the right. */
export function ActivitiesView({
  intro,
  loading,
  error,
  activities,
  rules,
  apps,
  ruleCounts,
  dark,
  packs,
  suggestions,
  notice,
  onApplyPreset,
  onStartEmpty,
  onAcceptSuggestion,
  onDismissSuggestion,
  onDismissNotice,
  onCreate,
  onUpdate,
  onDeleteActivity,
  onSaveRules,
  onDeleteRule,
  onFailure,
  onDismissError,
}: Props) {
  return (
    <Page title="Activities" subtitle="Organize your time with activities and rules." intro={intro}>
      {error && (
        <Alert variant="warning" role="alert" className="mb-4 items-start justify-between">
          <span className="flex gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </span>
          <button type="button" onClick={onDismissError} className="shrink-0 underline underline-offset-2">
            Dismiss
          </button>
        </Alert>
      )}
      {notice && (
        <Alert className="mb-4 items-start justify-between">
          <AlertDescription>{notice}</AlertDescription>
          <button type="button" onClick={onDismissNotice} className="shrink-0 underline underline-offset-2">
            Dismiss
          </button>
        </Alert>
      )}
      {!loading && packs && <PresetChooser packs={packs} onApply={onApplyPreset} onStartEmpty={onStartEmpty} />}
      {!loading && (
        <SuggestionsPanel
          suggestions={suggestions}
          onAccept={onAcceptSuggestion}
          onDismiss={onDismissSuggestion}
          onFailure={onFailure}
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
            ruleCounts={ruleCounts}
            dark={dark}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onDelete={onDeleteActivity}
          />
          <RulesPanel
            rules={rules}
            activities={activities}
            apps={apps}
            onSave={onSaveRules}
            onDelete={onDeleteRule}
            onFailure={onFailure}
          />
        </div>
      )}
    </Page>
  );
}
