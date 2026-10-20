import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands } from "./bindings";
import type { IdleResolutionDto, RangeDto, TrackingStatusDto } from "./bindings";
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
