import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ActivityDto, PresetDto, SettingsPatchDto, SuggestionDto } from "@/shared/ipc";
import { mergePatch, mockBackend, renderWithProviders, report, settings } from "@/test/ipc";

import { ActivitiesContainer } from "./ActivitiesContainer";

const SYSTEM: ActivityDto = { id: 1, name: "Unassigned", color: "#6b7280", sort_order: 0, productivity: "neutral", preset_key: null };
const WORK: ActivityDto = { id: 2, name: "Work", color: "#3b82f6", sort_order: 1, productivity: "productive", preset_key: null };

const DESIGN: PresetDto = {
  key: "design",
  name: "Design",
  description: "Design, illustration and video tools.",
  activities: [
    { key: "design.tools", name: "Design tools", color: "#d946ef", productivity: "productive", example_apps: ["figma", "sketch"] },
    { key: "design.video", name: "Video & motion", color: "#ef4444", productivity: "neutral", example_apps: [] },
  ],
};
const GENERAL: PresetDto = { key: "general", name: "General", description: "Everyday apps.", activities: [] };

const CHROME: SuggestionDto = {
  app_id: "com.google.Chrome",
  app_name: "Chrome",
  pack_key: "general",
  activity_key: "general.browsing",
  activity_name: "Browsing",
  activity_id: null,
};

function backend(options: { activities?: ActivityDto[]; suggestions?: SuggestionDto[]; dismissed?: string[] } = {}) {
  let stored = settings({ ui: { dismissed_intros: options.dismissed ?? [] } });
  let suggestions = options.suggestions ?? [];
  return mockBackend({
    activities_list: () => options.activities ?? [SYSTEM],
    rules_list: () => [],
    get_report: () => report(),
    presets_list: () => [GENERAL, DESIGN],
    presets_apply: () => ({ activities_created: 2, rules_created: 1 }),
    suggestions_list: () => suggestions,
    suggestions_accept: (args) => {
      suggestions = suggestions.filter((s) => s.app_id !== args.appId);
      return null;
    },
    suggestions_dismiss: (args) => {
      suggestions = suggestions.filter((s) => s.app_id !== args.appId);
      return null;
    },
    settings_get: () => stored,
    settings_update: (args) => {
      stored = mergePatch(args.patch as SettingsPatchDto, stored);
      return stored;
    },
  });
}

describe("first-run preset choice", () => {
  it("offers every pack and Start empty as equals, with nothing selected or created", async () => {
    const { calls } = backend();
    renderWithProviders(<ActivitiesContainer />);

    const options = await screen.findByRole("list", { name: "Ways to start" });
    const cards = within(options).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(within(options).getByRole("button", { name: "Preview the Design pack" })).toBeInTheDocument();
    const empty = within(options).getByRole("button", { name: "Start empty" });
    // Same variant (class list) as the pack buttons: no visual hierarchy between the options.
    expect(empty.className).toBe(within(options).getByRole("button", { name: "Preview the General pack" }).className);
    expect(within(options).queryByRole("radio")).not.toBeInTheDocument();
    expect(calls.map((c) => c.cmd)).not.toContain("presets_apply");
    expect(calls.map((c) => c.cmd)).not.toContain("activities_create");
  });

  it("shows what a pack contains and applies it only on confirmation", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<ActivitiesContainer />);

    await user.click(await screen.findByRole("button", { name: "Preview the Design pack" }));
    const preview = screen.getByRole("list", { name: "Activities in the Design pack" });
    expect(within(preview).getByText("Design tools")).toBeInTheDocument();
    expect(within(preview).getByText("Productive · e.g. Figma, Sketch")).toBeInTheDocument();
    expect(calls.map((c) => c.cmd)).not.toContain("presets_apply");

    await user.click(screen.getByRole("button", { name: "Add Design activities" }));
    await waitFor(() => expect(calls.find((c) => c.cmd === "presets_apply")?.args).toEqual({ key: "design" }));
    expect(await screen.findByText("Design: added 2 activities and 1 rule for apps you already used.")).toBeInTheDocument();
  });

  it("goes back from a preview without applying anything", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<ActivitiesContainer />);

    await user.click(await screen.findByRole("button", { name: "Preview the Design pack" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("list", { name: "Ways to start" })).toBeInTheDocument();
    expect(calls.map((c) => c.cmd)).not.toContain("presets_apply");
  });

  it("Start empty creates nothing, hides the choice and remembers it", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<ActivitiesContainer />);

    await user.click(await screen.findByRole("button", { name: "Start empty" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Ways to start" })).not.toBeInTheDocument());
    const saved = calls.find((c) => c.cmd === "settings_update")?.args.patch as SettingsPatchDto;
    expect(saved.ui?.dismissed_intros).toContain("preset-choice");
    expect(calls.map((c) => c.cmd)).not.toContain("presets_apply");
    expect(calls.map((c) => c.cmd)).not.toContain("activities_create");
    expect(screen.getByRole("button", { name: "Create your first activity" })).toBeInTheDocument();
  });

  it("does not show the choice again once it was made", async () => {
    backend({ dismissed: ["preset-choice"] });
    renderWithProviders(<ActivitiesContainer />);
    await screen.findByRole("button", { name: "Create your first activity" });
    expect(screen.queryByRole("list", { name: "Ways to start" })).not.toBeInTheDocument();
  });

  it("is not offered when activities already exist", async () => {
    backend({ activities: [SYSTEM, WORK] });
    renderWithProviders(<ActivitiesContainer />);
    await screen.findByRole("list", { name: "Activity list" });
    expect(screen.queryByRole("list", { name: "Ways to start" })).not.toBeInTheDocument();
  });
});

describe("suggestions", () => {
  it("lists suggestions for unassigned apps and nothing applies by itself", async () => {
    const { calls } = backend({ activities: [SYSTEM, WORK], suggestions: [CHROME] });
    renderWithProviders(<ActivitiesContainer />);

    const list = await screen.findByRole("list", { name: "Suggestion list" });
    expect(within(list).getByText("Chrome")).toBeInTheDocument();
    expect(within(list).getByText("Suggested activity: Browsing (new)")).toBeInTheDocument();
    expect(calls.map((c) => c.cmd)).not.toContain("suggestions_accept");
  });

  it("accepting asks the backend for the rule and the suggestion goes away", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ activities: [SYSTEM, WORK], suggestions: [CHROME] });
    renderWithProviders(<ActivitiesContainer />);

    await user.click(await screen.findByRole("button", { name: "Accept Chrome as Browsing" }));
    await waitFor(() => expect(calls.find((c) => c.cmd === "suggestions_accept")?.args).toEqual({ appId: CHROME.app_id }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Suggestion list" })).not.toBeInTheDocument());
  });

  it("dismissing persists through the backend and creates no rule", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ activities: [SYSTEM, WORK], suggestions: [CHROME] });
    renderWithProviders(<ActivitiesContainer />);

    await user.click(await screen.findByRole("button", { name: "Dismiss suggestion for Chrome" }));
    await waitFor(() => expect(calls.find((c) => c.cmd === "suggestions_dismiss")?.args).toEqual({ appId: CHROME.app_id }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Suggestion list" })).not.toBeInTheDocument());
    expect(calls.map((c) => c.cmd)).not.toContain("suggestions_accept");
    expect(calls.map((c) => c.cmd)).not.toContain("rules_upsert");
  });

  it("shows nothing when there are no suggestions", async () => {
    backend({ activities: [SYSTEM, WORK] });
    renderWithProviders(<ActivitiesContainer />);
    await screen.findByRole("list", { name: "Activity list" });
    expect(screen.queryByRole("region", { name: "Suggestions" })).not.toBeInTheDocument();
  });
});
