import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticsDto } from "@/shared/ipc";
import { mockBackend, renderWithProviders } from "@/test/ipc";

import { DiagnosticsPanelContainer } from "./DiagnosticsPanelContainer";

function diagnostics(overrides: Partial<DiagnosticsDto> = {}): DiagnosticsDto {
  return {
    accessibility_trusted: true,
    title_reads: [
      {
        app_id: "com.apple.Safari",
        ok: true,
        status: "ok via AXFocusedWindow",
        at: 1,
      },
      {
        app_id: "com.example.chat",
        ok: false,
        status: "error -25212 (kAXErrorNoValue) at AXWindows",
        at: 0,
      },
    ],
    report: "Kaiflow diagnostics\naccessibility trusted: yes\n",
    ...overrides,
  };
}

describe("DiagnosticsPanelContainer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the trust state and the last title read status per app", async () => {
    mockBackend({ diagnostics_get: () => diagnostics() });
    renderWithProviders(<DiagnosticsPanelContainer />);

    expect(
      await screen.findByText("Accessibility trusted"),
    ).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Last title read per app" });
    expect(list).toHaveTextContent("com.apple.Safari");
    expect(list).toHaveTextContent("ok via AXFocusedWindow");
    expect(list).toHaveTextContent(
      "error -25212 (kAXErrorNoValue) at AXWindows",
    );
  });

  it("hides the trust row on platforms without an Accessibility check", async () => {
    mockBackend({
      diagnostics_get: () =>
        diagnostics({ accessibility_trusted: null, title_reads: [] }),
    });
    renderWithProviders(<DiagnosticsPanelContainer />);

    expect(await screen.findByText("No reads yet.")).toBeInTheDocument();
    expect(screen.queryByText("Accessibility trusted")).toBeNull();
  });

  it("copies a fresh report to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const { calls } = mockBackend({ diagnostics_get: () => diagnostics() });
    renderWithProviders(<DiagnosticsPanelContainer />);

    await user.click(
      await screen.findByRole("button", { name: "Copy diagnostics" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "Kaiflow diagnostics\naccessibility trusted: yes\n",
      ),
    );
    expect(screen.getByText("Copied to the clipboard.")).toBeInTheDocument();
    expect(
      calls.filter((c) => c.cmd === "diagnostics_get").length,
    ).toBeGreaterThanOrEqual(2);
  });
});
