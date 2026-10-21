import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { commands } from "./bindings";
import type {
  ActivityDto,
  DeleteOpDto,
  IdleResolutionDto,
  ProductivityDto,
  RangeDto,
  RuleInputDto,
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

/** One report per range, sharing cache keys with `useReportQuery` (no buckets). `enabled: false` skips them all. */
export function useReportsQuery(ranges: readonly RangeDto[], enabled = true) {
  return useQueries({
    queries: ranges.map((range) => ({
      queryKey: queryKeys.report(range),
      queryFn: () => unwrap(commands.getReport(range, [])),
      enabled,
    })),
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

/** Section intros the user dismissed; the list lives in the `ui` settings blob. */
export function useDismissedIntros() {
  const settings = useSettingsQuery();
  const update = useUpdateSettingsMutation();
  const dismissed = settings.data?.ui.dismissed_intros ?? [];
  return {
    ready: settings.data !== undefined,
    isDismissed: (id: string) => dismissed.includes(id),
    dismiss: (id: string) => {
      if (dismissed.includes(id)) return;
      update.mutate({ ui: { dismissed_intros: [...dismissed, id] } });
    },
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
    [queryKeys.activities, queryKeys.rules, queryKeys.suggestions, queryKeys.reports, queryKeys.timelines].map((queryKey) =>
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
        client.invalidateQueries({ queryKey: queryKeys.idleGaps }),
      ]),
  });
}

/** Resolves to the saved path, or `null` when the user cancelled the save dialog. */
export function useExportCsvMutation() {
  return useMutation({ mutationFn: (range: RangeDto) => unwrap(commands.exportCsv(range)) });
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
