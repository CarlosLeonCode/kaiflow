import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import type { DegradedReasonDto, PlatformInfoDto, SettingsDto, SettingsPatchDto } from "@/shared/ipc";
import { APP_INFO } from "@/shared/lib/appInfo";
import { DEFAULT_PLATFORM, isWayland, platformWords } from "@/shared/lib/platform";
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
  LONG_BREAK_EVERY,
  LONG_BREAK_MINUTES,
  SHORT_BREAK_MINUTES,
  TRAY_DISPLAY_OPTIONS,
  autoDiscardOptions,
  focusDriftOptions,
  minuteOptions,
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
  /** Words the copy for the OS (macOS when omitted). */
  platform?: PlatformInfoDto;
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
  /** Slot after About: privacy-safe tracking diagnostics. */
  diagnostics?: ReactNode;
}

/** Settings section (presentational): every control saves as soon as it changes. */
export function SettingsView({
  intro,
  settings,
  platform = DEFAULT_PLATFORM,
  degraded,
  degradedReason,
  shortcutError,
  error,
  onChange,
  onOpenAccessibilitySettings,
  data,
  ai,
  updates,
  diagnostics,
}: Props) {
  const { os } = platform;
  const words = platformWords(os);
  return (
    <Page title="Settings" subtitle="Changes apply immediately." intro={intro}>
      {!settings ? (
        <div className="max-w-xl space-y-3" aria-label="Loading settings">
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="max-w-xl space-y-6">
          {degraded && (
            <DegradedBanner reason={degradedReason} os={os} onOpenSettings={onOpenAccessibilitySettings} />
          )}
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

          <Panel title={words.Tray}>
            <Row
              label={os === "windows" ? "Show in the icon tooltip" : "Show next to the icon"}
              description={
                os === "windows"
                  ? "Windows shows no text next to tray icons, so it appears when you point at the icon. Updates once a minute while tracking. Paused time shows ⏸. The top goal is the first one still in progress today."
                  : "Updates once a minute while tracking. Paused time shows ⏸. The top goal is the first one still in progress today."
              }
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
              label="Pomodoro cycle"
              description="Offer a break after each block, and a long one every few blocks."
              controlId="setting-focus-cycle"
            >
              <Switch
                id="setting-focus-cycle"
                aria-describedby="setting-focus-cycle-hint"
                checked={settings.focus_timer.cycle_enabled}
                onCheckedChange={(cycle_enabled) => onChange({ focus_timer: { ...settings.focus_timer, cycle_enabled } })}
              />
            </Row>
            {settings.focus_timer.cycle_enabled && (
              <>
                <Row label="Short break" controlId="setting-focus-short-break">
                  <Select
                    id="setting-focus-short-break"
                    value={settings.focus_timer.short_break_minutes}
                    onChange={(event) =>
                      onChange({ focus_timer: { ...settings.focus_timer, short_break_minutes: Number(event.target.value) } })
                    }
                  >
                    {minuteOptions(SHORT_BREAK_MINUTES, settings.focus_timer.short_break_minutes).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} min
                      </option>
                    ))}
                  </Select>
                </Row>
                <Row label="Long break" controlId="setting-focus-long-break">
                  <Select
                    id="setting-focus-long-break"
                    value={settings.focus_timer.long_break_minutes}
                    onChange={(event) =>
                      onChange({ focus_timer: { ...settings.focus_timer, long_break_minutes: Number(event.target.value) } })
                    }
                  >
                    {minuteOptions(LONG_BREAK_MINUTES, settings.focus_timer.long_break_minutes).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} min
                      </option>
                    ))}
                  </Select>
                </Row>
                <Row label="Long break after" controlId="setting-focus-long-every">
                  <Select
                    id="setting-focus-long-every"
                    value={settings.focus_timer.long_break_every}
                    onChange={(event) =>
                      onChange({ focus_timer: { ...settings.focus_timer, long_break_every: Number(event.target.value) } })
                    }
                  >
                    {minuteOptions(LONG_BREAK_EVERY, settings.focus_timer.long_break_every).map((blocks) => (
                      <option key={blocks} value={blocks}>
                        {blocks === 1 ? "1 block" : `${blocks} blocks`}
                      </option>
                    ))}
                  </Select>
                </Row>
                <Row
                  label="Start the next block automatically"
                  description="Off: the end card asks first."
                  controlId="setting-focus-auto-start"
                >
                  <Switch
                    id="setting-focus-auto-start"
                    aria-describedby="setting-focus-auto-start-hint"
                    checked={settings.focus_timer.auto_start_next}
                    onCheckedChange={(auto_start_next) =>
                      onChange({ focus_timer: { ...settings.focus_timer, auto_start_next } })
                    }
                  />
                </Row>
              </>
            )}
            <Row
              label="Sound"
              description="A short chime when a block or a break ends."
              controlId="setting-focus-sound"
            >
              <Switch
                id="setting-focus-sound"
                aria-describedby="setting-focus-sound-hint"
                checked={settings.focus_timer.sound}
                onCheckedChange={(sound) => onChange({ focus_timer: { ...settings.focus_timer, sound } })}
              />
            </Row>
            <Row
              label="One-minute heads-up"
              description="A notification one minute before a block ends."
              controlId="setting-focus-heads-up"
            >
              <Switch
                id="setting-focus-heads-up"
                aria-describedby="setting-focus-heads-up-hint"
                checked={settings.focus_timer.heads_up}
                onCheckedChange={(heads_up) => onChange({ focus_timer: { ...settings.focus_timer, heads_up } })}
              />
            </Row>
            <Row
              label="Nudge me after"
              description="Focus blocks with allowed apps: time away from them, in a row, before a gentle alert. Never more than one alert every 5 minutes."
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
              description={`Start tracking when you log in to ${words.device}.`}
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
                os={os}
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
              description={titlesDescription(platform)}
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

          {diagnostics}
        </div>
      )}
    </Page>
  );
}

/** Only macOS gates titles behind a permission; Wayland cannot read them at all. */
function titlesDescription(platform: PlatformInfoDto): string {
  if (platform.needs_accessibility_permission) {
    return "Needs Accessibility access. Off means only app names are stored. Everything stays on this Mac.";
  }
  const device = platformWords(platform.os).device;
  if (isWayland(platform)) {
    return `Titles cannot be read in a Wayland session; they are recorded once you use an X11 session. Off means only app names are stored. Everything stays on ${device}.`;
  }
  return `Off means only app names are stored. Everything stays on ${device}.`;
}
