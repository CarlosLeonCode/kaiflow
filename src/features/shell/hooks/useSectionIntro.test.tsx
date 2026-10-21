import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { SettingsDto, SettingsPatchDto } from "@/shared/ipc";
import { Page } from "@/shared/ui/page";
import { mergePatch, mockBackend, renderWithProviders, settings } from "@/test/ipc";

import { INTROS } from "../lib/intros";
import { SECTIONS, type SectionId } from "../lib/sections";
import { useSectionIntro } from "./useSectionIntro";

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

function Section({ section }: { section: SectionId }) {
  const intro = useSectionIntro(section);
  return (
    <Page title={section} intro={intro}>
      <p>content</p>
    </Page>
  );
}

function lastSavedIntros(calls: { cmd: string; args: Record<string, unknown> }[]) {
  const patch = calls.filter((c) => c.cmd === "settings_update").at(-1)?.args.patch as SettingsPatchDto | undefined;
  return patch?.ui?.dismissed_intros;
}

describe("useSectionIntro", () => {
  it("every section has the same three short lines and a concrete example", () => {
    for (const { id } of SECTIONS) {
      const copy = INTROS[id];
      for (const line of [copy.what, copy.can, copy.example]) {
        expect(line.length, `${id}: ${line}`).toBeGreaterThan(10);
        expect(line.length, `${id}: ${line}`).toBeLessThanOrEqual(130);
      }
    }
  });

  it("shows what, what you can do and an example, and dismissing persists the choice", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<Section section="today" />);

    const intro = await screen.findByRole("complementary", { name: `About ${INTROS.today.title}` });
    expect(within(intro).getByText("What this is")).toBeInTheDocument();
    expect(within(intro).getByText("What you can do here")).toBeInTheDocument();
    expect(within(intro).getByText("Example")).toBeInTheDocument();
    expect(intro).toHaveTextContent(INTROS.today.example);

    await user.click(within(intro).getByRole("button", { name: `Dismiss introduction to ${INTROS.today.title}` }));
    await waitFor(() => expect(lastSavedIntros(calls)).toEqual(["today"]));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    // Focus lands on the help button, which can bring the intro back.
    expect(screen.getByRole("button", { name: "Help for Today" })).toHaveFocus();
  });

  it("the help button reopens a dismissed intro and moves focus to it", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ ui: { dismissed_intros: ["preset-choice", "goals"] } });
    renderWithProviders(<Section section="goals" />);

    const help = await screen.findByRole("button", { name: "Help for Goals" });
    expect(help).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    await user.click(help);
    const intro = await screen.findByRole("complementary", { name: `About ${INTROS.goals.title}` });
    expect(intro).toHaveFocus();
    expect(help).toHaveAttribute("aria-expanded", "true");
    expect(help).toHaveAttribute("aria-controls", intro.id);
    // Only this intro comes back; other remembered choices are kept.
    await waitFor(() => expect(lastSavedIntros(calls)).toEqual(["preset-choice"]));
  });

  it("the help button moves focus to an intro that is already open", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<Section section="privacy" />);

    const intro = await screen.findByRole("complementary", { name: `About ${INTROS.privacy.title}` });
    await user.click(screen.getByRole("button", { name: "Help for Privacy" }));
    expect(intro).toHaveFocus();
    expect(calls.some((c) => c.cmd === "settings_update")).toBe(false);
  });

  it("stays hidden when it was dismissed in an earlier session", async () => {
    const { calls } = backend({ ui: { dismissed_intros: ["today"] } });
    renderWithProviders(<Section section="today" />);

    await waitFor(() => expect(calls.some((c) => c.cmd === "settings_get")).toBe(true));
    await screen.findByRole("button", { name: "Help for Today" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("keeps earlier dismissals when another intro is dismissed", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ ui: { dismissed_intros: ["today"] } });
    renderWithProviders(<Section section="privacy" />);

    await user.click(
      await screen.findByRole("button", { name: `Dismiss introduction to ${INTROS.privacy.title}` }),
    );
    await waitFor(() => expect(lastSavedIntros(calls)).toEqual(["today", "privacy"]));
  });

  it("draws the activities example as a small diagram", async () => {
    backend();
    renderWithProviders(<Section section="activities" />);
    const diagram = await screen.findByRole("list", { name: "Example of how time is sorted" });
    const rows = within(diagram).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/YouTube.*becomes\s*Distraction/);
    expect(rows[1]).toHaveTextContent(/Excel.*becomes\s*Deep work/);
  });
});
