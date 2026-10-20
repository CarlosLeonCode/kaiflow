import { useMutation } from "@tanstack/react-query";

import { commands, settingsPatch, unwrap } from "@/shared/ipc";

/**
 * Marks onboarding complete, starts tracking (works with or without Accessibility) and
 * closes the window. The steps are idempotent, so retrying after a failure is safe.
 */
export function useFinishOnboardingMutation() {
  return useMutation({
    mutationFn: async () => {
      await unwrap(commands.settingsUpdate(settingsPatch({ onboarding_completed: true })));
      await unwrap(commands.start());
      await unwrap(commands.closeOnboarding());
    },
  });
}
