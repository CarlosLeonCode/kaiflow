import {
  errorMessage,
  useAvailableUpdate,
  useCheckUpdateMutation,
  useInstallUpdateMutation,
} from "@/shared/ipc";

import { useT } from "@/shared/i18n";

import { UpdateBanner } from "../components/UpdateBanner";
import { UpdatesPanel } from "../components/UpdatesPanel";

/** Popover notice, rendered only while an update is announced. */
export function UpdateBannerContainer() {
  const update = useAvailableUpdate();
  const install = useInstallUpdateMutation();
  const t = useT();
  if (!update) return null;
  return (
    <UpdateBanner
      update={update}
      installing={install.isPending}
      error={install.isError ? t.updates.installError(errorMessage(install.error, t)) : null}
      onInstall={() => install.mutate()}
    />
  );
}

/** Settings panel: manual check plus install. */
export function UpdatesPanelContainer() {
  const update = useAvailableUpdate();
  const check = useCheckUpdateMutation();
  const install = useInstallUpdateMutation();
  const t = useT();
  const error = install.isError
    ? t.updates.installError(errorMessage(install.error, t))
    : check.isError
      ? t.updates.checkError(errorMessage(check.error, t))
      : null;
  return (
    <UpdatesPanel
      update={update}
      checking={check.isPending}
      upToDate={check.isSuccess && check.data === null}
      installing={install.isPending}
      error={error}
      onCheck={() => check.mutate()}
      onInstall={() => install.mutate()}
    />
  );
}
