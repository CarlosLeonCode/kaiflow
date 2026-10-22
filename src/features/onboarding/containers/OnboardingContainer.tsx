import { useState } from "react";

import {
  errorMessage,
  useOpenAccessibilitySettingsMutation,
  usePermissionQuery,
  usePlatformQuery,
  useRestartAppMutation,
  useSettingsQuery,
  useUpdateSettingsMutation,
} from "@/shared/ipc";

import { DEFAULT_PLATFORM } from "@/shared/lib/platform";

import { OnboardingView } from "../components/OnboardingView";
import { useFinishOnboardingMutation } from "../hooks/useFinishOnboarding";
import { nextStep, previousStep, shouldOfferRestart, type Step } from "../lib/steps";

/**
 * Drives the first-run steps. The title switch saves immediately; Accessibility is live (macOS).
 * The steps wait for the platform answer (one local call) so Windows and Linux never flash the
 * macOS permission copy; if it fails, the macOS wording is the fallback.
 */
export function OnboardingContainer() {
  const [step, setStep] = useState<Step>("welcome");
  const [sawDenied, setSawDenied] = useState(false);
  const settings = useSettingsQuery();
  const permission = usePermissionQuery();
  const update = useUpdateSettingsMutation();
  const openSettings = useOpenAccessibilitySettingsMutation();
  const restart = useRestartAppMutation();
  const finish = useFinishOnboardingMutation();
  const platformQuery = usePlatformQuery();
  const platform = platformQuery.data ?? (platformQuery.isError ? DEFAULT_PLATFORM : undefined);

  // Remember that access was missing at some point: a later grant may need a restart (R5.4).
  if (permission.data === "denied" && !sawDenied) setSawDenied(true);

  const failure = [update.error, openSettings.error, restart.error, finish.error].find(Boolean);

  if (!platform) return <main aria-busy="true" aria-label="Loading" className="h-full bg-background" />;

  return (
    <OnboardingView
      step={step}
      platform={platform}
      storeTitles={settings.data?.store_titles ?? true}
      permission={permission.data}
      offerRestart={shouldOfferRestart(sawDenied, permission.data, platform)}
      busy={finish.isPending}
      error={failure ? errorMessage(failure) : null}
      onTitlesChange={(store_titles) => update.mutate({ store_titles })}
      onOpenAccessibilitySettings={() => openSettings.mutate()}
      onRestart={() => restart.mutate()}
      onBack={() => setStep(previousStep)}
      onNext={() => setStep(nextStep)}
      onFinish={() => finish.mutate()}
    />
  );
}
