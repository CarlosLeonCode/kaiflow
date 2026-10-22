import { useSectionIntro } from "@/features/shell/hooks/useSectionIntro";
import {
  IpcError,
  useOpenAccessibilitySettingsMutation,
  usePlatformQuery,
  useSettingsQuery,
  useStatusQuery,
  useUpdateSettingsMutation,
  errorMessage,
} from "@/shared/ipc";
import { DEFAULT_PLATFORM } from "@/shared/lib/platform";
import { formatShortcut } from "@/shared/lib/shortcut";

import { DataPanelContainer } from "@/features/data/containers/DataPanelContainer";
import { AiSettingsPanelContainer } from "@/features/review/containers/AiSettingsPanelContainer";
import { UpdatesPanelContainer } from "@/features/updates/containers/UpdateContainers";

import { SettingsView } from "../components/SettingsView";

function shortcutMessage(shortcut: string, reason: string): string {
  return `${shortcut} is unavailable: ${reason}. Choose another combination.`;
}

/** Wires Settings to the backend. A taken shortcut becomes a field error, not a toast. */
export function SettingsContainer() {
  const intro = useSectionIntro("settings");
  const settings = useSettingsQuery();
  const status = useStatusQuery();
  const update = useUpdateSettingsMutation();
  const openSettings = useOpenAccessibilitySettingsMutation();
  const platform = usePlatformQuery().data ?? DEFAULT_PLATFORM;
  const describe = (shortcut: string, reason: string) =>
    shortcutMessage(formatShortcut(shortcut, platform.os), reason);

  const failure = update.error;
  const shortcutFailure =
    failure instanceof IpcError && failure.error.kind === "shortcut_unavailable" ? failure.error : null;
  const unavailable = status.data?.shortcut.kind === "unavailable" ? status.data.shortcut : null;
  const shortcutError = shortcutFailure
    ? describe(shortcutFailure.shortcut, shortcutFailure.reason)
    : unavailable
      ? describe(unavailable.shortcut, unavailable.reason)
      : null;

  const otherError = failure && !shortcutFailure ? errorMessage(failure) : null;
  const loadError = settings.isError ? `Could not load settings: ${errorMessage(settings.error)}` : null;

  return (
    <SettingsView
      intro={intro}
      settings={settings.data}
      platform={platform}
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
