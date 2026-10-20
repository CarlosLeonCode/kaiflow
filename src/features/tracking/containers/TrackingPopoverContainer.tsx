import { type ReactNode, useMemo } from "react";

import {
  errorMessage,
  useOpenAccessibilitySettingsMutation,
  useOpenMainWindowMutation,
  useReportQuery,
  useStatusQuery,
  useTrackingCommandMutation,
} from "@/shared/ipc";
import { localDayRange } from "@/shared/lib/time";
import { Alert, AlertDescription } from "@/shared/ui/alert";

import { TrackingPopover } from "../components/TrackingPopover";
import { useNow } from "../hooks/useNow";
import { buildTopApps, elapsedSinceFetch, isAccruing } from "../lib/derive";

const TOP_APPS = 5;

/** Wires the popover to the backend: status, today's report and the live total. */
export function TrackingPopoverContainer({ notice }: { notice?: ReactNode }) {
  const status = useStatusQuery();
  const now = useNow();
  const dayStart = localDayRange(now).from;
  const range = useMemo(() => localDayRange(dayStart), [dayStart]);
  const report = useReportQuery(range);
  const toggle = useTrackingCommandMutation();
  const openMain = useOpenMainWindowMutation();
  const openSettings = useOpenAccessibilitySettingsMutation();

  if (status.isError) {
    return (
      <Alert variant="warning" className="m-4">
        <AlertDescription>
          Could not read the tracking status: {errorMessage(status.error)}
        </AlertDescription>
      </Alert>
    );
  }
  const data = status.data;
  const accruing = isAccruing(data?.state);
  const elapsed = report.data ? elapsedSinceFetch(report.dataUpdatedAt, now, accruing) : 0;
  const reportTotal = report.data?.total_ms;

  return (
    <TrackingPopover
      state={data?.state ?? "stopped"}
      degraded={data?.degraded ?? false}
      degradedReason={data?.degraded_reason ?? null}
      shortcut={data?.shortcut ?? { kind: "disabled" }}
      current={data?.current ?? null}
      currentElapsedMs={data?.since != null ? Math.max(0, now - data.since) : null}
      totalMs={reportTotal === undefined ? undefined : reportTotal + elapsed}
      topApps={buildTopApps(report.data?.by_app ?? [], data?.current ?? null, elapsed, TOP_APPS)}
      topAppsLoading={report.isPending}
      togglePending={toggle.isPending}
      notice={notice}
      onToggle={(command) => toggle.mutate(command)}
      onOpenDashboard={() => openMain.mutate()}
      onOpenAccessibilitySettings={() => openSettings.mutate()}
    />
  );
}
