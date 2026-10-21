import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { BackupStatusDto, RestorePreviewDto } from "@/shared/ipc";
import { backupStatus, FIXED_NOW, mockBackend, renderWithProviders } from "@/test/ipc";

import { DataPanelContainer } from "./DataPanelContainer";

const PREVIEW: RestorePreviewDto = {
  token: "restore-token-1",
  file_name: "kaiflow-backup-2026-10-19.json.gz",
  kind: "backup",
  app_version: "0.1.0",
  exported_at: "2026-10-19T08:00:00Z",
  activities: 4,
  rules: 2,
  segments: 321,
  idle_gaps: 5,
  first_at: Date.UTC(2026, 8, 1, 12),
  last_at: Date.UTC(2026, 9, 19, 12),
};

/** In-memory backup commands with the real two-step restore rule: one token, one apply. */
function backend(initial: Partial<BackupStatusDto> = {}, extra: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  let status = backupStatus(initial);
  let issued: string | null = null;
  const mock = mockBackend({
    backup_status: () => status,
    backup_set_enabled: (args) => (status = { ...status, enabled: Boolean(args.enabled) }),
    backup_choose_dir: () => (status = { ...status, custom_dir: "/Volumes/Safe", dir: "/Volumes/Safe" }),
    backup_reset_dir: () => (status = { ...status, custom_dir: null, dir: "/data/backups" }),
    backup_now: () => {
      status = { ...status, last_backup_at: FIXED_NOW, stored: status.stored + 1 };
      return { path: "/data/backups/kaiflow-backup-2026-10-20.json.gz", removed: 0 };
    },
    restore_prepare: () => {
      issued = PREVIEW.token;
      return PREVIEW;
    },
    restore_apply: (args) => {
      if (args.token !== issued) throw { kind: "confirmation_required" };
      issued = null;
      return { safety_copy: "/data/kaiflow.db.pre-restore-1" };
    },
    ...extra,
  });
  return { ...mock, expireToken: () => (issued = "something-else") };
}

describe("DataPanelContainer", () => {
  it("shows the backup state and the folder in use", async () => {
    backend({ last_backup_at: null, stored: 2, dir: "/data/backups" });
    renderWithProviders(<DataPanelContainer />);

    expect(await screen.findByRole("switch", { name: "Daily backup" })).toBeChecked();
    expect(screen.getByTestId("backup-folder")).toHaveTextContent("/data/backups");
    expect(screen.getByTestId("last-backup")).toHaveTextContent("Never");
    expect(screen.getByText("2 backups stored in the folder.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use default" })).not.toBeInTheDocument();
  });

  it("switches the daily backup off", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<DataPanelContainer />);

    await user.click(await screen.findByRole("switch", { name: "Daily backup" }));

    await waitFor(() => expect(calls.find((c) => c.cmd === "backup_set_enabled")?.args).toEqual({ enabled: false }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Daily backup" })).not.toBeChecked());
  });

  it("picks a folder and goes back to the default one", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<DataPanelContainer />);

    await user.click(await screen.findByRole("button", { name: "Choose folder…" }));
    await waitFor(() => expect(screen.getByTestId("backup-folder")).toHaveTextContent("/Volumes/Safe"));

    await user.click(screen.getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(screen.getByTestId("backup-folder")).toHaveTextContent("/data/backups"));
  });

  it("backs up now and says where the file went", async () => {
    const user = userEvent.setup();
    backend();
    renderWithProviders(<DataPanelContainer />);

    await user.click(await screen.findByRole("button", { name: "Back up now" }));

    expect(await screen.findByText(/Backup saved to \/data\/backups\/kaiflow-backup-2026-10-20/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("last-backup")).not.toHaveTextContent("Never"));
  });

  it("shows a failed backup with a way out, and a failing Back up now", async () => {
    const user = userEvent.setup();
    backend(
      { last_error: "could not write the backup to /locked: permission denied" },
      {
        backup_now: () => {
          throw { kind: "storage", message: "permission denied" };
        },
      },
    );
    renderWithProviders(<DataPanelContainer />);

    expect(await screen.findByText(/The last backup failed: could not write the backup to \/locked/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back up now" }));
    expect(await screen.findByText(/The backup failed: .*permission denied/)).toBeInTheDocument();
  });

  it("restores only after previewing the file and confirming", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<DataPanelContainer />);

    await user.click(await screen.findByRole("button", { name: "Restore from file…" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Restore this file?" });
    expect(within(dialog).getByText(/kaiflow-backup-2026-10-19.json.gz holds 321 tracked segments, 4 activities, 2 rules/)).toBeInTheDocument();
    expect(within(dialog).getByText(/replaces everything stored now/)).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "restore_apply")).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Restore and replace" }));

    await waitFor(() => expect(calls.find((c) => c.cmd === "restore_apply")?.args).toEqual({ token: "restore-token-1" }));
    expect(await screen.findByText(/Restored\. A safety copy .* \/data\/kaiflow\.db\.pre-restore-1/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancelling the preview restores nothing", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<DataPanelContainer />);

    await user.click(await screen.findByRole("button", { name: "Restore from file…" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(calls.some((c) => c.cmd === "restore_apply")).toBe(false);
  });

  it("does nothing when the file picker is cancelled", async () => {
    const user = userEvent.setup();
    const { calls } = backend({}, { restore_prepare: () => null });
    renderWithProviders(<DataPanelContainer />);

    await user.click(await screen.findByRole("button", { name: "Restore from file…" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "restore_prepare")).toBe(true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with a clear message when the confirmation expired", async () => {
    const user = userEvent.setup();
    const rig = backend();
    renderWithProviders(<DataPanelContainer />);

    await user.click(await screen.findByRole("button", { name: "Restore from file…" }));
    const dialog = await screen.findByRole("alertdialog");
    rig.expireToken();
    await user.click(within(dialog).getByRole("button", { name: "Restore and replace" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The confirmation expired");
  });

  it("explains an invalid file instead of opening the dialog", async () => {
    const user = userEvent.setup();
    backend(
      {},
      {
        restore_prepare: () => {
          throw { kind: "invalid", message: "the file uses format version 9, which this app version cannot read" };
        },
      },
    );
    renderWithProviders(<DataPanelContainer />);

    await user.click(await screen.findByRole("button", { name: "Restore from file…" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("format version 9");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
