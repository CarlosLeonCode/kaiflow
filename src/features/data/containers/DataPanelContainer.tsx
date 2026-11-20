import { useState } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import { useT } from "@/shared/i18n";
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
  const t = useT();
  const words = t.data;
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
      error={error ?? (status.isError ? words.loadError(errorMessage(status.error, t)) : null)}
      preview={preview}
      restoring={apply.isPending}
      restoreError={restoreError}
      onToggle={(enabled) => {
        reset();
        setEnabled.mutate(enabled, { onError: (e) => setError(errorMessage(e, t)) });
      }}
      onChooseFolder={() => {
        reset();
        chooseDir.mutate(undefined, { onError: (e) => setError(errorMessage(e, t)) });
      }}
      onUseDefaultFolder={() => {
        reset();
        resetDir.mutate(undefined, { onError: (e) => setError(errorMessage(e, t)) });
      }}
      onBackUpNow={() => {
        reset();
        backupNow.mutate(undefined, {
          onSuccess: (report) => setNotice(words.saved(report.path)),
          onError: (e) => setError(words.failed(errorMessage(e, t))),
        });
      }}
      onChooseRestoreFile={() => {
        reset();
        setRestoreError(null);
        prepare.mutate(undefined, {
          // `null` means the user cancelled the file picker.
          onSuccess: (result) => setPreview(result),
          onError: (e) => setError(errorMessage(e, t)),
        });
      }}
      onConfirmRestore={() => {
        if (!preview) return;
        setRestoreError(null);
        apply.mutate(preview.token, {
          onSuccess: (result) => {
            setPreview(null);
            setNotice(words.restored(result.safety_copy));
          },
          onError: (failure) =>
            setRestoreError(
              failure instanceof IpcError && failure.error.kind === "confirmation_required"
                ? words.expired
                : errorMessage(failure, t),
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
