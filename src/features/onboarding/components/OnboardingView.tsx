import { AppWindow, CheckCircle2, CircleAlert, Clock, Info, Keyboard, Lock, Power, RotateCw } from "lucide-react";
import { useEffect, useRef } from "react";

import { useT } from "@/shared/i18n";
import type { PermissionStateDto, PlatformInfoDto } from "@/shared/ipc";
import { isWayland, platformWords } from "@/shared/lib/platform";
import { cn } from "@/shared/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { KaiflowMark } from "@/shared/ui/kaiflow-mark";
import { Switch } from "@/shared/ui/switch";

import { buildSummary, stepLabels, STEPS, type Step } from "../lib/steps";

interface Props {
  step: Step;
  /** The copy and the steps follow the OS (only macOS has a permission to grant). */
  platform: PlatformInfoDto;
  storeTitles: boolean;
  /** `undefined` until the first answer arrives. */
  permission: PermissionStateDto | undefined;
  offerRestart: boolean;
  busy: boolean;
  error: string | null;
  onTitlesChange: (value: boolean) => void;
  onOpenAccessibilitySettings: () => void;
  onRestart: () => void;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
}

/**
 * First-run guide (presentational): what is read and why, the title switch, and on macOS the
 * Accessibility permission. Windows and Linux on X11 need no permission; Linux on Wayland
 * gets an honest explanation of what cannot be tracked there.
 */
export function OnboardingView(props: Props) {
  const { step, platform, busy, error, onBack, onNext, onFinish } = props;
  const t = useT();
  const m = t.onboarding;
  const heading = useRef<HTMLHeadingElement>(null);
  const labels = stepLabels(t, platform);

  // Keyboard and VoiceOver users land on the new step's title.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  return (
    <main className="flex h-full flex-col bg-background">
      <nav aria-label={m.progress} className="shrink-0 border-b border-border px-8 py-3">
        <ol className="flex items-center gap-2 text-xs">
          {STEPS.map((id, index) => {
            const current = id === step;
            const done = STEPS.indexOf(step) > index;
            return (
              <li
                key={id}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2",
                  current ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-2xs tabular",
                    current && "border-primary bg-primary text-primary-foreground",
                    done && "border-primary text-primary",
                    !current && !done && "border-border",
                  )}
                >
                  {index + 1}
                </span>
                {labels[id]}
                {index < STEPS.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-border" />}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {step === "welcome" && <KaiflowMark variant="detailed" className="mb-3 size-12" />}
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          {m.headings[step]}
        </h1>
        <div className="mt-4">
          {step === "welcome" && <WelcomeStep platform={platform} />}
          {step === "access" && <AccessStep {...props} />}
          {step === "ready" && <ReadyStep {...props} />}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-border px-8 py-3">
        {step === "welcome" ? (
          <span />
        ) : (
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            {m.back}
          </Button>
        )}
        {step === "ready" ? (
          <Button variant="primary" onClick={onFinish} disabled={busy}>
            {busy ? m.starting : t.tracking.toggle.start}
          </Button>
        ) : (
          <Button variant="primary" onClick={onNext}>
            {m.continue}
          </Button>
        )}
      </footer>
    </main>
  );
}

function WelcomeStep({ platform }: { platform: PlatformInfoDto }) {
  const t = useT();
  const m = t.onboarding.welcome;
  const mac = platform.needs_accessibility_permission;
  const wayland = isWayland(platform);
  const words = platformWords(platform.os, t);
  const items = [
    {
      icon: AppWindow,
      title: m.appInFront,
      text: wayland ? m.appInFrontWayland : m.appInFrontText,
    },
    {
      icon: Lock,
      title: m.titles,
      text: mac ? m.titlesMac : wayland ? m.titlesWayland : m.titlesOther,
    },
    {
      icon: Keyboard,
      title: m.keyboard,
      text: m.keyboardText,
    },
  ];
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">
        {m.intro(words.tray)}
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 px-3 py-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {mac ? m.privacyMac : m.privacyOther(words.device)}
      </p>
    </div>
  );
}

function AccessStep(props: Props) {
  const { platform, storeTitles, onTitlesChange } = props;
  const m = useT().onboarding.access;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
        <div>
          <label htmlFor="onboarding-titles" className="block font-medium">
            {m.recordTitles}
          </label>
          <p id="onboarding-titles-hint" className="text-xs text-muted-foreground">
            {m.recordTitlesHint}
          </p>
        </div>
        <Switch
          id="onboarding-titles"
          aria-describedby="onboarding-titles-hint"
          checked={storeTitles}
          onCheckedChange={onTitlesChange}
        />
      </div>

      {platform.needs_accessibility_permission ? (
        <AccessibilitySection {...props} />
      ) : isWayland(platform) ? (
        <WaylandSection />
      ) : (
        <NoPermissionSection platform={platform} />
      )}
    </div>
  );
}

/** Windows and Linux on X11: the active window is readable without any permission. */
function NoPermissionSection({ platform }: { platform: PlatformInfoDto }) {
  const t = useT();
  const m = t.onboarding.access;
  return (
    <section aria-label={m.noPermission} className="space-y-2 rounded-lg border border-border px-3 py-3">
      <h2 className="flex items-center gap-1.5 font-medium">
        <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
        {m.noPermission}
      </h2>
      <p className="text-xs text-muted-foreground">
        {platform.os === "windows" ? m.windowsText : m.x11Text} {m.storedOn(platformWords(platform.os, t).device)}
      </p>
    </section>
  );
}

/** Linux on Wayland: honest about what cannot work, and how to get it. */
function WaylandSection() {
  const t = useT();
  const m = t.onboarding.access;
  return (
    <section aria-label={m.waylandSession} className="space-y-2 rounded-lg border border-border px-3 py-3">
      <h2 className="flex items-center gap-1.5 font-medium">
        <CircleAlert className="size-4 text-warning-foreground" aria-hidden="true" />
        {t.tracking.degraded.wayland_session.title}
      </h2>
      <p className="text-xs text-muted-foreground">{m.waylandBody}</p>
      <p className="text-xs text-muted-foreground">{m.waylandHowTo}</p>
    </section>
  );
}

/** macOS: live Accessibility status, the System Settings deep link and the restart offer. */
function AccessibilitySection({
  storeTitles,
  permission,
  offerRestart,
  onOpenAccessibilitySettings,
  onRestart,
}: Props) {
  const t = useT();
  const m = t.onboarding.access;
  const granted = permission === "granted";
  return (
    <section
      aria-label={m.accessibility}
      className="space-y-3 rounded-lg border border-border px-3 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{m.accessibility}</h2>
        <p
          role="status"
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
            granted
              ? "border-success/40 text-success"
              : "border-warning-foreground/30 text-warning-foreground",
          )}
        >
          {granted ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-3.5" aria-hidden="true" />
          )}
          {permission === undefined ? m.checking : granted ? m.granted : m.missing}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {granted
          ? storeTitles
            ? m.grantedOn
            : m.grantedOff
          : storeTitles
            ? m.missingOn
            : m.missingOff}
      </p>
      {!granted && (
        <Button variant="secondary" onClick={onOpenAccessibilitySettings}>
          {t.tracking.openSystemSettings}
        </Button>
      )}
      {offerRestart && (
        <Alert variant="neutral">
          <RotateCw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <AlertTitle>{m.restartTitle}</AlertTitle>
            <AlertDescription>{m.restartBody}</AlertDescription>
            <Button size="sm" variant="secondary" className="mt-1" onClick={onRestart}>
              {m.restartNow}
            </Button>
          </div>
        </Alert>
      )}
    </section>
  );
}

function ReadyStep({ platform, storeTitles, permission }: Props) {
  const t = useT();
  const m = t.onboarding.ready;
  const summary = buildSummary(t, storeTitles, permission, platform);
  const mac = platform.needs_accessibility_permission;
  const words = platformWords(platform.os, t);
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">
        {mac ? m.macNote : isWayland(platform) ? m.waylandNote : m.otherNote}
      </p>
      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        <div className="flex justify-between gap-4 px-3 py-2.5">
          <dt className="text-muted-foreground">{m.recording}</dt>
          <dd className="text-right font-medium">{summary.titles}</dd>
        </div>
        <div className="flex justify-between gap-4 px-3 py-2.5">
          <dt className="text-muted-foreground">{summary.accessLabel}</dt>
          <dd className="text-right font-medium">{summary.access}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {platform.os === "linux" ? m.linuxTray : m.findIn(words.tray)}
      </p>
      {platform.os === "linux" && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {m.gnome}
        </p>
      )}
      {!mac && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Power className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {m.openAtLogin}
        </p>
      )}
    </div>
  );
}
