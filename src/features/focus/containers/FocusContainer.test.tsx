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
        active: running({ kind: start.kind, intent: start.intent, allowed: start.allowed, current: null }),
      });
      return rig.status;
    },
    focus_stop: () => {
      rig.status = idleFocus({ unseen: focusSession({ end_reason: "cancelled" }) });
      return rig.status;
    },
    focus_extend: () => rig.status,
    focus_card_action: () => {
      rig.status = idleFocus();
      return rig.status;
    },
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
  it("opens on the start view with today's numbers", async () => {
    backend({
      history: [
        focusSession({ id: 4, kind: "timer", started_at: Date.now() - 30 * MINUTE, worked_ms: 25 * MINUTE }),
        focusSession({ id: 3, started_at: Date.now() - 2 * 86_400_000 }),
      ],
    });
    renderWithProviders(<FocusContainer />);

    const form = await screen.findByRole("form", { name: "Start a block" });
    expect(within(form).getByRole("radio", { name: "25 min" })).toBeChecked();
    expect(within(form).getByRole("button", { name: "Start timer" })).toBeInTheDocument();
    const today = screen.getByLabelText("Today");
    expect(within(today).getByText("Blocks done today").nextSibling).toHaveTextContent("1");
    expect(within(today).getByText("Focus time today").nextSibling).toHaveTextContent("25m");
  });

  it("starts a plain timer from a preset, with an optional task", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<FocusContainer />);

    const form = await screen.findByRole("form", { name: "Start a block" });
    await user.type(within(form).getByRole("textbox", { name: "Task" }), "Write report");
    await user.click(within(form).getByRole("radio", { name: "50 min" }));
    await user.click(within(form).getByRole("button", { name: "Start timer" }));

    await waitFor(() =>
      expect(sent(calls, "focus_start")).toEqual([
        {
          start: {
            kind: "timer",
            intent: "Write report",
            planned_minutes: 50,
            allowed: { activity_ids: [], app_ids: [] },
          },
        },
      ]),
    );
    const card = await screen.findByRole("region", { name: "Active timer" });
    expect(within(card).getByText("Write report")).toBeInTheDocument();
    expect(within(card).getByTestId("focus-countdown")).toHaveTextContent(/^(39|40):\d\d$/);
    expect(screen.queryByRole("form", { name: "Start a block" })).not.toBeInTheDocument();
  });

  it("turns into a focus block with drift nudges when something is allowed under Advanced", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<FocusContainer />);

    const form = await screen.findByRole("form", { name: "Start a block" });
    const advanced = within(form).getByRole("button", { name: /Advanced: drift nudges/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    await user.click(advanced);
    await user.click(within(within(form).getByRole("group", { name: "Allowed activities" })).getByRole("checkbox", { name: "Deep work" }));
    await user.click(within(within(form).getByRole("group", { name: "Allowed apps" })).getByRole("checkbox", { name: "Excel" }));
    await user.click(within(form).getByRole("radio", { name: "Custom" }));
    await user.clear(within(form).getByRole("spinbutton", { name: "Minutes" }));
    await user.type(within(form).getByRole("spinbutton", { name: "Minutes" }), "35");
    await user.click(within(form).getByRole("button", { name: "Start focus" }));

    await waitFor(() => expect(sent(calls, "focus_start")).toHaveLength(1));
    expect(sent(calls, "focus_start")[0]!.start).toEqual({
      kind: "focus",
      intent: "",
      planned_minutes: 35,
      allowed: { activity_ids: [2], app_ids: ["com.microsoft.Excel"] },
    });
  });

  it("refuses a bad custom length without calling the backend", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<FocusContainer />);

    const form = await screen.findByRole("form", { name: "Start a block" });
    await user.click(within(form).getByRole("radio", { name: "Custom" }));
    await user.clear(within(form).getByRole("spinbutton", { name: "Minutes" }));
    await user.type(within(form).getByRole("spinbutton", { name: "Minutes" }), "0");
    await user.click(within(form).getByRole("button", { name: "Start timer" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("A block lasts between 1 minute and 12 hours.");
    expect(sent(calls, "focus_start")).toEqual([]);
  });

  it("keeps timers available but explains why drift nudges are not while tracking is degraded", async () => {
    const user = userEvent.setup();
    backend({ status: idleFocus({ unavailable: "wayland_session" }) });
    renderWithProviders(<FocusContainer />);

    expect(await screen.findByText("Drift nudges are unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Window tracking is unavailable on Wayland/)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Start a block" });
    expect(within(form).getByRole("button", { name: "Start timer" })).toBeEnabled();
    await user.click(within(form).getByRole("button", { name: /Advanced/ }));
    expect(within(form).getByText(/Drift nudges need window tracking/)).toBeInTheDocument();
    expect(within(form).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows the reason when the backend refuses to start", async () => {
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

    const form = await screen.findByRole("form", { name: "Start a block" });
    await user.click(within(form).getByRole("button", { name: /Advanced/ }));
    await user.click(within(within(form).getByRole("group", { name: "Allowed activities" })).getByRole("checkbox", { name: "Deep work" }));
    await user.click(within(form).getByRole("button", { name: "Start focus" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("Focus sessions need window tracking");
  });

  it("ends the block, then shows how it went until it is dismissed", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ status: idleFocus({ active: running() }) });
    renderWithProviders(<FocusContainer />);

    const card = await screen.findByRole("region", { name: "Active timer" });
    expect(within(card).getByText(/Allowed: 1 activity and 1 app/)).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "End" }));

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

  it("draws the ring in the mode color and shows the round dots", async () => {
    backend({ status: idleFocus({ active: running({ kind: "break", intent: "" }), cycle: { enabled: true, round: 2, every: 4 } }) });
    renderWithProviders(<FocusContainer />);

    const card = await screen.findByRole("region", { name: "Active timer" });
    expect(within(card).getByText("Break")).toBeInTheDocument();
    expect(within(card).getByTestId("timer-ring-progress")).toHaveAttribute("stroke", "var(--success)");
    expect(within(card).getByRole("img", { name: "2 of 4 blocks before the long break" })).toBeInTheDocument();
    expect(within(card).queryByText(/Allowed:/)).not.toBeInTheDocument();
  });

  it("answers the end card with more time", async () => {
    const user = userEvent.setup();
    const card = {
      finished: { kind: "timer" as const, intent: "Write report", planned_ms: 25 * MINUTE, long_break: false },
      ended_at: Date.now(),
      next: { kind: "break" as const, intent: "", planned_ms: 15 * MINUTE, long_break: true },
    };
    const { calls } = backend({ status: idleFocus({ card }) });
    renderWithProviders(<FocusContainer />);

    const end = await screen.findByRole("region", { name: "Block finished" });
    expect(within(end).getByText("Take a 15-minute long break?")).toBeInTheDocument();
    await user.click(within(end).getByRole("button", { name: "+5 min" }));
    await waitFor(() => expect(sent(calls, "focus_card_action")).toEqual([{ action: { kind: "more_time", minutes: 5 } }]));
  });

  it("explains an empty summary when nothing was tracked", async () => {
    backend({ status: idleFocus({ unseen: focusSession({ percent_inside: null, inside_ms: 0, outside_ms: 0, top_distractions: [], drift_alerts: 0 }) }) });
    renderWithProviders(<FocusContainer />);

    expect(await screen.findByTestId("summary-headline")).toHaveTextContent("No tracked time during this session");
    expect(screen.queryByRole("list", { name: "Top distractions" })).not.toBeInTheDocument();
  });

  it("extends the block by five minutes", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ status: idleFocus({ active: running() }) });
    renderWithProviders(<FocusContainer />);

    await user.click(await screen.findByRole("button", { name: "+5 min" }));
    await waitFor(() => expect(sent(calls, "focus_extend")).toEqual([{ minutes: 5 }]));
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
