import { Monitor, Moon, Sun } from "lucide-react";

import type { SettingsDto, SettingsPatchDto } from "@/shared/ipc";
import { parseTheme, type ThemeSetting } from "@/shared/lib/theme";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Panel, Row } from "@/shared/ui/field";
import { Page } from "@/shared/ui/page";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Select } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

import { DegradedBanner } from "@/features/tracking/components/StatusBanners";

import { idleThresholdOptions } from "../lib/options";
import { ShortcutField } from "./ShortcutField";

const THEMES: readonly SegmentedOption<ThemeSetting>[] = [
  { value: "light", label: "Light", icon: <Sun className="size-3.5" aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-3.5" aria-hidden="true" /> },
  { value: "system", label: "System", icon: <Monitor className="size-3.5" aria-hidden="true" /> },
];

interface Props {
  /** `undefined` while loading. */
  settings: SettingsDto | undefined;
  degraded: boolean;
  shortcutError: string | null;
  /** Failure of any other setting, shown once at the top. */
  error: string | null;
  onChange: (changes: Partial<SettingsPatchDto>) => void;
  onOpenAccessibilitySettings: () => void;
}

/** Settings section (presentational): every control saves as soon as it changes. */
export function SettingsView({
  settings,
  degraded,
  shortcutError,
  error,
  onChange,
  onOpenAccessibilitySettings,
}: Props) {
  return (
    <Page title="Settings" subtitle="Changes apply immediately.">
      {!settings ? (
        <div className="max-w-xl space-y-3" aria-label="Loading settings">
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="max-w-xl space-y-6">
          {degraded && <DegradedBanner onOpenSettings={onOpenAccessibilitySettings} />}
          {error && (
            <Alert variant="warning" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Panel title="Appearance">
            <Row label="Theme" controlId="setting-theme">
              <Segmented
                aria-label="Theme"
                value={parseTheme(settings.theme)}
                options={THEMES}
                onChange={(theme) => onChange({ theme })}
              />
            </Row>
          </Panel>

          <Panel title="Tracking">
            <Row
              label="Idle after"
              description="No keyboard or mouse input for this long counts as away."
              controlId="setting-idle"
            >
              <Select
                id="setting-idle"
                aria-describedby="setting-idle-hint"
                value={settings.idle_threshold_secs}
                onChange={(event) => onChange({ idle_threshold_secs: Number(event.target.value) })}
              >
                {idleThresholdOptions(settings.idle_threshold_secs).map((option) => (
                  <option key={option.secs} value={option.secs}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
            <Row
              label="Open at login"
              description="Start tracking when you log in to this Mac."
              controlId="setting-autostart"
            >
              <Switch
                id="setting-autostart"
                aria-describedby="setting-autostart-hint"
                checked={settings.autostart}
                onCheckedChange={(autostart) => onChange({ autostart })}
              />
            </Row>
            <Row
              label="Pause / resume shortcut"
              description="Works from any app. Click, then press the new keys."
              controlId="setting-shortcut"
              error={shortcutError}
            >
              <ShortcutField
                id="setting-shortcut"
                value={settings.shortcut}
                invalid={shortcutError !== null}
                describedBy={
                  shortcutError ? "setting-shortcut-error setting-shortcut-hint" : "setting-shortcut-hint"
                }
                onChange={(shortcut) => onChange({ shortcut })}
              />
            </Row>
          </Panel>

          <Panel title="Privacy">
            <Row
              label="Record window titles"
              description="Needs Accessibility access. Off means only app names are stored. Everything stays on this Mac."
              controlId="setting-titles"
            >
              <Switch
                id="setting-titles"
                aria-describedby="setting-titles-hint"
                checked={settings.store_titles}
                onCheckedChange={(store_titles) => onChange({ store_titles })}
              />
            </Row>
          </Panel>
        </div>
      )}
    </Page>
  );
}
