import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AiReviewDto, AiSettingsDto, ReviewPreviewDto, WeeklyReviewDto } from "@/shared/ipc";
import { aiReview, aiSettings, dashboard, focusSession, goal, mockBackend, renderWithProviders, review, settings } from "@/test/ipc";

import { ReviewContainer } from "./ReviewContainer";

const PREVIEW: ReviewPreviewDto = {
  id: "preview-1",
  provider: "anthropic",
  model: "claude-haiku-5-5",
  period_label: "2026-10-12 to 2026-10-18",
  included_titles: false,
  title_count: 0,
  system: "You help a person reflect. Do not assume the user's profession.",
  user: 'Here is the week to review.\n<data>\n{"totals":{"tracked_minutes":180}}\n</data>',
  bytes: 120,
  local: false,
};

interface Rig {
  week: WeeklyReviewDto;
  ai: AiSettingsDto;
  stored: AiReviewDto[];
}

function backend(initial: Partial<Rig> = {}, extra: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const rig: Rig = { week: review(), ai: aiSettings(), stored: [], ...initial };
  let token: string | null = null;
  const calls = mockBackend({
    settings_get: () => settings(),
    review_get: () => ({ ...rig.week, reviews: rig.stored }),
    ai_settings_get: () => rig.ai,
    ai_reviews_list: () => rig.stored,
    review_note_set: () => null,
    review_preview: () => PREVIEW,
    review_run: () => {
      const saved = aiReview({ id: rig.stored.length + 1 });
      rig.stored = [saved, ...rig.stored];
      return saved;
    },
    review_cancel: () => null,
    ai_reviews_delete: (args) => {
      rig.stored = rig.stored.filter((r) => r.id !== args.id);
      return null;
    },
    ai_reviews_prepare_delete_all: () => (token = "delete-token"),
    ai_reviews_delete_all: (args) => {
      if (args.token !== token) throw { kind: "confirmation_required" };
      const n = rig.stored.length;
      rig.stored = [];
      return n;
    },
    ...extra,
  });
  return { ...calls, rig };
}

const sent = (calls: { cmd: string; args: Record<string, unknown> }[], cmd: string) => calls.filter((c) => c.cmd === cmd);

function renderReview() {
  const onOpenGoals = vi.fn();
  const onOpenSettings = vi.fn();
  renderWithProviders(<ReviewContainer onOpenGoals={onOpenGoals} onOpenSettings={onOpenSettings} />);
  return { onOpenGoals, onOpenSettings };
}

describe("ReviewContainer without AI", () => {
  it("builds the week locally and never touches an AI command", async () => {
    const { calls } = backend({
      week: review({
        goals: [
          {
            goal: goal({ label: "Write daily", period: "daily", target_ms: 3_600_000 }),
            periods: [
              { start_day: 20_738, actual_ms: 2 * 3_600_000, result: "met" },
              { start_day: 20_739, actual_ms: 600_000, result: "missed" },
            ],
            met: 1,
            missed: 1,
            current_streak: 0,
            best_streak: 3,
          },
        ],
        focus: [focusSession()],
      }),
    });
    renderReview();

    expect(await screen.findByTestId("review-total")).toHaveTextContent("3h 00m");
    expect(screen.getByTestId("review-week")).toHaveTextContent("2026-10-12 to 2026-10-18");
    expect(screen.getByTestId("review-heading")).toHaveTextContent("This week");
    expect(screen.getByRole("list", { name: "Time by activity" })).toHaveTextContent("Deep work");
    expect(screen.getByRole("list", { name: "Goals this week" })).toHaveTextContent("Met on 1 of 2 active days.");
    expect(screen.getByTestId("review-focus")).toHaveTextContent("1 session (1 completed)");
    expect(screen.getByRole("heading", { name: "Busiest hours" })).toBeInTheDocument();

    // AI is off: the card explains it and offers Settings; nothing was sent or listed.
    expect(await screen.findByText(/nothing is sent anywhere until you switch a provider on/i)).toBeInTheDocument();
    const cmds = calls.map((c) => c.cmd);
    expect(cmds).not.toContain("review_preview");
    expect(cmds).not.toContain("review_run");
    expect(cmds).not.toContain("ai_models_list");
    expect(cmds).not.toContain("ai_test");
  });

  it("shows the empty state for a week without data and still allows a note", async () => {
    backend({ week: review({ dashboard: dashboard(), goals: [], focus: [] }) });
    renderReview();

    expect(await screen.findByText("Nothing tracked this week yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Your note about this week")).toBeInTheDocument();
  });

  it("saves the personal note of the week on request", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderReview();

    const note = await screen.findByLabelText("Your note about this week");
    const save = screen.getByRole("button", { name: "Save note" });
    expect(save).toBeDisabled();
    await user.type(note, "Felt rushed on Tuesday");
    expect(screen.getByText("Not saved yet.")).toBeInTheDocument();
    await user.click(save);

    await waitFor(() => expect(sent(calls, "review_note_set")).toHaveLength(1));
    expect(sent(calls, "review_note_set")[0]?.args).toEqual({ firstDay: 20_738, note: "Felt rushed on Tuesday" });
  });

  it("navigates to earlier weeks one call per week, never past the current one", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderReview();

    expect(await screen.findByTestId("review-total")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(screen.getByTestId("review-heading")).toHaveTextContent("Last week"));
    expect(sent(calls, "review_get").map((c) => c.args.weeksAgo)).toEqual([0, 1]);
    await user.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(screen.getByTestId("review-heading")).toHaveTextContent("This week"));
  });

  it("sends the user to Goals and to Settings from the empty spots", async () => {
    const user = userEvent.setup();
    backend();
    const { onOpenGoals, onOpenSettings } = renderReview();

    await user.click(await screen.findByRole("button", { name: "Create a goal" }));
    expect(onOpenGoals).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Set up AI in Settings/ }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe("ReviewContainer with AI switched on", () => {
  const on = () => aiSettings({}, { enabled: true, consented_at: 1, has_key: true });

  it("previews the exact request first and sends only after confirmation", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ ai: on() });
    renderReview();

    await user.click(await screen.findByRole("button", { name: /Preview what will be sent/ }));
    const preview = await screen.findByTestId("request-preview");
    expect(within(preview).getByTestId("preview-data")).toHaveTextContent('"tracked_minutes":180');
    expect(within(preview).getByTestId("preview-destination")).toHaveTextContent("Sent over the internet to Anthropic (Claude)");
    expect(within(preview).getByTestId("preview-destination")).toHaveTextContent("Window titles are not included.");
    expect(sent(calls, "review_run")).toHaveLength(0);
    expect(sent(calls, "review_preview")[0]?.args).toEqual({ weeksAgo: 0, includeTitles: false, language: "English" });

    await user.click(within(preview).getByRole("button", { name: "Send for analysis" }));
    expect(await screen.findByTestId("review-summary")).toHaveTextContent("A steady week.");
    expect(sent(calls, "review_run")[0]?.args).toEqual({ previewId: "preview-1" });
    expect(screen.queryByTestId("request-preview")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Wins" })).toHaveTextContent("Focused mornings");
    expect(screen.getByRole("region", { name: "Why goals were missed" })).toHaveTextContent("Tuesday was full of meetings");
  });

  it("asks for window titles only when switched on, and the preview says so", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ ai: on() }, {
      review_preview: (args) => ({
        ...PREVIEW,
        included_titles: Boolean(args.includeTitles),
        title_count: args.includeTitles ? 12 : 0,
      }),
    });
    renderReview();

    await user.click(await screen.findByRole("switch", { name: "Include window titles" }));
    await user.click(screen.getByRole("button", { name: /Preview what will be sent/ }));

    expect(await screen.findByTestId("preview-destination")).toHaveTextContent("Includes 12 window titles");
    expect(sent(calls, "review_preview")[0]?.args.includeTitles).toBe(true);
  });

  it("cancelling the preview sends nothing", async () => {
    const user = userEvent.setup();
    const { calls } = backend({ ai: on() });
    renderReview();

    await user.click(await screen.findByRole("button", { name: /Preview what will be sent/ }));
    await user.click(within(await screen.findByTestId("request-preview")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByTestId("request-preview")).not.toBeInTheDocument();
    expect(sent(calls, "review_run")).toHaveLength(0);
  });

  it("shows a clear message when the provider cannot be reached and keeps nothing", async () => {
    const user = userEvent.setup();
    backend({ ai: on() }, {
      review_run: () => {
        throw { kind: "ai", reason: "offline", message: "Could not reach the provider. Check your internet connection and try again." };
      },
    });
    renderReview();

    await user.click(await screen.findByRole("button", { name: /Preview what will be sent/ }));
    await user.click(within(await screen.findByTestId("request-preview")).getByRole("button", { name: "Send for analysis" }));

    expect(await screen.findByTestId("ai-error")).toHaveTextContent("internet connection");
    expect(screen.queryByTestId("request-preview")).not.toBeInTheDocument();
    expect(screen.getByText("No analysis of this week yet.")).toBeInTheDocument();
  });

  it("explains a missing key instead of offering to run", async () => {
    const user = userEvent.setup();
    const { onOpenSettings } = (() => {
      backend({ ai: aiSettings({}, { enabled: true, consented_at: 1, has_key: false }) });
      return renderReview();
    })();

    expect(await screen.findByText(/No API key is saved for Anthropic/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview what will be sent/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add one in Settings" }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("deletes one analysis and, after a confirmation with the token, all of them", async () => {
    const user = userEvent.setup();
    const { calls } = backend({
      ai: on(),
      stored: [aiReview({ id: 2 }), aiReview({ id: 1, period_label: "2026-10-05 to 2026-10-11" })],
    });
    renderReview();

    const list = await screen.findByRole("list", { name: "Saved analyses" });
    expect(within(list).getAllByRole("button", { name: /Delete analysis of/ })).toHaveLength(2);
    await user.click(within(list).getByRole("button", { name: "Delete analysis of 2026-10-05 to 2026-10-11" }));
    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: "Saved analyses" })).getAllByRole("button", { name: /Delete analysis of/ })).toHaveLength(1),
    );
    expect(sent(calls, "ai_reviews_delete")[0]?.args).toEqual({ id: 1 });

    await user.click(screen.getByRole("button", { name: "Delete all" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete all saved analyses?" });
    expect(sent(calls, "ai_reviews_delete_all")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Delete all" }));

    await waitFor(() => expect(sent(calls, "ai_reviews_delete_all")).toHaveLength(1));
    expect(sent(calls, "ai_reviews_delete_all")[0]?.args).toEqual({ token: "delete-token" });
    await waitFor(() => expect(screen.queryByRole("list", { name: "Saved analyses" })).not.toBeInTheDocument());
  });

  it("shows a plain-text answer as it came when the model ignored the format", async () => {
    backend({
      ai: on(),
      stored: [aiReview({ status: "text_fallback", output: null, text: "You spent most of the week writing." })],
    });
    renderReview();

    expect(await screen.findByText("You spent most of the week writing.")).toBeInTheDocument();
    expect(screen.getByText(/did not follow the requested format/)).toBeInTheDocument();
  });
});
