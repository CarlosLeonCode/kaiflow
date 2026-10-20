import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands } from "./bindings";
import type {
  IdleResolutionDto,
  RangeDto,
  SettingsDto,
  SettingsPatchDto,
  TrackingStatusDto,
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
