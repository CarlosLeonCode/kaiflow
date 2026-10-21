import { useMemo, useState } from "react";

import { useSectionIntro } from "@/features/shell/hooks/useSectionIntro";
import { useNow } from "@/features/tracking/hooks/useNow";
import {
  errorMessage,
  IpcError,
  useAcceptSuggestionMutation,
  useActivitiesQuery,
  useApplyPresetMutation,
  useCreateActivityMutation,
  useDeleteActivityMutation,
  useDeleteRuleMutation,
  useDismissedIntros,
  useDismissSuggestionMutation,
  usePresetsQuery,
  useReportQuery,
  useRulePreviewQuery,
  useRulesQuery,
  useSuggestionsQuery,
  useUpdateActivityMutation,
  useUpsertRulesMutation,
  type RuleSpecDto,
} from "@/shared/ipc";
import { appOptions, RECENT_APP_DAYS } from "@/shared/lib/apps";
import { UNASSIGNED_ID } from "@/shared/lib/labels";
import { useIsDark } from "@/shared/lib/theme";
import { addLocalDays } from "@/shared/lib/time";

import { ActivitiesView } from "../components/ActivitiesView";
import type { RulePreviewState } from "../components/RulePreview";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { GUIDE_ID, PREVIEW_DAYS } from "../lib/guide";
import { applySummary, PRESET_CHOICE_ID } from "../lib/presets";
import { toSubmitResult, type SubmitResult } from "../lib/submit";

async function attempt(action: () => Promise<unknown>): Promise<SubmitResult> {
  try {
    await action();
    return null;
  } catch (error) {
    return toSubmitResult(error);
  }
}

/** Wires Activities to the backend: activities, rules, the guided setup and the rule preview. */
export function ActivitiesContainer() {
  const intro = useSectionIntro("activities");
  const now = useNow(60_000);
  const today = addLocalDays(now, 0);
  const range = useMemo(
    () => ({ from: addLocalDays(today, -RECENT_APP_DAYS), to: addLocalDays(today, 1) }),
    [today],
  );
  const previewRange = useMemo(
    () => ({ from: addLocalDays(today, -(PREVIEW_DAYS - 1)), to: addLocalDays(today, 1) }),
    [today],
  );
  const activities = useActivitiesQuery();
  const rules = useRulesQuery();
  const recent = useReportQuery(range);
  const dark = useIsDark();
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const presets = usePresetsQuery();
  const suggestions = useSuggestionsQuery();
  const choice = useDismissedIntros();
  const applyPreset = useApplyPresetMutation();
  const accept = useAcceptSuggestionMutation();
  const dismissSuggestion = useDismissSuggestionMutation();

  const create = useCreateActivityMutation();
  const update = useUpdateActivityMutation();
  const remove = useDeleteActivityMutation();
  const upsert = useUpsertRulesMutation();
  const removeRule = useDeleteRuleMutation();

  const [draft, setDraft] = useState<RuleSpecDto | null>(null);
  const settledDraft = useDebouncedValue(draft, 250);
  const preview = useRulePreviewQuery(settledDraft, previewRange);

  const ruleList = useMemo(() => rules.data ?? [], [rules.data]);
  const apps = useMemo(
    () =>
      appOptions(
        recent.data?.by_app ?? [],
        ruleList.flatMap((rule) => (rule.spec.app_id ? [rule.spec.app_id] : [])),
      ),
    [recent.data, ruleList],
  );
  const ruleCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const rule of ruleList) counts.set(rule.activity_id, (counts.get(rule.activity_id) ?? 0) + 1);
    return counts;
  }, [ruleList]);

  // The guide opens by itself once, for a brand new setup (nothing but the system activity),
  // unless it was closed before (or the older first-run choice was made). After that it is
  // shown or hidden only by the user, so applying a pack does not make it vanish mid-way.
  const [guide, setGuide] = useState<"auto" | "opened" | null | undefined>(undefined);
  if (guide === undefined && !activities.isPending && choice.ready) {
    const onlySystem = (activities.data ?? []).every((activity) => activity.id === UNASSIGNED_ID);
    const closedBefore = choice.isDismissed(GUIDE_ID) || choice.isDismissed(PRESET_CHOICE_ID);
    setGuide(onlySystem && !closedBefore ? "auto" : null);
  }

  const previewState: RulePreviewState =
    draft === null
      ? { status: "idle" }
      : preview.isError
        ? preview.error instanceof IpcError && preview.error.error.kind === "invalid_pattern"
          ? { status: "invalid" }
          : { status: "error" }
        : preview.data && !preview.isPlaceholderData && settledDraft === draft
          ? { status: "ready", preview: preview.data }
          : { status: "loading" };

  const failure = activities.error ?? rules.error;
  const unassignedMs = recent.data
    ? (recent.data.by_activity.find((row) => row.activity_id === UNASSIGNED_ID)?.total_ms ?? 0)
    : null;

  return (
    <ActivitiesView
      intro={intro}
      loading={activities.isPending || rules.isPending}
      error={failure ? errorMessage(failure) : actionError}
      activities={activities.data ?? []}
      rules={ruleList}
      apps={apps}
      ruleCounts={ruleCounts}
      dark={dark}
      guide={guide ?? null}
      packs={presets.data ?? []}
      suggestions={suggestions.data ?? []}
      unassignedMs={unassignedMs}
      recentDays={RECENT_APP_DAYS}
      preview={previewState}
      previewDays={PREVIEW_DAYS}
      notice={notice}
      onOpenGuide={() => setGuide("opened")}
      onCloseGuide={() => {
        setGuide(null);
        choice.dismiss(GUIDE_ID);
      }}
      onRuleDraftChange={setDraft}
      onApplyPreset={async (key) => {
        const name = presets.data?.find((pack) => pack.key === key)?.name ?? "Pack";
        return attempt(async () => setNotice(applySummary(name, await applyPreset.mutateAsync(key))));
      }}
      onAcceptSuggestion={(appId) => attempt(() => accept.mutateAsync(appId))}
      onDismissSuggestion={(appId) => attempt(() => dismissSuggestion.mutateAsync(appId))}
      onDismissNotice={() => setNotice(null)}
      onCreate={(value) => attempt(() => create.mutateAsync(value))}
      onUpdate={(activity) => attempt(() => update.mutateAsync(activity))}
      onDeleteActivity={(id) => attempt(() => remove.mutateAsync(id))}
      onSaveRules={(changed) => attempt(() => upsert.mutateAsync(changed))}
      onDeleteRule={(id) => attempt(() => removeRule.mutateAsync(id))}
      onFailure={setActionError}
      onDismissError={() => setActionError(null)}
    />
  );
}
