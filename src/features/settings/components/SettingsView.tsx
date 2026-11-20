import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { LANGUAGE_NAMES, LANGUAGES, parseLanguage, useT, type LanguageSetting, type Messages } from "@/shared/i18n";
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
  autoDiscardOptions,
  focusDriftOptions,
  minuteOptions,
  idleThresholdOptions,
  parseTrayDisplay,
  promptTimeoutOptions,
  trayDisplayOptions,
  weekStartOptions,
} from "../lib/options";
import { AboutPanel } from "./AboutPanel";
import { ShortcutField } from "./ShortcutField";

function themeOptions(t: Messages): readonly SegmentedOption<ThemeSetting>[] {
  const { themes } = t.settings.appearance;
  return [
    { value: "light", label: themes.light, icon: <Sun className="size-3.5" aria-hidden="true" /> },
    { value: "dark", label: themes.dark, icon: <Moon className="size-3.5" aria-hidden="true" /> },
    { value: "system", label: themes.system, icon: <Monitor className="size-3.5" aria-hidden="true" /> },
  ];
}

/** "System" is translated; each language is named in its own language. */
function languageOptions(t: Messages): readonly { value: LanguageSetting; label: string }[] {
  return [
    { value: "system", label: t.settings.appearance.systemLanguage },
    ...LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_NAMES[language] })),
  ];
}

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
  const t = useT();
  const words = platformWords(os, t);
  const s = t.settings;
  const appearance = s.appearance;
  return (
    <Page title={t.shell.sections.settings} subtitle={s.subtitle} intro={intro}>
      {!settings ? (
        <div className="max-w-xl space-y-3" aria-label={s.loading}>
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

          <Panel title={appearance.title}>
            <Row label={appearance.theme} controlId="setting-theme">
              <Segmented
                aria-label={appearance.theme}
                value={parseTheme(settings.theme)}
                options={themeOptions(t)}
                onChange={(theme) => onChange({ theme })}
              />
            </Row>
            <Row label={appearance.language} controlId="setting-language">
              <Select
                id="setting-language"
                value={parseLanguage(settings.language)}
                onChange={(event) => onChange({ language: parseLanguage(event.target.value) })}
              >
                {languageOptions(t).map((option) => (
                  <option key={option.value} value={option.value} lang={option.value === "system" ? undefined : option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title={s.calendar.title}>
            <Row
              label={s.calendar.weekStart}
              description={s.calendar.weekStartHint}
              controlId="setting-week-start"
            >
              <Select
                id="setting-week-start"
                aria-describedby="setting-week-start-hint"
                value={settings.week_start}
                onChange={(event) => onChange({ week_start: Number(event.target.value) })}
              >
                {weekStartOptions(settings.week_start, t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title={words.Tray}>
            <Row
              label={os === "windows" ? s.tray.showWindows : s.tray.show}
              description={os === "windows" ? s.tray.hintWindows : s.tray.hint}
              controlId="setting-tray-display"
            >
              <Select
                id="setting-tray-display"
                aria-describedby="setting-tray-display-hint"
                value={settings.tray_display}
                onChange={(event) => onChange({ tray_display: parseTrayDisplay(event.target.value) })}
              >
                {trayDisplayOptions(t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title={s.idle.title}>
            <Row
              label={s.idle.after}
              description={s.idle.afterHint}
              controlId="setting-idle"
            >
              <Select
                id="setting-idle"
                aria-describedby="setting-idle-hint"
                value={settings.idle_threshold_secs}
                onChange={(event) => onChange({ idle_threshold_secs: Number(event.target.value) })}
              >
                {idleThresholdOptions(settings.idle_threshold_secs, t).map((option) => (
                  <option key={option.secs} value={option.secs}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
            <Row
              label={s.idle.skip}
              description={s.idle.skipHint}
              controlId="setting-auto-discard"
            >
              <Select
                id="setting-auto-discard"
                aria-describedby="setting-auto-discard-hint"
                value={settings.idle_auto_discard_below_secs}
                onChange={(event) => onChange({ idle_auto_discard_below_secs: Number(event.target.value) })}
              >
                {autoDiscardOptions(settings.idle_auto_discard_below_secs, t).map((option) => (
                  <option key={option.secs} value={option.secs}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
            <Row
              label={s.idle.answerWithin}
              description={s.idle.answerWithinHint}
              controlId="setting-prompt-timeout"
            >
              <Select
                id="setting-prompt-timeout"
                aria-describedby="setting-prompt-timeout-hint"
                value={settings.idle_prompt_timeout_secs}
                onChange={(event) => onChange({ idle_prompt_timeout_secs: Number(event.target.value) })}
              >
                {promptTimeoutOptions(settings.idle_prompt_timeout_secs, t).map((option) => (
                  <option key={option.secs} value={option.secs}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title={s.focus.title}>
            <Row
              label={s.focus.cycle}
              description={s.focus.cycleHint}
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
                <Row label={s.focus.shortBreak} controlId="setting-focus-short-break">
                  <Select
                    id="setting-focus-short-break"
                    value={settings.focus_timer.short_break_minutes}
                    onChange={(event) =>
                      onChange({ focus_timer: { ...settings.focus_timer, short_break_minutes: Number(event.target.value) } })
                    }
                  >
                    {minuteOptions(SHORT_BREAK_MINUTES, settings.focus_timer.short_break_minutes).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {s.units.minutes(minutes)}
                      </option>
                    ))}
                  </Select>
                </Row>
                <Row label={s.focus.longBreak} controlId="setting-focus-long-break">
                  <Select
                    id="setting-focus-long-break"
                    value={settings.focus_timer.long_break_minutes}
                    onChange={(event) =>
                      onChange({ focus_timer: { ...settings.focus_timer, long_break_minutes: Number(event.target.value) } })
                    }
                  >
                    {minuteOptions(LONG_BREAK_MINUTES, settings.focus_timer.long_break_minutes).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {s.units.minutes(minutes)}
                      </option>
                    ))}
                  </Select>
                </Row>
                <Row label={s.focus.longBreakAfter} controlId="setting-focus-long-every">
                  <Select
                    id="setting-focus-long-every"
                    value={settings.focus_timer.long_break_every}
                    onChange={(event) =>
                      onChange({ focus_timer: { ...settings.focus_timer, long_break_every: Number(event.target.value) } })
                    }
                  >
                    {minuteOptions(LONG_BREAK_EVERY, settings.focus_timer.long_break_every).map((blocks) => (
                      <option key={blocks} value={blocks}>
                        {s.units.blocks(blocks)}
                      </option>
                    ))}
                  </Select>
                </Row>
                <Row
                  label={s.focus.autoStart}
                  description={s.focus.autoStartHint}
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
              label={s.focus.sound}
              description={s.focus.soundHint}
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
              label={s.focus.headsUp}
              description={s.focus.headsUpHint}
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
              label={s.focus.drift}
              description={s.focus.driftHint}
              controlId="setting-focus-drift"
            >
              <Select
                id="setting-focus-drift"
                aria-describedby="setting-focus-drift-hint"
                value={settings.focus_drift_after_secs}
                onChange={(event) => onChange({ focus_drift_after_secs: Number(event.target.value) })}
              >
                {focusDriftOptions(settings.focus_drift_after_secs, t).map((option) => (
                  <option key={option.secs} value={option.secs}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Row>
          </Panel>

          <Panel title={s.tracking.title}>
            <Row
              label={s.tracking.openAtLogin}
              description={s.tracking.openAtLoginHint(words.device)}
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
              label={s.tracking.shortcut}
              description={s.tracking.shortcutHint}
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

          <Panel title={s.privacy.title}>
            <Row
              label={s.privacy.recordTitles}
              description={titlesDescription(platform, t)}
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
function titlesDescription(platform: PlatformInfoDto, t: Messages): string {
  const words = t.settings.privacy;
  if (platform.needs_accessibility_permission) return words.titlesMac;
  const device = platformWords(platform.os, t).device;
  return isWayland(platform) ? words.titlesWayland(device) : words.titlesOther(device);
}
