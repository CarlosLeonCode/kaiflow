import { AppWindow, CheckCircle2, CircleAlert, Clock, Keyboard, Lock, RotateCw } from "lucide-react";
import { useEffect, useRef } from "react";

import type { PermissionStateDto } from "@/shared/ipc";
import { cn } from "@/shared/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { KaiflowMark } from "@/shared/ui/kaiflow-mark";
import { Switch } from "@/shared/ui/switch";

import { buildSummary, STEP_LABELS, STEPS, type Step } from "../lib/steps";

interface Props {
  step: Step;
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

/** First-run guide (presentational): what is read and why, the title switch, Accessibility. */
export function OnboardingView(props: Props) {
  const { step, busy, error, onBack, onNext, onFinish } = props;
  const heading = useRef<HTMLHeadingElement>(null);

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
                {STEP_LABELS[id]}
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
          {step === "welcome" && <WelcomeStep />}
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

function WelcomeStep() {
  const items = [
    {
      icon: AppWindow,
      title: "The app in front",
      text: "Always recorded, and it works right away. No permission needed.",
    },
    {
      icon: Lock,
      title: "Window titles (optional)",
      text: "The document or tab name. This one needs the Accessibility permission, and you can switch it off.",
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
        Kaiflow lives in your menu bar and keeps a private log of which apps you use.
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
        Everything stays on this Mac. Nothing is uploaded and there is no telemetry; the only
        network use is checking for app updates. Screen recording is never requested.
      </p>
    </div>
  );
}

function AccessStep({
  storeTitles,
  permission,
  offerRestart,
  onTitlesChange,
  onOpenAccessibilitySettings,
  onRestart,
}: Props) {
  const granted = permission === "granted";
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
    </div>
  );
}

function ReadyStep({ storeTitles, permission }: Props) {
  const summary = buildSummary(storeTitles, permission);
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">
        Tracking starts as soon as you finish and keeps working if you skip the permission.
      </p>
      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        <div className="flex justify-between gap-4 px-3 py-2.5">
          <dt className="text-muted-foreground">Recording</dt>
          <dd className="text-right font-medium">{summary.titles}</dd>
        </div>
        <div className="flex justify-between gap-4 px-3 py-2.5">
          <dt className="text-muted-foreground">Permission</dt>
          <dd className="text-right font-medium">{summary.access}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Find Kaiflow in the menu bar: click it for today's total, or open the dashboard
        for the full picture.
      </p>
    </div>
  );
}
