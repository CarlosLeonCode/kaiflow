import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { SettingsDto, SettingsPatchDto } from "@/shared/ipc";
import { mergePatch, mockBackend, renderWithProviders, settings } from "@/test/ipc";

import { INTROS } from "../lib/intros";
import { SectionIntroContainer } from "./SectionIntroContainer";

/** Settings backend that stores the `ui` blob like the real one (whole-blob replacement). */
function backend(initial: Partial<SettingsDto> = {}) {
  let stored = settings(initial);
  return mockBackend({
    settings_get: () => stored,
    settings_update: (args) => {
      stored = mergePatch(args.patch as SettingsPatchDto, stored);
      return stored;
    },
  });
}

describe("SectionIntroContainer", () => {
  it("shows the section intro, and dismissing it persists the choice", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<SectionIntroContainer section="activities" />);

    expect(await screen.findByText(INTROS.activities.title)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Dismiss introduction to ${INTROS.activities.title}` }));

    await waitFor(() =>
      expect(calls.find((c) => c.cmd === "settings_update")?.args.patch).toMatchObject({
        ui: { dismissed_intros: ["activities"] },
      }),
    );
    await waitFor(() => expect(screen.queryByText(INTROS.activities.title)).not.toBeInTheDocument());
  });

  it("stays hidden when it was dismissed in an earlier session", async () => {
    const { calls } = backend({ ui: { dismissed_intros: ["today"] } });
    renderWithProviders(<SectionIntroContainer section="today" />);

    await waitFor(() => expect(calls.some((c) => c.cmd === "settings_get")).toBe(true));
    expect(screen.queryByText(INTROS.today.title)).not.toBeInTheDocument();
  });

  it("keeps earlier dismissals when another intro is dismissed", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ ui: { dismissed_intros: ["today"] } });
    renderWithProviders(<SectionIntroContainer section="privacy" />);

    await user.click(
      await screen.findByRole("button", { name: `Dismiss introduction to ${INTROS.privacy.title}` }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.cmd === "settings_update")?.args.patch).toMatchObject({
        ui: { dismissed_intros: ["today", "privacy"] },
      }),
    );
  });
});
