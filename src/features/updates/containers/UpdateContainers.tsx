import {
  errorMessage,
  useAvailableUpdate,
  useCheckUpdateMutation,
  useInstallUpdateMutation,
} from "@/shared/ipc";

import { UpdateBanner } from "../components/UpdateBanner";
import { UpdatesPanel } from "../components/UpdatesPanel";

/** Popover notice, rendered only while an update is announced. */
export function UpdateBannerContainer() {
  const update = useAvailableUpdate();
  const install = useInstallUpdateMutation();
  if (!update) return null;
  return (
    <UpdateBanner
      update={update}
      installing={install.isPending}
      error={install.isError ? `Could not install: ${errorMessage(install.error)}` : null}
      onInstall={() => install.mutate()}
    />
  );
}

/** Settings panel: manual check plus install. */
export function UpdatesPanelContainer() {
  const update = useAvailableUpdate();
  const check = useCheckUpdateMutation();
  const install = useInstallUpdateMutation();
  const error = install.isError
    ? `Could not install: ${errorMessage(install.error)}`
    : check.isError
      ? `Could not check for updates: ${errorMessage(check.error)}`
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
