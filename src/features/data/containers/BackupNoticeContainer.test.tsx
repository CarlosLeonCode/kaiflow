import { emit } from "@tauri-apps/api/event";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockBackend, renderWithProviders } from "@/test/ipc";

import { BackupNoticeContainer } from "./BackupNoticeContainer";

describe("BackupNoticeContainer", () => {
  it("shows nothing until a backup fails, then a dismissible notice", async () => {
    const user = userEvent.setup();
    mockBackend({});
    renderWithProviders(<BackupNoticeContainer />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      await emit("backup-finished", { ok: false, message: "permission denied" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("The automatic backup failed: permission denied");

    await user.click(screen.getByRole("button", { name: "Dismiss backup notice" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the notice when a later backup succeeds", async () => {
    mockBackend({});
    renderWithProviders(<BackupNoticeContainer />);

    await act(async () => {
      await emit("backup-finished", { ok: false, message: "disk full" });
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await act(async () => {
      await emit("backup-finished", { ok: true, message: "/data/backups/x.json.gz" });
    });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
