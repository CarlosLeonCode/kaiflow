import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
import { useMemo, useState } from "react";

import { useNow } from "@/features/tracking/hooks/useNow";
import {
  errorMessage,
  IpcError,
  useDeleteDataMutation,
  usePrepareDeleteMutation,
  usePrivacyQuery,
  useReportQuery,
  useSetPrivacyMutation,
  useSettingsQuery,
  useStatusQuery,
  useTrackingCommandMutation,
  useUpdateSettingsMutation,
  type DeleteOpDto,
} from "@/shared/ipc";
import { appOptions, RECENT_APP_DAYS } from "@/shared/lib/apps";
import { addLocalDays } from "@/shared/lib/time";

import { PrivacyView } from "../components/PrivacyView";
import type { PrivacyMode } from "../lib/apps";
import { deletedMessage } from "../lib/delete";
import { retentionPatch } from "../lib/retention";

interface Pending {
  op: DeleteOpDto;
  /** Single-use token issued by `prepare_delete`; the backend only accepts it for this exact operation. */
  token: string;
  /** Tracking was running when the user asked: it is stopped for the deletion and resumed. */
  restart: boolean;
}

interface Props {
  /** Navigates to Settings (the global `store_titles` switch lives there). */
  onOpenSettings: () => void;
}

/**
 * Wires Privacy to the backend. Every destructive operation is two steps (R10.4): the user
 * asks (`prepare_delete` returns a token), reads the consequences, and only then confirms
 * (the matching delete command consumes the token).
 */
export function PrivacyContainer({ onOpenSettings }: Props) {
  const now = useNow(60_000);
  const today = addLocalDays(now, 0);
  const range = useMemo(
    () => ({ from: addLocalDays(today, -RECENT_APP_DAYS), to: addLocalDays(today, 1) }),
    [today],
  );
  const privacy = usePrivacyQuery();
  const settings = useSettingsQuery();
  const status = useStatusQuery();
  const recent = useReportQuery(range);
  const apps = useMemo(
    () =>
      appOptions(recent.data?.by_app ?? [], [
        ...(privacy.data?.excluded_apps ?? []),
        ...(privacy.data?.redacted_apps ?? []),
      ]),
    [recent.data, privacy.data],
  );

  const setPrivacy = useSetPrivacyMutation();
  const updateSettings = useUpdateSettingsMutation();
  const prepare = usePrepareDeleteMutation();
  const deleteData = useDeleteDataMutation();
  const tracking = useTrackingCommandMutation();

  const [pending, setPending] = useState<Pending | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Deleting everything while an open segment exists would pull the row out from under the
  // engine, so tracking is stopped for the deletion and resumed right after.
  const trackingWillRestart = status.data?.state === "running";

  async function request(op: DeleteOpDto) {
    setError(null);
    setNotice(null);
    setDeleteError(null);
    try {
      const token = await prepare.mutateAsync(op);
      setPending({ op, token, restart: op.kind === "all" && trackingWillRestart });
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  async function confirm() {
    if (!pending) return;
    const { op, token, restart } = pending;
    setDeleteError(null);
    try {
      if (restart) await tracking.mutateAsync("stop");
      const removed = await deleteData.mutateAsync({ op, token });
      setPending(null);
      setNotice(deletedMessage(op, removed));
    } catch (failure) {
      const expired = failure instanceof IpcError && failure.error.kind === "confirmation_required";
      setDeleteError(
        expired ? "The confirmation expired. Close this dialog and try again." : errorMessage(failure),
      );
    } finally {
      if (restart) await tracking.mutateAsync("start").catch(() => undefined);
    }
  }

  return (
    <PrivacyView
      intro={<SectionIntroContainer section="privacy" />}
      privacy={privacy.data}
      retentionDays={settings.data?.retention_days ?? null}
      apps={apps}
      today={today}
      error={privacy.error ? errorMessage(privacy.error) : error}
      notice={notice}
      pending={pending?.op ?? null}
      trackingWillRestart={pending?.restart ?? false}
      deleting={deleteData.isPending || tracking.isPending}
      preparing={prepare.isPending}
      deleteError={deleteError}
      onOpenSettings={onOpenSettings}
      onSetPrivacy={async (appId: string, mode: PrivacyMode | null) => {
        try {
          await setPrivacy.mutateAsync({ appId, mode });
          return null;
        } catch (failure) {
          return errorMessage(failure);
        }
      }}
      onRetentionChange={(value) => {
        setError(null);
        updateSettings.mutate({ retention: retentionPatch(value) }, { onError: (e) => setError(errorMessage(e)) });
      }}
      onRequestDelete={(op) => void request(op)}
      onConfirmDelete={() => void confirm()}
      onCancelDelete={() => {
        setPending(null);
        setDeleteError(null);
      }}
      onFailure={setError}
      onDismiss={() => {
        setError(null);
        setNotice(null);
      }}
    />
  );
}
