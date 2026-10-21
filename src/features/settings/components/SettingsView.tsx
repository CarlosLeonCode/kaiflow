import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import type { DegradedReasonDto, SettingsDto, SettingsPatchDto } from "@/shared/ipc";
import { APP_INFO } from "@/shared/lib/appInfo";
import { parseTheme, type ThemeSetting } from "@/shared/lib/theme";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Panel, Row } from "@/shared/ui/field";
import { Page, type IntroSlot } from "@/shared/ui/page";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import { Select } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

import { DegradedBanner } from "@/features/tracking/components/StatusBanners";

import {
  TRAY_DISPLAY_OPTIONS,
  autoDiscardOptions,
  focusDriftOptions,
  idleThresholdOptions,
  parseTrayDisplay,
  promptTimeoutOptions,
  weekStartOptions,
} from "../lib/options";
import { AboutPanel } from "./AboutPanel";
import { ShortcutField } from "./ShortcutField";

const THEMES: readonly SegmentedOption<ThemeSetting>[] = [
  { value: "light", label: "Light", icon: <Sun className="size-3.5" aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-3.5" aria-hidden="true" /> },
  { value: "system", label: "System", icon: <Monitor className="size-3.5" aria-hidden="true" /> },
];

interface Props {
  /** Section intro and its header help button, rendered by `Page`. */
  intro?: IntroSlot;
  /** `undefined` while loading. */
  settings: SettingsDto | undefined;
  degraded: boolean;
  /** Why tracking is degraded; `null` falls back to the Accessibility explanation. */
  degradedReason?: DegradedReasonDto | null;
  shortcutError: string | null;
  /** Failure of any other setting, shown once at the top. */
  error: string | null;
  onChange: (changes: Partial<SettingsPatchDto>) => void;
  onOpenAccessibilitySettings: () => void;
  /** Slot after Privacy: the Data panel (backup and restore). */
  data?: ReactNode;
  /** Slot after Data: the optional AI analysis. */
  ai?: ReactNode;
  /** Slot after the settings: the updates panel. */
  updates?: ReactNode;
}

/** Settings section (presentational): every control saves as soon as it changes. */
export function SettingsView({
  intro,
  settings,
  degraded,
  degradedReason,
  shortcutError,
  error,
  onChange,
  onOpenAccessibilitySettings,
  data,
  ai,
  updates,
}: Props) {
  return (
    <Page title="Settings" subtitle="Changes apply immediately." intro={intro}>
      {!settings ? (
        <div className="max-w-xl space-y-3" aria-label="Loading settings">
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="max-w-xl space-y-6">
          {degraded && <DegradedBanner reason={degradedReason} onOpenSettings={onOpenAccessibilitySettings} />}
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

          <Panel title="Calendar">
            <Row
              label="Week starts on"
              description="Weekly goals and the Overview count weeks from this day."
              controlId="setting-week-start"
            >
              <Select
                id="setting-week-start"
                aria-describedby="setting-week-start-hint"
                value={settings.week_start}
                onChange={(event) => onChange({ week_start: Number(event.target.value) })}
              >
                {weekStartOptions(settings.week_start).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title="Menu bar">
            <Row
              label="Show next to the icon"
              description="Updates once a minute while tracking. Paused time shows ⏸. The top goal is the first one still in progress today."
              controlId="setting-tray-display"
            >
              <Select
                id="setting-tray-display"
                aria-describedby="setting-tray-display-hint"
                value={settings.tray_display}
                onChange={(event) => onChange({ tray_display: parseTrayDisplay(event.target.value) })}
              >
                {TRAY_DISPLAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title="Idle">
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
              label="Skip the prompt for short breaks"
              description="Breaks shorter than this are discarded without asking. Changes apply right away."
              controlId="setting-auto-discard"
            >
              <Select
                id="setting-auto-discard"
                aria-describedby="setting-auto-discard-hint"
                value={settings.idle_auto_discard_below_secs}
                onChange={(event) => onChange({ idle_auto_discard_below_secs: Number(event.target.value) })}
              >
                {autoDiscardOptions(settings.idle_auto_discard_below_secs).map((option) => (
                  <option key={option.secs} value={option.secs}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
            <Row
              label="Answer the prompt within"
              description="If you do not answer in time, the away time is discarded."
              controlId="setting-prompt-timeout"
            >
              <Select
                id="setting-prompt-timeout"
                aria-describedby="setting-prompt-timeout-hint"
                value={settings.idle_prompt_timeout_secs}
                onChange={(event) => onChange({ idle_prompt_timeout_secs: Number(event.target.value) })}
              >
                {promptTimeoutOptions(settings.idle_prompt_timeout_secs).map((option) => (
                  <option key={option.secs} value={option.secs}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title="Focus sessions">
            <Row
              label="Nudge me after"
              description="Time away from what a session allows, in a row, before a gentle alert. Never more than one alert every 5 minutes."
              controlId="setting-focus-drift"
            >
              <Select
                id="setting-focus-drift"
                aria-describedby="setting-focus-drift-hint"
                value={settings.focus_drift_after_secs}
                onChange={(event) => onChange({ focus_drift_after_secs: Number(event.target.value) })}
              >
                {focusDriftOptions(settings.focus_drift_after_secs).map((option) => (
                  <option key={option.secs} value={option.secs}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title="Tracking">
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

          {data}

          {ai}

          {updates}

          <AboutPanel
            version={APP_INFO.version}
            license={APP_INFO.license}
            repositoryUrl={APP_INFO.repositoryUrl}
          />
        </div>
      )}
    </Page>
  );
}
