import { SectionIntroContainer } from "@/features/shell/containers/SectionIntroContainer";
import { IpcError, useOpenAccessibilitySettingsMutation, useSettingsQuery, useStatusQuery, useUpdateSettingsMutation, errorMessage } from "@/shared/ipc";

import { DataPanelContainer } from "@/features/data/containers/DataPanelContainer";
import { AiSettingsPanelContainer } from "@/features/review/containers/AiSettingsPanelContainer";
import { UpdatesPanelContainer } from "@/features/updates/containers/UpdateContainers";

import { SettingsView } from "../components/SettingsView";

function shortcutMessage(shortcut: string, reason: string): string {
  return `${shortcut} is unavailable: ${reason}. Choose another combination.`;
}

/** Wires Settings to the backend. A taken shortcut becomes a field error, not a toast. */
export function SettingsContainer() {
  const settings = useSettingsQuery();
  const status = useStatusQuery();
  const update = useUpdateSettingsMutation();
  const openSettings = useOpenAccessibilitySettingsMutation();

  const failure = update.error;
  const shortcutFailure =
    failure instanceof IpcError && failure.error.kind === "shortcut_unavailable" ? failure.error : null;
  const unavailable = status.data?.shortcut.kind === "unavailable" ? status.data.shortcut : null;
  const shortcutError = shortcutFailure
    ? shortcutMessage(shortcutFailure.shortcut, shortcutFailure.reason)
    : unavailable
      ? shortcutMessage(unavailable.shortcut, unavailable.reason)
      : null;

  const otherError = failure && !shortcutFailure ? errorMessage(failure) : null;
  const loadError = settings.isError ? `Could not load settings: ${errorMessage(settings.error)}` : null;

  return (
    <SettingsView
      intro={<SectionIntroContainer section="settings" />}
      settings={settings.data}
      degraded={status.data?.degraded ?? false}
      degradedReason={status.data?.degraded_reason ?? null}
      shortcutError={shortcutError}
      error={otherError ?? loadError}
      onChange={(changes) => update.mutate(changes)}
      onOpenAccessibilitySettings={() => openSettings.mutate()}
      data={<DataPanelContainer />}
      ai={<AiSettingsPanelContainer />}
      updates={<UpdatesPanelContainer />}
    />
  );
}
