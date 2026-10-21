import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ActivityDto, GoalDto, GoalStatusDto } from "@/shared/ipc";
import { HOUR, MINUTE } from "@/shared/lib/time";
import { goal, goalStatus, mockBackend, renderWithProviders, report } from "@/test/ipc";

import { GoalsContainer } from "./GoalsContainer";

const SYSTEM: ActivityDto = { id: 1, name: "Unassigned", color: "#6b7280", sort_order: 0, productivity: "neutral", preset_key: null };
const WORK: ActivityDto = { id: 2, name: "Deep work", color: "#3b82f6", sort_order: 1, productivity: "productive", preset_key: null };
const MAIL = { app_id: "com.apple.mail", app_name: "Mail", total_ms: 20 * MINUTE };

/** A small in-memory backend: goals are stored as sent, progress is fixed. */
function backend(initial: GoalDto[] = [], statusOverrides: Partial<GoalStatusDto> = {}) {
  let goals = initial;
  let nextId = 50;
  const statuses = () => goals.filter((g) => !g.archived).map((g) => goalStatus({ ...statusOverrides }, { ...g }));
  return mockBackend({
    activities_list: () => [SYSTEM, WORK],
    get_report: () => report({ by_app: [MAIL] }),
    goals_list: () => goals,
    goals_status: () => statuses(),
    goals_upsert: (args) => {
      const input = args.goal as GoalDto;
      const saved = input.id > 0 ? input : { ...input, id: nextId++ };
      goals = input.id > 0 ? goals.map((g) => (g.id === input.id ? saved : g)) : [...goals, saved];
      return saved;
    },
    goals_delete: (args) => {
      goals = goals.filter((g) => g.id !== args.id);
      return null;
    },
    goal_events_mark_seen: () => null,
  });
}

const upserts = (calls: { cmd: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.cmd === "goals_upsert").map((c) => c.args.goal as GoalDto);

describe("GoalsContainer", () => {
  it("invites the user to create a first goal when there are none", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<GoalsContainer />);

    await user.click(await screen.findByRole("button", { name: "Create a goal" }));
    expect(screen.getByRole("dialog", { name: "New goal" })).toBeInTheDocument();
  });

  it("describes each goal in plain words with its progress and streak", async () => {
    backend([goal({ id: 1 }), goal({ id: 2, label: "Mail limit", kind: "maximum", scope: { kind: "app", app_id: MAIL.app_id }, target_ms: 30 * MINUTE, active_days: 127 })], {
      streak: { current: 5, best: 9, at_risk: true },
    });
    renderWithProviders(<GoalsContainer />);

    const list = await screen.findByRole("list", { name: "Goal list" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first!).getByText("At least 4h of Deep work every weekday.")).toBeInTheDocument();
    expect(within(first!).getByText(/Streak: 5 days in a row/)).toBeInTheDocument();
    expect(within(first!).getByText(/At risk this day/)).toBeInTheDocument();
    expect(within(first!).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(within(second!).getByText("No more than 30m in Mail every day.")).toBeInTheDocument();
  });

  it("shows the sentence live while the form is filled in and saves exactly that goal", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<GoalsContainer />);

    await user.click(await screen.findByRole("button", { name: "Create a goal" }));
    const dialog = screen.getByRole("dialog", { name: "New goal" });
    expect(within(dialog).getByTestId("goal-preview")).toHaveTextContent("At least 1h of Deep work every day.");

    await user.clear(within(dialog).getByRole("spinbutton", { name: "Hours" }));
    await user.type(within(dialog).getByRole("spinbutton", { name: "Hours" }), "4");
    await user.click(within(dialog).getByRole("radio", { name: "Weekdays" }));
    expect(within(dialog).getByTestId("goal-preview")).toHaveTextContent("At least 4h of Deep work every weekday.");

    await user.click(within(dialog).getByRole("radio", { name: "No more than" }));
    await user.click(within(dialog).getByRole("radio", { name: "An app" }));
    expect(within(dialog).getByRole("combobox", { name: "App" })).toHaveValue(MAIL.app_id);
    expect(within(dialog).getByTestId("goal-preview")).toHaveTextContent("No more than 4h in Mail every weekday.");

    await user.click(within(dialog).getByRole("button", { name: "Add goal" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(upserts(calls)).toEqual([
      {
        id: 0,
        label: "Mail, at most 4h daily",
        scope: { kind: "app", app_id: MAIL.app_id },
        period: "daily",
        kind: "maximum",
        target_ms: 4 * HOUR,
        active_days: 0b0011111,
        archived: false,
      },
    ]);
    expect(await screen.findByText("No more than 4h in Mail every weekday.")).toBeInTheDocument();
  });

  it("lets the user pick the active days one by one and hides them for weekly goals", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<GoalsContainer />);

    await user.click(await screen.findByRole("button", { name: "Create a goal" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Pick days" }));
    const days = within(dialog).getByRole("group", { name: "Days of the week" });
    // Every day starts on; switch Tue to Sun off, leaving Monday only.
    for (const name of ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      await user.click(within(days).getByRole("button", { name }));
    }
    expect(within(dialog).getByTestId("goal-preview")).toHaveTextContent("every Mon.");
    await user.click(within(days).getByRole("button", { name: "Wed" }));
    expect(within(dialog).getByTestId("goal-preview")).toHaveTextContent("on Mon and Wed.");

    await user.click(within(dialog).getByRole("radio", { name: "Per week" }));
    expect(within(dialog).queryByRole("group", { name: "Days of the week" })).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("goal-preview")).toHaveTextContent("every week.");
    await user.click(within(dialog).getByRole("button", { name: "Add goal" }));
    await waitFor(() => expect(upserts(calls)).toHaveLength(1));
    expect(upserts(calls)[0]).toMatchObject({ period: "weekly", active_days: 127 });
  });

  it("explains what is wrong instead of saving an invalid goal", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<GoalsContainer />);

    await user.click(await screen.findByRole("button", { name: "Create a goal" }));
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Hours" }));
    await user.type(within(dialog).getByRole("spinbutton", { name: "Hours" }), "0");
    await user.click(within(dialog).getByRole("button", { name: "Add goal" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The target must be longer than zero.");
    expect(upserts(calls)).toHaveLength(0);
  });

  it("shows a backend rejection in the dialog and keeps it open", async () => {
    const user = userEvent.setup();
    mockBackend({
      activities_list: () => [SYSTEM, WORK],
      get_report: () => report(),
      goals_list: () => [],
      goals_status: () => [],
      goals_upsert: () => {
        throw { kind: "invalid", message: "that activity does not exist" };
      },
    });
    renderWithProviders(<GoalsContainer />);

    await user.click(await screen.findByRole("button", { name: "Create a goal" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add goal" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("that activity does not exist");
  });

  it("edits an existing goal keeping its id", async () => {
    const user = userEvent.setup();
    const { calls } = backend([goal({ id: 7 })]);
    renderWithProviders(<GoalsContainer />);

    await user.click(await screen.findByRole("button", { name: "Edit Deep work" }));
    const dialog = screen.getByRole("dialog", { name: "Edit goal" });
    expect(within(dialog).getByTestId("goal-preview")).toHaveTextContent("At least 4h of Deep work every weekday.");
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Hours" }));
    await user.type(within(dialog).getByRole("spinbutton", { name: "Hours" }), "5");
    await user.click(within(dialog).getByRole("button", { name: "Save goal" }));

    await waitFor(() => expect(upserts(calls)).toHaveLength(1));
    expect(upserts(calls)[0]).toMatchObject({ id: 7, label: "Deep work", target_ms: 5 * HOUR });
  });

  it("archives a goal and restores it from the archived list", async () => {
    const user = userEvent.setup();
    const { calls } = backend([goal({ id: 7 })]);
    renderWithProviders(<GoalsContainer />);

    await user.click(await screen.findByRole("button", { name: "Archive Deep work" }));
    await waitFor(() => expect(upserts(calls)[0]).toMatchObject({ id: 7, archived: true }));

    const archived = await screen.findByRole("list", { name: "Archived list" });
    await user.click(within(archived).getByRole("button", { name: "Restore Deep work" }));
    await waitFor(() => expect(upserts(calls).at(-1)).toMatchObject({ id: 7, archived: false }));
    expect(await screen.findByRole("list", { name: "Goal list" })).toBeInTheDocument();
  });

  it("deletes only after a confirmation that says what is removed", async () => {
    const user = userEvent.setup();
    const { calls } = backend([goal({ id: 7 })]);
    renderWithProviders(<GoalsContainer />);

    await user.click(await screen.findByRole("button", { name: "Delete Deep work" }));
    const dialog = screen.getByRole("alertdialog", { name: 'Delete "Deep work"?' });
    expect(dialog).toHaveTextContent("Your tracked time is not touched");
    expect(calls.some((c) => c.cmd === "goals_delete")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Delete goal" }));

    await waitFor(() => expect(calls.filter((c) => c.cmd === "goals_delete")).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Create a goal" })).toBeInTheDocument();
  });

  it("shows the alert of a crossed limit and dismisses it", async () => {
    const user = userEvent.setup();
    const { calls } = backend([goal({ id: 7, kind: "maximum", target_ms: HOUR })], {
      state: "exceeded",
      unseen: "exceeded",
      actual_ms: 2 * HOUR,
      target_ms: HOUR,
      percent: 200,
    });
    renderWithProviders(<GoalsContainer />);

    const badge = await screen.findByTestId("goal-badge");
    expect(badge).toHaveTextContent("Limit passed");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("1h over")).toBeInTheDocument();
    await user.click(badge);
    await waitFor(() => expect(calls.filter((c) => c.cmd === "goal_events_mark_seen")[0]?.args).toEqual({ goalId: 7 }));
  });
});
