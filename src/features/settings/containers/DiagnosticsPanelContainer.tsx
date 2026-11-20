import { useState } from "react";

import { useT } from "@/shared/i18n";
import { errorMessage, useDiagnosticsQuery } from "@/shared/ipc";

import { DiagnosticsPanel } from "../components/DiagnosticsPanel";

/** Settings > Diagnostics: fetches the snapshot and copies the report to the clipboard. */
export function DiagnosticsPanelContainer() {
  const t = useT();
  const diagnostics = useDiagnosticsQuery();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const copy = async () => {
    // Fresh report: the log may have grown since the panel loaded.
    const latest = await diagnostics.refetch();
    const report = latest.data?.report ?? diagnostics.data?.report;
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <DiagnosticsPanel
      diagnostics={diagnostics.data}
      copyState={copyState}
      error={
        diagnostics.isError
          ? t.settings.diagnostics.loadError(errorMessage(diagnostics.error, t))
          : null
      }
      onCopy={() => void copy()}
      onRefresh={() => {
        setCopyState("idle");
        void diagnostics.refetch();
      }}
    />
  );
}
