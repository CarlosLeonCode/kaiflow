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
  let activities = options.activities ?? [SYSTEM];
  return mockBackend({
    activities_list: () => activities,
    activities_create: (args) => {
      const created: ActivityDto = {
        id: 10 + activities.length,
        name: args.name as string,
        color: args.color as string,
        sort_order: activities.length,
        productivity: args.productivity as ActivityDto["productivity"],
        preset_key: null,
      };
      activities = [...activities, created];
      return created;
    },
    activities_update: (args) => {
      const next = args.activity as ActivityDto;
      activities = activities.map((a) => (a.id === next.id ? next : a));
      return null;
    },
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

async function findGuide() {
  return screen.findByRole("region", { name: "Set up activities in three steps" });
}

describe("guided setup", () => {
  it("opens by itself on a fresh setup with every pack and Start empty as equals", async () => {
    const { calls } = backend();
    renderWithProviders(<ActivitiesContainer />);

    const guide = await findGuide();
    expect(within(guide).getByRole("heading", { name: "Step 1 of 3: Create or pick activities" })).toBeInTheDocument();
    const steps = within(guide).getByRole("list", { name: "Setup steps" });
    expect(within(steps).getByRole("button", { name: "1. Create or pick activities" })).toHaveAttribute("aria-current", "step");

    const options = within(guide).getByRole("list", { name: "Ways to start" });
    expect(within(options).getAllByRole("listitem")).toHaveLength(3);
    const empty = within(options).getByRole("button", { name: "Start empty" });
    // Same variant (class list) as the pack buttons: no visual hierarchy between the options.
    expect(empty.className).toBe(within(options).getByRole("button", { name: "Preview the General pack" }).className);
    expect(within(options).queryByRole("radio")).not.toBeInTheDocument();
    // Opening by itself does not steal keyboard focus.
    expect(guide).not.toContainElement(document.activeElement as HTMLElement);
    expect(calls.map((c) => c.cmd)).not.toContain("presets_apply");
    expect(calls.map((c) => c.cmd)).not.toContain("activities_create");
  });

  it("shows what a pack contains, applies it only on confirmation and moves on to rules", async () => {
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
    const step = await screen.findByRole("heading", { name: "Step 2 of 3: Add rules" });
    expect(step).toHaveFocus();
  });

  it("goes back from a pack preview without applying anything", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<ActivitiesContainer />);

    await user.click(await screen.findByRole("button", { name: "Preview the Design pack" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("list", { name: "Ways to start" })).toBeInTheDocument();
    expect(calls.map((c) => c.cmd)).not.toContain("presets_apply");
  });

  it("Start empty creates nothing by itself and lets the user name a first activity", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<ActivitiesContainer />);

    await user.click(await screen.findByRole("button", { name: "Start empty" }));
    expect(calls.map((c) => c.cmd)).not.toContain("presets_apply");
    expect(calls.map((c) => c.cmd)).not.toContain("activities_create");

    const guide = await findGuide();
    await user.type(within(guide).getByRole("textbox", { name: "Name" }), "Deep work");
    await user.click(within(guide).getByRole("button", { name: "Add activity" }));
    await waitFor(() => expect(calls.find((c) => c.cmd === "activities_create")?.args).toMatchObject({ name: "Deep work" }));
    expect(await within(guide).findByRole("heading", { name: "Step 2 of 3: Add rules" })).toBeInTheDocument();
  });

  it("explains both kinds of rules and how each activity counts, and saves the choice", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ activities: [SYSTEM, WORK], dismissed: [] });
    renderWithProviders(<ActivitiesContainer />);

    await user.click(await screen.findByRole("button", { name: "How this works" }));
    const guide = await findGuide();
    await user.click(within(guide).getByRole("button", { name: "Next: Add rules" }));
    expect(guide).toHaveTextContent("By app:");
    expect(guide).toHaveTextContent("By window title:");
    expect(within(guide).getByRole("button", { name: "Add a rule" })).toBeInTheDocument();

    await user.click(within(guide).getByRole("button", { name: "Next: Mark how each activity counts" }));
    expect(guide).toHaveTextContent("focus percentage in Overview and Review");
    expect(guide).toHaveTextContent("Goals and Focus sessions");
    await user.click(within(guide).getByRole("radio", { name: "Distracting" }));
    await waitFor(() =>
      expect(calls.find((c) => c.cmd === "activities_update")?.args.activity).toMatchObject({
        id: 2,
        productivity: "distracting",
      }),
    );

    await user.click(within(guide).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Set up activities in three steps" })).not.toBeInTheDocument());
  });

  it("closing it is remembered, and How this works reopens it with focus", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<ActivitiesContainer />);

    await findGuide();
    await user.click(screen.getByRole("button", { name: "Close the setup guide" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Set up activities in three steps" })).not.toBeInTheDocument());
    await waitFor(() => {
      const saved = calls.find((c) => c.cmd === "settings_update")?.args.patch as SettingsPatchDto | undefined;
      expect(saved?.ui?.dismissed_intros).toContain("activities-guide");
    });
    // The rest of the page still offers the first step.
    expect(screen.getByRole("button", { name: "Create your first activity" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "How this works" }));
    const guide = await findGuide();
    expect(within(guide).getByRole("heading", { level: 2, name: "Set up activities in three steps" })).toHaveFocus();
    expect(within(guide).getByRole("heading", { name: "Step 1 of 3: Create or pick activities" })).toBeInTheDocument();
  });

  it("does not open by itself once closed, or after the older first-run choice", async () => {
    for (const dismissed of [["activities-guide"], ["preset-choice"]]) {
      backend({ dismissed });
      const { unmount } = renderWithProviders(<ActivitiesContainer />);
      await screen.findByRole("button", { name: "Create your first activity" });
      expect(screen.queryByRole("region", { name: "Set up activities in three steps" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("does not open by itself when activities already exist", async () => {
    backend({ activities: [SYSTEM, WORK] });
    renderWithProviders(<ActivitiesContainer />);
    await screen.findByRole("list", { name: "Activity list" });
    expect(screen.queryByRole("region", { name: "Set up activities in three steps" })).not.toBeInTheDocument();
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

describe("Unassigned", () => {
  it("explains itself and leads to the suggestions", async () => {
    const user = userEvent.setup();
    backend({ activities: [SYSTEM, WORK], suggestions: [CHROME] });
    renderWithProviders(<ActivitiesContainer />);

    const list = await screen.findByRole("list", { name: "Activity list" });
    const row = within(list).getAllByRole("listitem")[0]!;
    expect(row).toHaveTextContent("Time no rule matches yet");

    await user.click(within(row).getByRole("button", { name: "About Unassigned" }));
    expect(await screen.findByRole("dialog", { name: "Unassigned" })).toHaveTextContent("no rule matches yet");
    await user.keyboard("{Escape}");

    await user.click(within(row).getByRole("button", { name: "See suggestions" }));
    expect(screen.getByRole("region", { name: "Suggestions" })).toHaveFocus();
  });

  it("offers no suggestions button when there are none", async () => {
    backend({ activities: [SYSTEM, WORK] });
    renderWithProviders(<ActivitiesContainer />);
    const list = await screen.findByRole("list", { name: "Activity list" });
    expect(within(list).queryByRole("button", { name: "See suggestions" })).not.toBeInTheDocument();
  });
});
