import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { IdleGapDto } from "@/shared/ipc";
import { focus, mockBackend, renderWithProviders } from "@/test/ipc";

import { IdlePromptContainer } from "./IdlePromptContainer";

const gap = (overrides: Partial<IdleGapDto> = {}): IdleGapDto => ({
  id: 7,
  started_at: Date.UTC(2026, 9, 20, 10, 0),
  ended_at: Date.UTC(2026, 9, 20, 10, 20),
  prev_focus: focus(),
  expires_at: Date.UTC(2026, 9, 20, 10, 30),
  ...overrides,
});

const categories = [
  { id: 1, name: "Work", color: "#3b82f6", sort_order: 0 },
  { id: 2, name: "Meetings", color: "#f59e0b", sort_order: 1 },
];

function setup(gaps: IdleGapDto[], extra: Parameters<typeof mockBackend>[0] = {}) {
  let pending = gaps;
  return mockBackend({
    list_pending_idle_gaps: () => pending,
    categories_list: () => categories,
    resolve_idle_gap: () => {
      pending = [];
      return null;
    },
    ...extra,
  });
}

describe("IdlePromptContainer", () => {
  it("renders nothing without pending gaps", async () => {
    const { calls } = setup([]);
    const { container } = renderWithProviders(<IdlePromptContainer />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "list_pending_idle_gaps")).toBe(true));
    expect(container.querySelector("section")).toBeNull();
  });

  it("describes the gap: duration and last app", async () => {
    setup([gap()]);
    renderWithProviders(<IdlePromptContainer />);

    expect(await screen.findByRole("heading", { name: /You were away for 20m/ })).toBeInTheDocument();
    expect(screen.getByText("Xcode")).toBeInTheDocument();
  });

  it("discards through resolve_idle_gap and removes the card", async () => {
    const user = userEvent.setup();
    const { calls } = setup([gap()]);
    renderWithProviders(<IdlePromptContainer />);

    await user.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard" })).toBeNull());
    const call = calls.find((c) => c.cmd === "resolve_idle_gap");
    expect(call?.args).toEqual({ id: 7, resolution: { kind: "discard" } });
  });

  it("assigns the time to the previous app", async () => {
    const user = userEvent.setup();
    const { calls } = setup([gap()]);
    renderWithProviders(<IdlePromptContainer />);

    await user.click(await screen.findByRole("button", { name: "Assign to previous app" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "resolve_idle_gap")).toBe(true));
    expect(calls.find((c) => c.cmd === "resolve_idle_gap")?.args).toEqual({
      id: 7,
      resolution: { kind: "assign_previous" },
    });
  });

  it("assigns the time to a chosen category and can go back", async () => {
    const user = userEvent.setup();
    const { calls } = setup([gap()]);
    renderWithProviders(<IdlePromptContainer />);

    await user.click(await screen.findByRole("button", { name: /Assign to category/ }));
    await user.click(screen.getByRole("button", { name: "Back to idle options" }));
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Assign to category/ }));
    await user.click(await screen.findByRole("button", { name: "Meetings" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "resolve_idle_gap")).toBe(true));
    expect(calls.find((c) => c.cmd === "resolve_idle_gap")?.args).toEqual({
      id: 7,
      resolution: { kind: "assign_category", category_id: 2 },
    });
  });

  it("hides the previous-app option when there was no previous focus", async () => {
    setup([gap({ prev_focus: null })]);
    renderWithProviders(<IdlePromptContainer />);

    await screen.findByRole("button", { name: "Discard" });
    expect(screen.queryByRole("button", { name: "Assign to previous app" })).toBeNull();
  });

  it("shows the oldest gap first and mentions the others", async () => {
    setup([gap({ id: 9, started_at: Date.UTC(2026, 9, 20, 11, 0), ended_at: Date.UTC(2026, 9, 20, 11, 5) }), gap()]);
    renderWithProviders(<IdlePromptContainer />);

    expect(await screen.findByRole("heading", { name: /20m/ })).toBeInTheDocument();
    expect(screen.getByText(/1 more waiting/)).toBeInTheDocument();
  });

  it("shows the backend error and keeps the card when resolving fails", async () => {
    const user = userEvent.setup();
    setup([gap()], {
      resolve_idle_gap: () => {
        throw { kind: "not_found" };
      },
    });
    renderWithProviders(<IdlePromptContainer />);

    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  });
});
