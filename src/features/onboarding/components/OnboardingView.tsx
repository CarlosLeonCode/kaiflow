import { AppWindow, CheckCircle2, CircleAlert, Clock, Info, Keyboard, Lock, Power, RotateCw } from "lucide-react";
import { useEffect, useRef } from "react";

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
  const heading = useRef<HTMLHeadingElement>(null);
  const labels = stepLabels(platform);

  // Keyboard and VoiceOver users land on the new step's title.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  return (
    <main className="flex h-full flex-col bg-background">
      <nav aria-label="Progress" className="shrink-0 border-b border-border px-8 py-3">
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
          {step === "welcome" && "Know where your time goes"}
          {step === "access" && "Choose what to record"}
          {step === "ready" && "You're all set"}
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
            Back
          </Button>
        )}
        {step === "ready" ? (
          <Button variant="primary" onClick={onFinish} disabled={busy}>
            {busy ? "Starting…" : "Start tracking"}
          </Button>
        ) : (
          <Button variant="primary" onClick={onNext}>
            Continue
          </Button>
        )}
      </footer>
    </main>
  );
}

function WelcomeStep({ platform }: { platform: PlatformInfoDto }) {
  const mac = platform.needs_accessibility_permission;
  const wayland = isWayland(platform);
  const words = platformWords(platform.os);
  const items = [
    {
      icon: AppWindow,
      title: "The app in front",
      text: wayland
        ? "The app you are using. Not available in a Wayland session; the next step explains why."
        : "Always recorded, and it works right away. No permission needed.",
    },
    {
      icon: Lock,
      title: "Window titles (optional)",
      text: mac
        ? "The document or tab name. This one needs the Accessibility permission, and you can switch it off."
        : wayland
          ? "The document or tab name. Also unavailable on Wayland, and you can switch it off."
          : "The document or tab name of the active window. No permission needed, and you can switch it off.",
    },
    {
      icon: Keyboard,
      title: "Whether you are at the keyboard",
      text: "Only the time since your last input, to spot idle time. Never what you type.",
    },
  ];
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">
        Kaiflow lives in your {words.tray} and keeps a private log of which apps you use.
        Here is exactly what it reads and why.
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
        {mac
          ? "Everything stays on this Mac. Nothing is uploaded and there is no telemetry; the only network use is checking for app updates. Screen recording is never requested."
          : `Everything stays on ${words.device}. Nothing is uploaded and there is no telemetry; the only network use is checking for app updates. Your screen, keystrokes and files are never read.`}
      </p>
    </div>
  );
}

function AccessStep(props: Props) {
  const { platform, storeTitles, onTitlesChange } = props;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
        <div>
          <label htmlFor="onboarding-titles" className="block font-medium">
            Record window titles
          </label>
          <p id="onboarding-titles-hint" className="text-xs text-muted-foreground">
            Off means only app names are stored. You can change this any time in Settings.
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
  return (
    <section aria-label="No permission needed" className="space-y-2 rounded-lg border border-border px-3 py-3">
      <h2 className="flex items-center gap-1.5 font-medium">
        <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
        No permission needed
      </h2>
      <p className="text-xs text-muted-foreground">
        {platform.os === "windows"
          ? "Windows lets Kaiflow read the active app and its window title without a permission prompt."
          : "On an X11 session Kaiflow reads the active app and its window title from the display server, without a permission prompt."}{" "}
        Only the name of the app in front and, if the switch above is on, its title are stored, on{" "}
        {platformWords(platform.os).device}.
      </p>
    </section>
  );
}

/** Linux on Wayland: honest about what cannot work, and how to get it. */
function WaylandSection() {
  return (
    <section aria-label="Wayland session" className="space-y-2 rounded-lg border border-border px-3 py-3">
      <h2 className="flex items-center gap-1.5 font-medium">
        <CircleAlert className="size-4 text-warning-foreground" aria-hidden="true" />
        Window tracking is unavailable on Wayland
      </h2>
      <p className="text-xs text-muted-foreground">
        Wayland does not let apps see which window is in front, so Kaiflow cannot record time per app
        or window titles in this session. Idle, lock and sleep detection, focus timers and goals still work.
      </p>
      <p className="text-xs text-muted-foreground">
        To track apps, log out and pick an X11 session on the login screen, such as &ldquo;Ubuntu on
        Xorg&rdquo; from the gear menu on Ubuntu. There is no permission to grant here.
      </p>
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
  const granted = permission === "granted";
  return (
    <section
      aria-label="Accessibility access"
      className="space-y-3 rounded-lg border border-border px-3 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Accessibility access</h2>
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
          {permission === undefined ? "Checking…" : granted ? "Granted" : "Missing"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {granted
          ? storeTitles
            ? "Window titles will be recorded."
            : "Granted. Window titles stay off while the switch above is off."
          : storeTitles
            ? "Without it, only app names are recorded. In System Settings, open Privacy & Security, then Accessibility, and switch on Kaiflow. This page updates by itself."
            : "Not needed while window titles are off."}
      </p>
      {!granted && (
        <Button variant="secondary" onClick={onOpenAccessibilitySettings}>
          Open System Settings
        </Button>
      )}
      {offerRestart && (
        <Alert variant="neutral">
          <RotateCw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <AlertTitle>Restart to apply</AlertTitle>
            <AlertDescription>
              macOS sometimes only applies the permission to apps that start after it. If titles
              do not show up, restart Kaiflow.
            </AlertDescription>
            <Button size="sm" variant="secondary" className="mt-1" onClick={onRestart}>
              Restart now
            </Button>
          </div>
        </Alert>
      )}
    </section>
  );
}

function ReadyStep({ platform, storeTitles, permission }: Props) {
  const summary = buildSummary(storeTitles, permission, platform);
  const mac = platform.needs_accessibility_permission;
  const words = platformWords(platform.os);
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">
        {mac
          ? "Tracking starts as soon as you finish and keeps working if you skip the permission."
          : isWayland(platform)
            ? "Tracking starts as soon as you finish. Until you use an X11 session it records idle and away time only."
            : "Tracking starts as soon as you finish."}
      </p>
      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        <div className="flex justify-between gap-4 px-3 py-2.5">
          <dt className="text-muted-foreground">Recording</dt>
          <dd className="text-right font-medium">{summary.titles}</dd>
        </div>
        <div className="flex justify-between gap-4 px-3 py-2.5">
          <dt className="text-muted-foreground">{summary.accessLabel}</dt>
          <dd className="text-right font-medium">{summary.access}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {platform.os === "linux"
          ? "Find Kaiflow in the system tray: its menu pauses tracking and opens the dashboard."
          : `Find Kaiflow in the ${words.tray}: click it for today's total, or open the dashboard for the full picture.`}
      </p>
      {platform.os === "linux" && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          On GNOME the tray icon needs the AppIndicator extension (&ldquo;AppIndicator and KStatusNotifierItem
          Support&rdquo;). Ubuntu ships it already.
        </p>
      )}
      {!mac && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Power className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          To start Kaiflow every time you sign in, turn on Open at login in Settings.
        </p>
      )}
    </div>
  );
}
