import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ActivityDto, FocusActiveDto, FocusSessionDto, FocusStartDto, FocusStatusDto } from "@/shared/ipc";
import { MINUTE } from "@/shared/lib/time";
import { focusActive, focusSession, idleFocus, mockBackend, renderWithProviders, report } from "@/test/ipc";

import { FocusContainer } from "./FocusContainer";

const SYSTEM: ActivityDto = { id: 1, name: "Unassigned", color: "#6b7280", sort_order: 0, productivity: "neutral", preset_key: null };
const WORK: ActivityDto = { id: 2, name: "Deep work", color: "#3b82f6", sort_order: 1, productivity: "productive", preset_key: null };
const EXCEL = { app_id: "com.microsoft.Excel", app_name: "Excel", total_ms: 20 * MINUTE };

/** A session that has 40 minutes left right now (the card reads the real clock). */
function running(overrides: Partial<FocusActiveDto> = {}): FocusActiveDto {
  const now = Date.now();
  return focusActive({ started_at: now - 10 * MINUTE, planned_end: now + 40 * MINUTE, ...overrides });
}

interface Rig {
  status: FocusStatusDto;
  history: FocusSessionDto[];
}

/** A small in-memory backend: commands answer with the status they leave behind. */
function backend(initial: Partial<Rig> = {}) {
  const rig: Rig = { status: idleFocus(), history: [], ...initial };
  const calls = mockBackend({
    activities_list: () => [SYSTEM, WORK],
    get_report: () => report({ by_app: [EXCEL] }),
    focus_status: () => rig.status,
    focus_history: () => rig.history,
    focus_start: (args) => {
      const start = args.start as FocusStartDto;
      rig.status = idleFocus({
        active: running({ intent: start.intent, allowed: start.allowed, current: null }),
      });
      return rig.status;
    },
    focus_stop: () => {
      rig.status = idleFocus({ unseen: focusSession({ end_reason: "cancelled" }) });
      return rig.status;
    },
    focus_extend: () => rig.status,
    focus_snooze: () => {
      rig.status = idleFocus({ active: running({ alerting: null }) });
      return rig.status;
    },
    focus_allow_app: () => {
      rig.status = idleFocus({ active: running({ alerting: null }) });
      return rig.status;
    },
    focus_summary_dismiss: () => {
      rig.status = idleFocus();
      return rig.status;
    },
  });
  return { ...calls, rig };
}

const sent = (calls: { cmd: string; args: Record<string, unknown> }[], cmd: string) =>
  calls.filter((c) => c.cmd === cmd).map((c) => c.args);

describe("FocusContainer", () => {
  it("invites the user to start a first session when there is none", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<FocusContainer />);

    expect(await screen.findByText("No focus sessions yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start a session" }));
    expect(screen.getByRole("dialog", { name: "Start a focus session" })).toBeInTheDocument();
  });

  it("starts a session from the intent, a duration preset and what is allowed", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<FocusContainer />);

    await user.click(await screen.findByRole("button", { name: "Start session" }));
    const dialog = screen.getByRole("dialog", { name: "Start a focus session" });
    // Nothing is chosen for the user.
    expect(within(dialog).getByRole("radio", { name: "25 min" })).toBeChecked();
    expect(within(dialog).getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);

    await user.type(within(dialog).getByRole("textbox", { name: /What do you want to focus on/ }), "Write report");
    await user.click(within(dialog).getByRole("radio", { name: "50 min" }));
    await user.click(within(within(dialog).getByRole("group", { name: "Allowed activities" })).getByRole("checkbox", { name: "Deep work" }));
    await user.click(within(within(dialog).getByRole("group", { name: "Allowed apps" })).getByRole("checkbox", { name: "Excel" }));
    await user.click(within(dialog).getByRole("button", { name: "Start session" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent(calls, "focus_start")).toEqual([
      {
        start: {
          intent: "Write report",
          planned_minutes: 50,
          allowed: { activity_ids: [2], app_ids: ["com.microsoft.Excel"] },
        },
      },
    ]);
    const card = await screen.findByRole("region", { name: "Focus session" });
    expect(within(card).getByText("Write report")).toBeInTheDocument();
    expect(within(card).getByTestId("focus-countdown")).toHaveTextContent(/^(39|40):\d\d$/);
    // The one running session blocks starting another.
    expect(screen.getByRole("button", { name: "Start session" })).toBeDisabled();
  });

  it("takes a custom length and refuses an incomplete form without calling the backend", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<FocusContainer />);

    await user.click(await screen.findByRole("button", { name: "Start session" }));
    const dialog = screen.getByRole("dialog", { name: "Start a focus session" });
    await user.click(within(dialog).getByRole("button", { name: "Start session" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Describe what you want to focus on.");

    await user.type(within(dialog).getByRole("textbox", { name: /What do you want/ }), "Plan");
    await user.click(within(dialog).getByRole("radio", { name: "Custom" }));
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Minutes" }));
    await user.type(within(dialog).getByRole("spinbutton", { name: "Minutes" }), "35");
    await user.click(within(dialog).getByRole("button", { name: "Start session" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Allow at least one activity or app/);
    expect(sent(calls, "focus_start")).toEqual([]);

    await user.click(within(within(dialog).getByRole("group", { name: "Allowed activities" })).getByRole("checkbox", { name: "Deep work" }));
    await user.click(within(dialog).getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(sent(calls, "focus_start")).toHaveLength(1));
    expect((sent(calls, "focus_start")[0]!.start as FocusStartDto).planned_minutes).toBe(35);
  });

  it("blocks starting with a clear reason while tracking is degraded", async () => {
    backend({ status: idleFocus({ unavailable: "wayland_session" }) });
    renderWithProviders(<FocusContainer />);

    expect(await screen.findByText("Focus sessions are unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Window tracking is unavailable on Wayland/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start session" })).toBeDisabled();
  });

  it("shows the reason in the dialog when the backend refuses to start", async () => {
    const user = userEvent.setup();
    mockBackend({
      activities_list: () => [SYSTEM, WORK],
      get_report: () => report(),
      focus_status: () => idleFocus(),
      focus_history: () => [],
      focus_start: () => {
        throw { kind: "focus_unavailable", reason: "no_display" };
      },
    });
    renderWithProviders(<FocusContainer />);

    await user.click(await screen.findByRole("button", { name: "Start session" }));
    const dialog = screen.getByRole("dialog", { name: "Start a focus session" });
    await user.type(within(dialog).getByRole("textbox", { name: /What do you want/ }), "Plan");
    await user.click(within(within(dialog).getByRole("group", { name: "Allowed activities" })).getByRole("checkbox", { name: "Deep work" }));
    await user.click(within(dialog).getByRole("button", { name: "Start session" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Focus sessions need window tracking");
  });

  it("ends the session, then shows how it went until it is dismissed", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ status: idleFocus({ active: running() }) });
    renderWithProviders(<FocusContainer />);

    const card = await screen.findByRole("region", { name: "Focus session" });
    expect(within(card).getByText(/Allowed: 1 activity and 1 app/)).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "End session" }));

    const summary = await screen.findByRole("region", { name: "Session summary" });
    expect(sent(calls, "focus_stop")).toHaveLength(1);
    expect(within(summary).getByText("Ended early")).toBeInTheDocument();
    expect(within(summary).getByTestId("summary-headline")).toHaveTextContent("75% of your time stayed on target");
    expect(within(summary).getByText("45m")).toBeInTheDocument();
    expect(within(summary).getByText("2 alerts")).toBeInTheDocument();
    const distractions = within(summary).getByRole("list", { name: "Top distractions" });
    expect(within(distractions).getByText("Slack")).toBeInTheDocument();

    await user.click(within(summary).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Session summary" })).not.toBeInTheDocument());
    expect(sent(calls, "focus_summary_dismiss")).toEqual([{ id: 3 }]);
  });

  it("explains an empty summary when nothing was tracked", async () => {
    backend({ status: idleFocus({ unseen: focusSession({ percent_inside: null, inside_ms: 0, outside_ms: 0, top_distractions: [], drift_alerts: 0 }) }) });
    renderWithProviders(<FocusContainer />);

    expect(await screen.findByTestId("summary-headline")).toHaveTextContent("No tracked time during this session");
    expect(screen.queryByRole("list", { name: "Top distractions" })).not.toBeInTheDocument();
  });

  it("extends the session by ten minutes", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ status: idleFocus({ active: running() }) });
    renderWithProviders(<FocusContainer />);

    await user.click(await screen.findByRole("button", { name: "+10 min" }));
    await waitFor(() => expect(sent(calls, "focus_extend")).toEqual([{ minutes: 10 }]));
  });

  it("offers the three ways out of a drift and acts on each", async () => {
    const user = userEvent.setup();
    const slack = { app_id: "com.tinyspeck.slackmacgap", app_name: "Slack", activity_id: 3 };
    const drifting = idleFocus({ active: running({ current: slack, alerting: slack, drift_alerts: 1 }) });

    const first = backend({ status: drifting });
    renderWithProviders(<FocusContainer />);
    const alert = await screen.findByRole("status", { name: "Drift alert" });
    expect(within(alert).getByText("Still on track?")).toBeInTheDocument();
    expect(within(alert).getByText(/You have been in Slack for a while/)).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Back to it" })).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "End session" })).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Allow this app" }));
    await waitFor(() => expect(sent(first.calls, "focus_allow_app")).toEqual([{ appId: slack.app_id }]));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Drift alert" })).not.toBeInTheDocument());
  });

  it("goes back to it with a five minute snooze", async () => {
    const user = userEvent.setup();
    const slack = { app_id: "com.tinyspeck.slackmacgap", app_name: "Slack", activity_id: 3 };
    const { calls } = backend({ status: idleFocus({ active: running({ current: slack, alerting: slack }) }) });
    renderWithProviders(<FocusContainer />);

    await user.click(await screen.findByRole("button", { name: "Back to it" }));
    await waitFor(() => expect(sent(calls, "focus_snooze")).toEqual([{ minutes: 5 }]));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Drift alert" })).not.toBeInTheDocument());
  });

  it("says drift alerts are paused while nothing is being observed", async () => {
    backend({ status: idleFocus({ active: running({ current: null }) }) });
    renderWithProviders(<FocusContainer />);

    expect(await screen.findByText(/drift alerts are paused/)).toBeInTheDocument();
  });

  it("lists recent sessions with how much of each stayed on target", async () => {
    backend({
      history: [
        focusSession({ id: 3, intent: "Write report", percent_inside: 75 }),
        focusSession({ id: 2, intent: "Plan sprint", percent_inside: null, end_reason: "recovered", drift_alerts: 0 }),
      ],
    });
    renderWithProviders(<FocusContainer />);

    const history = await screen.findByRole("region", { name: "Recent sessions" });
    const [first, second] = within(history).getAllByRole("listitem");
    expect(within(first!).getByText("Write report")).toBeInTheDocument();
    expect(within(first!).getByLabelText("On target")).toHaveTextContent("75%");
    expect(within(second!).getByText(/Ended while the app was closed/)).toBeInTheDocument();
    expect(within(second!).getByLabelText("On target")).toHaveTextContent("No data");
  });
});
