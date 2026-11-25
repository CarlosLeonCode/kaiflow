import { useSectionIntro } from "@/features/shell/hooks/useSectionIntro";
import { useT } from "@/shared/i18n";
import {
  IpcError,
  useOpenAccessibilitySettingsMutation,
  usePlatformQuery,
  useSettingsQuery,
  useStatusQuery,
  useUpdateSettingsMutation,
  errorMessage,
} from "@/shared/ipc";
import { DEFAULT_PLATFORM, platformWords } from "@/shared/lib/platform";
import { formatShortcut, SHORTCUT_REASON_WAYLAND } from "@/shared/lib/shortcut";

import { DataPanelContainer } from "@/features/data/containers/DataPanelContainer";
import { AiSettingsPanelContainer } from "@/features/review/containers/AiSettingsPanelContainer";
import { UpdatesPanelContainer } from "@/features/updates/containers/UpdateContainers";

import { SettingsView } from "../components/SettingsView";
import { DiagnosticsPanelContainer } from "./DiagnosticsPanelContainer";

/** Wires Settings to the backend. A taken shortcut becomes a field error, not a toast. */
export function SettingsContainer() {
  const t = useT();
  const intro = useSectionIntro("settings");
  const settings = useSettingsQuery();
  const status = useStatusQuery();
  const update = useUpdateSettingsMutation();
  const openSettings = useOpenAccessibilitySettingsMutation();
  const platform = usePlatformQuery().data ?? DEFAULT_PLATFORM;
  const describe = (shortcut: string, reason: string) =>
    reason === SHORTCUT_REASON_WAYLAND
      ? t.settings.tracking.shortcutWayland(platformWords(platform.os, t).tray)
      : t.settings.tracking.shortcutUnavailable(formatShortcut(shortcut, platform.os), reason);

  const failure = update.error;
  const shortcutFailure =
    failure instanceof IpcError && failure.error.kind === "shortcut_unavailable" ? failure.error : null;
  const unavailable = status.data?.shortcut.kind === "unavailable" ? status.data.shortcut : null;
  const shortcutError = shortcutFailure
    ? describe(shortcutFailure.shortcut, shortcutFailure.reason)
    : unavailable
      ? describe(unavailable.shortcut, unavailable.reason)
      : null;

  const otherError = failure && !shortcutFailure ? errorMessage(failure, t) : null;
  const loadError = settings.isError ? t.settings.loadError(errorMessage(settings.error, t)) : null;

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
      diagnostics={<DiagnosticsPanelContainer />}
    />
  );
}
