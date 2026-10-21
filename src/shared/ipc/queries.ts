import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { commands } from "./bindings";
import type {
  ActivityDto,
  AiProviderDto,
  AiSettingsPatchDto,
  BackupStatusDto,
  DeleteOpDto,
  FocusCardActionDto,
  FocusStartDto,
  FocusStatusDto,
  GoalDto,
  IdleResolutionDto,
  ProductivityDto,
  RangeDto,
  RuleInputDto,
  RuleSpecDto,
  SettingsDto,
  SettingsPatchDto,
  TrackingStatusDto,
  UpdateInfoDto,
} from "./bindings";
import { unwrap } from "./client";
import { queryKeys } from "./queryKeys";

/** Typed query and mutation hooks over the generated commands. */

export function useStatusQuery() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => unwrap(commands.getStatus()),
  });
}

export function useReportQuery(range: RangeDto, buckets: readonly RangeDto[] = []) {
  return useQuery({
    queryKey: queryKeys.report(range, buckets),
    queryFn: () => unwrap(commands.getReport(range, [...buckets])),
  });
}

/**
 * Everything the Overview shows for a range in one call: totals, breakdowns, stacked buckets,
 * heatmap, trend against `previous` and the focus ratio.
 */
export function useDashboardQuery(range: RangeDto, buckets: readonly RangeDto[], previous: RangeDto | null) {
  return useQuery({
    queryKey: queryKeys.dashboard(range, buckets, previous),
    queryFn: () => unwrap(commands.getDashboard(range, [...buckets], previous)),
  });
}

export function useTimelineQuery(range: RangeDto) {
  return useQuery({
    queryKey: queryKeys.timeline(range),
    queryFn: () => unwrap(commands.getTimeline(range)),
  });
}

/** Live Accessibility state; refreshed by `permission-changed` and when the window regains focus. */
export function usePermissionQuery() {
  return useQuery({
    queryKey: queryKeys.permission,
    queryFn: () => unwrap(commands.permissionStatus()),
  });
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(commands.settingsGet()),
  });
}

/**
 * Section intros (and other one-time hints) the user dismissed; the list lives in the `ui`
 * settings blob. Changes are applied to the cache first, so a dismissed intro disappears and a
 * reopened one appears at once, and are computed from the latest cached list so two quick
 * changes never overwrite each other.
 */
export function useDismissedIntros() {
  const client = useQueryClient();
  const settings = useSettingsQuery();
  const update = useUpdateSettingsMutation();
  const dismissed = settings.data?.ui.dismissed_intros ?? [];

  const change = (next: (current: readonly string[]) => string[] | null) => {
    const cached = client.getQueryData<SettingsDto>(queryKeys.settings);
    if (!cached) return;
    const list = next(cached.ui.dismissed_intros);
    if (!list) return;
    client.setQueryData<SettingsDto>(queryKeys.settings, { ...cached, ui: { ...cached.ui, dismissed_intros: list } });
    update.mutate({ ui: { ...cached.ui, dismissed_intros: list } });
  };

  return {
    ready: settings.data !== undefined,
    isDismissed: (id: string) => dismissed.includes(id),
    dismiss: (id: string) => change((current) => (current.includes(id) ? null : [...current, id])),
    /** Shows a dismissed intro again (the header's help button). */
    restore: (id: string) =>
      change((current) => (current.includes(id) ? current.filter((item) => item !== id) : null)),
  };
}

export function useActivitiesQuery() {
  return useQuery({
    queryKey: queryKeys.activities,
    queryFn: () => unwrap(commands.activitiesList()),
  });
}

export function usePendingIdleGapsQuery() {
  return useQuery({
    queryKey: queryKeys.idleGaps,
    queryFn: () => unwrap(commands.listPendingIdleGaps()),
  });
}

export function useResolveIdleGapMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; resolution: IdleResolutionDto }) =>
      unwrap(commands.resolveIdleGap(input.id, input.resolution)),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.idleGaps }),
        client.invalidateQueries({ queryKey: queryKeys.reports }),
      ]);
    },
  });
}

type StatusCommand = "start" | "pause" | "resume" | "stop";

/** Start, pause, resume and stop all answer with the new status: cache it right away. */
export function useTrackingCommandMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: StatusCommand): Promise<TrackingStatusDto> => unwrap(commands[command]()),
    onSuccess: (status) => {
      client.setQueryData(queryKeys.status, status);
      void client.invalidateQueries({ queryKey: queryKeys.reports });
    },
  });
}

export function useOpenMainWindowMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.openMainWindow()) });
}

export function useOpenAccessibilitySettingsMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.permissionOpenSettings()) });
}

/** `settings_update` takes a full patch; every field left `null` stays untouched. */
export function settingsPatch(changes: Partial<SettingsPatchDto>): SettingsPatchDto {
  return {
    store_titles: null,
    idle_threshold_secs: null,
    idle_prompt_timeout_secs: null,
    idle_auto_discard_below_secs: null,
    retention: null,
    theme: null,
    autostart: null,
    shortcut: null,
    onboarding_completed: null,
    tray_display: null,
    week_start: null,
    focus_drift_after_secs: null,
    focus_timer: null,
    ui: null,
    ...changes,
  };
}

/**
 * Saves settings and caches the merged result. The backend stores the patch even when the
 * shortcut cannot be registered (it answers with `shortcut_unavailable`), so a failure
 * refetches both settings and status instead of leaving a stale cache.
 */
export function useUpdateSettingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<SettingsPatchDto>): Promise<SettingsDto> =>
      unwrap(commands.settingsUpdate(settingsPatch(changes))),
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.settings, saved);
      void client.invalidateQueries({ queryKey: queryKeys.status });
      // The privacy page mirrors `store_titles` and the retention policy.
      void client.invalidateQueries({ queryKey: queryKeys.privacy });
      // The first day of the week moves weekly goals and the Overview periods.
      void client.invalidateQueries({ queryKey: queryKeys.goals });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: queryKeys.settings });
      void client.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

export function useRestartAppMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.appRestart()) });
}

export function useCloseOnboardingMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.closeOnboarding()) });
}

export function useHidePopoverMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.hidePopover()) });
}

/** Activity and rule edits change how existing segments are grouped (R9.2): refresh everything derived. */
function invalidateClassification(client: QueryClient): Promise<unknown> {
  return Promise.all(
    [
      queryKeys.activities,
      queryKeys.rules,
      queryKeys.suggestions,
      queryKeys.reports,
      queryKeys.timelines,
      // Goals follow the activities they target (and their rules).
      queryKeys.goals,
    ].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

export function useRulesQuery() {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: () => unwrap(commands.rulesList()),
  });
}

export function useCreateActivityMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: string; productivity: ProductivityDto }) =>
      unwrap(commands.activitiesCreate(input.name, input.color, input.productivity)),
    onSuccess: () => invalidateClassification(client),
  });
}

export function useUpdateActivityMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (activity: ActivityDto) => unwrap(commands.activitiesUpdate(activity)),
    onSuccess: () => invalidateClassification(client),
  });
}

export function useDeleteActivityMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(commands.activitiesDelete(id)),
    onSuccess: () => invalidateClassification(client),
  });
}

/**
 * How much tracked time a rule would cover in `range` before it is saved. Disabled while there
 * is no rule to check (`spec` is `null`); the previous answer stays shown while the next loads.
 */
export function useRulePreviewQuery(spec: RuleSpecDto | null, range: RangeDto) {
  return useQuery({
    queryKey: spec ? queryKeys.rulePreview(spec, range) : ["report", "rule-preview", "none"],
    queryFn: () => unwrap(commands.rulesPreview(spec as RuleSpecDto, range)),
    enabled: spec !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Creates (`id <= 0`) or updates one or several rules; the backend validates title patterns. */
export function useUpsertRulesMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (rules: readonly RuleInputDto[]) =>
      Promise.all(rules.map((rule) => unwrap(commands.rulesUpsert(rule)))),
    onSettled: () => invalidateClassification(client),
  });
}

export function useDeleteRuleMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(commands.rulesDelete(id)),
    onSuccess: () => invalidateClassification(client),
  });
}

/** The opt-in preset catalog; static, so it never goes stale. */
export function usePresetsQuery() {
  return useQuery({
    queryKey: queryKeys.presets,
    queryFn: () => unwrap(commands.presetsList()),
    staleTime: Infinity,
  });
}

/** Creates the pack's activities and rules for apps already seen; resolves to what changed. */
export function useApplyPresetMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => unwrap(commands.presetsApply(key)),
    onSuccess: () => invalidateClassification(client),
  });
}

/** Apps seen in the history that no rule covers, with the activity each would go under. */
export function useSuggestionsQuery() {
  return useQuery({
    queryKey: queryKeys.suggestions,
    queryFn: () => unwrap(commands.suggestionsList()),
  });
}

/** Accepting creates an app rule, which reclassifies history: refresh everything derived. */
export function useAcceptSuggestionMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => unwrap(commands.suggestionsAccept(appId)),
    onSuccess: () => invalidateClassification(client),
  });
}

export function useDismissSuggestionMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => unwrap(commands.suggestionsDismiss(appId)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.suggestions }),
  });
}

export function usePrivacyQuery() {
  return useQuery({
    queryKey: queryKeys.privacy,
    queryFn: () => unwrap(commands.privacyList()),
  });
}

/** `mode: null` removes the app's rule. Future data only (R10.5). */
export function useSetPrivacyMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { appId: string; mode: "exclude" | "redact_title" | null }) =>
      unwrap(commands.privacySet(input.appId, input.mode)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.privacy }),
  });
}

/** Step one of every destructive operation: the backend answers with a single-use confirm token. */
export function usePrepareDeleteMutation() {
  return useMutation({ mutationFn: (op: DeleteOpDto) => unwrap(commands.prepareDelete(op)) });
}

/** Step two: runs the operation the token was issued for. Resolves to the number of removed segments. */
export function useDeleteDataMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { op: DeleteOpDto; token: string }): Promise<number> => {
      const { op, token } = input;
      switch (op.kind) {
        case "range":
          return unwrap(commands.deleteRange(op.range, token));
        case "older_than_days":
          return unwrap(commands.purgeOlderThan(op.days, token));
        case "all":
          await unwrap(commands.deleteAll(token));
          return 0;
      }
    },
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.reports }),
        client.invalidateQueries({ queryKey: queryKeys.timelines }),
        // Finished focus sessions are deleted with the time they were measured on.
        client.invalidateQueries({ queryKey: queryKeys.focus }),
        client.invalidateQueries({ queryKey: queryKeys.idleGaps }),
        // Deleting tracked time changes progress and streaks.
        client.invalidateQueries({ queryKey: queryKeys.goals }),
      ]),
  });
}

/** Resolves to the saved path, or `null` when the user cancelled the save dialog. */
export function useExportJsonMutation() {
  return useMutation({ mutationFn: (range: RangeDto) => unwrap(commands.exportJson(range)) });
}

/** Backup configuration plus the outcome of the last run; refreshed when a backup finishes. */
export function useBackupStatusQuery() {
  return useQuery({
    queryKey: queryKeys.backup,
    queryFn: () => unwrap(commands.backupStatus()),
  });
}

function useBackupStatusMutation<V = void>(run: (value: V) => Promise<BackupStatusDto>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (status) => client.setQueryData(queryKeys.backup, status),
  });
}

export function useSetBackupEnabledMutation() {
  return useBackupStatusMutation((enabled: boolean) => unwrap(commands.backupSetEnabled(enabled)));
}

/** Opens the folder picker; cancelling resolves with the unchanged status. */
export function useChooseBackupDirMutation() {
  return useBackupStatusMutation(() => unwrap(commands.backupChooseDir()));
}

export function useResetBackupDirMutation() {
  return useBackupStatusMutation(() => unwrap(commands.backupResetDir()));
}

/** Backs up right now; resolves with the file written. */
export function useBackupNowMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(commands.backupNow()),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.backup }),
  });
}

/** Opens the file picker and previews the chosen file; resolves to `null` when cancelled. */
export function useRestorePrepareMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.restorePrepare()) });
}

/** Replaces every piece of data with the previewed file, then reloads all views. */
export function useRestoreApplyMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => unwrap(commands.restoreApply(token)),
    // Everything changed: activities, rules, settings, privacy rules and tracked time.
    onSuccess: () => client.invalidateQueries(),
  });
}

/** What deleting data older than `days` would remove; disabled while `days` is `null`. */
export function useRetentionImpactQuery(days: number | null) {
  return useQuery({
    queryKey: queryKeys.retentionImpact(days),
    queryFn: () => unwrap(commands.retentionImpact(days ?? 1)),
    enabled: days !== null,
    // A dry run must reflect the data right now, never a cached answer.
    gcTime: 0,
  });
}

/** The update announced by the backend, or `null`. Only the `update-available` event and a manual check write it. */
export function useAvailableUpdate(): UpdateInfoDto | null {
  // Never fetched: the cache entry is written by the event and the manual check only.
  const query = useQuery<UpdateInfoDto | null>({
    queryKey: queryKeys.update,
    queryFn: () => null,
    enabled: false,
  });
  return query.data ?? null;
}

/** Manual "Check for updates"; resolves with the update, or `null` when the app is current. */
export function useCheckUpdateMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(commands.updateCheck()),
    onSuccess: (update) => client.setQueryData(queryKeys.update, update),
  });
}

/** Downloads and installs the announced update; the app relaunches on success. */
export function useInstallUpdateMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.updateInstall()) });
}

/** Every goal, archived ones included (the Goals section). */
export function useGoalsQuery() {
  return useQuery({
    queryKey: queryKeys.goalList,
    queryFn: () => unwrap(commands.goalsList()),
  });
}

/**
 * Progress and streak of every active goal: what Today, the popover and Overview show.
 * Refreshed by backend events like every other query; the time of the open segment is added
 * on screen (`withLiveTime`), so no polling is needed.
 */
export function useGoalsStatusQuery() {
  return useQuery({
    queryKey: queryKeys.goalStatus,
    queryFn: () => unwrap(commands.goalsStatus()),
  });
}

/** Creates (`id <= 0`) or updates a goal; also used to archive and restore one. */
export function useUpsertGoalMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (goal: GoalDto) => unwrap(commands.goalsUpsert(goal)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.goals }),
  });
}

export function useDeleteGoalMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(commands.goalsDelete(id)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.goals }),
  });
}

/** The user saw the badge of a crossed goal. */
export function useMarkGoalSeenMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (goalId: number) => unwrap(commands.goalEventsMarkSeen(goalId)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.goals }),
  });
}

/**
 * The running focus session, the finished one waiting to be dismissed, and whether a session
 * can start. Refreshed by `focus-changed`; the countdown is computed on screen from the end
 * time, so no polling is needed.
 */
export function useFocusStatusQuery() {
  return useQuery({
    queryKey: queryKeys.focusStatus,
    queryFn: () => unwrap(commands.focusStatus()),
  });
}

/** Finished sessions, newest first. */
export function useFocusHistoryQuery() {
  return useQuery({
    queryKey: queryKeys.focusHistory,
    queryFn: () => unwrap(commands.focusHistory()),
  });
}

/** Every focus command answers with the new status: cache it right away, refresh the history. */
function useFocusCommand<Input>(run: (input: Input) => Promise<FocusStatusDto>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (status) => {
      client.setQueryData(queryKeys.focusStatus, status);
      void client.invalidateQueries({ queryKey: queryKeys.focusHistory });
    },
  });
}

export function useStartFocusMutation() {
  return useFocusCommand((start: FocusStartDto) => unwrap(commands.focusStart(start)));
}

/** "End session". */
export function useStopFocusMutation() {
  return useFocusCommand(() => unwrap(commands.focusStop()));
}

export function useExtendFocusMutation() {
  return useFocusCommand((minutes: number) => unwrap(commands.focusExtend(minutes)));
}

/** Freezes the countdown; the time left is kept. */
export function usePauseFocusMutation() {
  return useFocusCommand(() => unwrap(commands.focusPause()));
}

export function useResumeFocusMutation() {
  return useFocusCommand(() => unwrap(commands.focusResume()));
}

/** Answers the end card: start the next block, skip it, or a few more minutes. */
export function useFocusCardActionMutation() {
  return useFocusCommand((action: FocusCardActionDto) => unwrap(commands.focusCardAction(action)));
}

/** "Back to it": acknowledges the drift alert and holds the next one back for `minutes`. */
export function useSnoozeFocusMutation() {
  return useFocusCommand((minutes: number) => unwrap(commands.focusSnooze(minutes)));
}

/** "Allow this app" for the rest of the session. */
export function useAllowFocusAppMutation() {
  return useFocusCommand((appId: string) => unwrap(commands.focusAllowApp(appId)));
}

/** The user closed the end summary of a finished session. */
export function useDismissFocusSummaryMutation() {
  return useFocusCommand((id: number) => unwrap(commands.focusSummaryDismiss(id)));
}

// ---- weekly review and the optional AI analysis ----

/** AI settings, per-provider opt-in and the key store state. Never carries a key. */
export function useAiSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: () => unwrap(commands.aiSettingsGet()),
  });
}

export function useUpdateAiSettingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: AiSettingsPatchDto) => unwrap(commands.aiSettingsUpdate(patch)),
    onSuccess: (settings) => client.setQueryData(queryKeys.aiSettings, settings),
  });
}

/** The only way a key goes in: it is stored in the OS keychain and never comes back. */
export function useSetAiKeyMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: AiProviderDto; key: string }) =>
      unwrap(commands.aiSetKey(input.provider, input.key)),
    onSuccess: (settings) => client.setQueryData(queryKeys.aiSettings, settings),
  });
}

export function useDeleteAiKeyMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (provider: AiProviderDto) => unwrap(commands.aiDeleteKey(provider)),
    onSuccess: (settings) => client.setQueryData(queryKeys.aiSettings, settings),
  });
}

/** Lists the models of a provider that is switched on (a button, never automatic). */
export function useAiModelsMutation() {
  return useMutation({ mutationFn: (provider: AiProviderDto) => unwrap(commands.aiModelsList(provider)) });
}

/** Checks the key and the connection; resolves with how many models the provider lists. */
export function useTestAiMutation() {
  return useMutation({ mutationFn: (provider: AiProviderDto) => unwrap(commands.aiTest(provider)) });
}

/** The weekly review, built locally: no AI and no network. `weeksAgo` 0 is the current week. */
export function useWeeklyReviewQuery(weeksAgo: number) {
  return useQuery({
    queryKey: queryKeys.reviewWeek(weeksAgo),
    queryFn: () => unwrap(commands.reviewGet(weeksAgo)),
  });
}

/** Saves the personal note of a week (blank removes it). */
export function useSetReviewNoteMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { firstDay: number; note: string }) =>
      unwrap(commands.reviewNoteSet(input.firstDay, input.note)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.reports }),
  });
}

/** Builds the exact request a run would send; nothing is sent. */
export function usePreviewReviewMutation() {
  return useMutation({
    mutationFn: (input: { weeksAgo: number; includeTitles: boolean; language: string }) =>
      unwrap(commands.reviewPreview(input.weeksAgo, input.includeTitles, input.language)),
  });
}

/** Sends a previewed request; resolves with the stored review. */
export function useRunReviewMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (previewId: string) => unwrap(commands.reviewRun(previewId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.aiReviews });
      void client.invalidateQueries({ queryKey: queryKeys.reports });
    },
  });
}

export function useCancelReviewMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.reviewCancel()) });
}

export function useAiReviewsQuery() {
  return useQuery({
    queryKey: queryKeys.aiReviews,
    queryFn: () => unwrap(commands.aiReviewsList()),
  });
}

function useInvalidateReviews() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.aiReviews });
    void client.invalidateQueries({ queryKey: queryKeys.reports });
  };
}

export function useDeleteAiReviewMutation() {
  const invalidate = useInvalidateReviews();
  return useMutation({
    mutationFn: (id: number) => unwrap(commands.aiReviewsDelete(id)),
    onSuccess: invalidate,
  });
}

/** Step one of "delete all": resolves with the token the confirmation must send back. */
export function usePrepareDeleteAllAiReviewsMutation() {
  return useMutation({ mutationFn: () => unwrap(commands.aiReviewsPrepareDeleteAll()) });
}

export function useDeleteAllAiReviewsMutation() {
  const invalidate = useInvalidateReviews();
  return useMutation({
    mutationFn: (token: string) => unwrap(commands.aiReviewsDeleteAll(token)),
    onSuccess: invalidate,
  });
}
