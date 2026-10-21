import { useState } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import {
  errorMessage,
  IpcError,
  useBackupNowMutation,
  useBackupStatusQuery,
  useChooseBackupDirMutation,
  useResetBackupDirMutation,
  useRestoreApplyMutation,
  useRestorePrepareMutation,
  useSetBackupEnabledMutation,
  type RestorePreviewDto,
} from "@/shared/ipc";

import { DataPanel } from "../components/DataPanel";

/**
 * Wires Settings > Data. A restore is two steps like every destructive operation: choosing a
 * file only previews it (the backend answers with a token), and confirming sends the token back.
 */
export function DataPanelContainer() {
  const now = useNow(60_000);
  const status = useBackupStatusQuery();
  const setEnabled = useSetBackupEnabledMutation();
  const chooseDir = useChooseBackupDirMutation();
  const resetDir = useResetBackupDirMutation();
  const backupNow = useBackupNowMutation();
  const prepare = useRestorePrepareMutation();
  const apply = useRestoreApplyMutation();

  const [preview, setPreview] = useState<RestorePreviewDto | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy =
    setEnabled.isPending ||
    chooseDir.isPending ||
    resetDir.isPending ||
    backupNow.isPending ||
    prepare.isPending ||
    apply.isPending;

  function reset() {
    setNotice(null);
    setError(null);
  }

  return (
    <DataPanel
      status={status.data}
      now={now}
      busy={busy}
      backingUp={backupNow.isPending}
      notice={notice}
      error={error ?? (status.isError ? `Could not load backup settings: ${errorMessage(status.error)}` : null)}
      preview={preview}
      restoring={apply.isPending}
      restoreError={restoreError}
      onToggle={(enabled) => {
        reset();
        setEnabled.mutate(enabled, { onError: (e) => setError(errorMessage(e)) });
      }}
      onChooseFolder={() => {
        reset();
        chooseDir.mutate(undefined, { onError: (e) => setError(errorMessage(e)) });
      }}
      onUseDefaultFolder={() => {
        reset();
        resetDir.mutate(undefined, { onError: (e) => setError(errorMessage(e)) });
      }}
      onBackUpNow={() => {
        reset();
        backupNow.mutate(undefined, {
          onSuccess: (report) => setNotice(`Backup saved to ${report.path}`),
          onError: (e) => setError(`The backup failed: ${errorMessage(e)}`),
        });
      }}
      onChooseRestoreFile={() => {
        reset();
        setRestoreError(null);
        prepare.mutate(undefined, {
          // `null` means the user cancelled the file picker.
          onSuccess: (result) => setPreview(result),
          onError: (e) => setError(errorMessage(e)),
        });
      }}
      onConfirmRestore={() => {
        if (!preview) return;
        setRestoreError(null);
        apply.mutate(preview.token, {
          onSuccess: (result) => {
            setPreview(null);
            setNotice(`Restored. A safety copy of the previous data was saved to ${result.safety_copy}`);
          },
          onError: (failure) =>
            setRestoreError(
              failure instanceof IpcError && failure.error.kind === "confirmation_required"
                ? "The confirmation expired. Close this dialog and choose the file again."
                : errorMessage(failure),
            ),
        });
      }}
      onCancelRestore={() => {
        setPreview(null);
        setRestoreError(null);
      }}
      onDismiss={reset}
    />
  );
}
