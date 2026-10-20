import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { commands } from "./bindings";
import type {
  CategoryDto,
  DeleteOpDto,
  IdleResolutionDto,
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

export function useCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => unwrap(commands.categoriesList()),
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
    retention: null,
    theme: null,
    autostart: null,
    shortcut: null,
    onboarding_completed: null,
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

/** Category and rule edits change how existing segments are grouped (R9.2): refresh everything derived. */
function invalidateCategorization(client: QueryClient): Promise<unknown> {
  return Promise.all(
    [queryKeys.categories, queryKeys.rules, queryKeys.reports, queryKeys.timelines].map((queryKey) =>
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

export function useCreateCategoryMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      unwrap(commands.categoriesCreate(input.name, input.color)),
    onSuccess: () => invalidateCategorization(client),
  });
}

export function useUpdateCategoryMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (category: CategoryDto) => unwrap(commands.categoriesUpdate(category)),
    onSuccess: () => invalidateCategorization(client),
  });
}

export function useDeleteCategoryMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(commands.categoriesDelete(id)),
    onSuccess: () => invalidateCategorization(client),
  });
}

/** Creates (`id <= 0`) or updates one or several rules; the backend validates title patterns. */
export function useUpsertRulesMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (rules: readonly RuleInputDto[]) =>
      Promise.all(rules.map((rule) => unwrap(commands.rulesUpsert(rule)))),
    onSettled: () => invalidateCategorization(client),
  });
}

export function useDeleteRuleMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(commands.rulesDelete(id)),
    onSuccess: () => invalidateCategorization(client),
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
