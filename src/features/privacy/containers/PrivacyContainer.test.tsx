import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PrivacyRulesDto, RetentionImpactDto, SettingsDto } from "@/shared/ipc";
import { mockBackend, renderWithProviders, report, settings, status } from "@/test/ipc";

import { PrivacyContainer } from "./PrivacyContainer";

const XCODE = { app_id: "com.apple.dt.Xcode", app_name: "Xcode", total_ms: 900_000 };
const SLACK = { app_id: "com.tinyspeck.slackmacgap", app_name: "Slack", total_ms: 600_000 };

type Call = { cmd: string; args: Record<string, unknown> };

/** In-memory backend for the privacy commands, with the real token rule: one token, one operation. */
function backend(
  initial: {
    privacy?: Partial<PrivacyRulesDto>;
    state?: "running" | "paused" | "stopped";
    impact?: RetentionImpactDto;
  } = {},
) {
  let privacy: PrivacyRulesDto = { store_titles: true, excluded_apps: [], redacted_apps: [], ...initial.privacy };
  let stored: SettingsDto = settings();
  let issued: string | null = null;
  const order: string[] = [];
  const mock = mockBackend({
    privacy_list: () => privacy,
    retention_impact: () => initial.impact ?? { segments: 3, streak_days_cut: null },
    settings_get: () => stored,
    settings_update: (args) => {
      const patch = args.patch as Record<string, unknown>;
      if (patch.retention) {
        const retention = patch.retention as { kind: "forever" } | { kind: "days"; days: number };
        stored = { ...stored, retention_days: retention.kind === "days" ? retention.days : null };
      }
      return stored;
    },
    get_status: () => status({ state: initial.state ?? "stopped" }),
    get_report: () => report({ by_app: [XCODE, SLACK] }),
    privacy_set: (args) => {
      const appId = args.appId as string;
      const mode = args.mode as "exclude" | "redact_title" | null;
      privacy = {
        ...privacy,
        excluded_apps: privacy.excluded_apps.filter((a) => a !== appId),
        redacted_apps: privacy.redacted_apps.filter((a) => a !== appId),
      };
      if (mode === "exclude") privacy.excluded_apps = [...privacy.excluded_apps, appId];
      if (mode === "redact_title") privacy.redacted_apps = [...privacy.redacted_apps, appId];
      return null;
    },
    prepare_delete: () => {
      order.push("prepare");
      issued = "token-1";
      return issued;
    },
    delete_range: (args) => {
      order.push("delete_range");
      if (args.confirmToken !== issued) throw { kind: "confirmation_required" };
      issued = null;
      return 7;
    },
    purge_older_than: (args) => {
      order.push("purge");
      if (args.confirmToken !== issued) throw { kind: "confirmation_required" };
      issued = null;
      return 3;
    },
    delete_all: (args) => {
      order.push("delete_all");
      if (args.confirmToken !== issued) throw { kind: "confirmation_required" };
      issued = null;
      return null;
    },
    stop: () => {
      order.push("stop");
      return status({ state: "stopped" });
    },
    start: () => {
      order.push("start");
      return status({ state: "running" });
    },
  });
  return { ...mock, order, expireToken: () => (issued = "something-else") };
}

const count = (calls: Call[], cmd: string) => calls.filter((c) => c.cmd === cmd).length;

describe("PrivacyContainer", () => {
  it("shows the global title switch state and links to Settings", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    backend({ privacy: { store_titles: false } });
    renderWithProviders(<PrivacyContainer onOpenSettings={onOpenSettings} />);

    expect(await screen.findByTestId("titles-state")).toHaveTextContent("off");
    await user.click(screen.getByRole("button", { name: "Change in Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  describe("per-app rules", () => {
    it("excludes an app picked from the recent ones and lists it (R10.2)", async () => {
      const user = userEvent.setup();
      const { calls } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      expect(await screen.findByText(/No apps listed/)).toBeInTheDocument();
      await user.type(screen.getByRole("combobox", { name: "App" }), "com.tinyspeck.slackmacgap");
      await user.click(screen.getByRole("button", { name: "Add app" }));

      await waitFor(() =>
        expect(calls.find((c) => c.cmd === "privacy_set")?.args).toEqual({
          appId: "com.tinyspeck.slackmacgap",
          mode: "exclude",
        }),
      );
      const list = await screen.findByRole("list", { name: "App privacy rules" });
      expect(within(list).getByText("Slack")).toBeInTheDocument();
      expect(within(list).getByRole("combobox", { name: "Privacy for Slack" })).toHaveValue("exclude");
    });

    it("offers recently seen apps as suggestions", async () => {
      backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await screen.findByRole("combobox", { name: "App" });
      await waitFor(() =>
        expect(document.querySelectorAll("datalist option").length).toBe(2),
      );
      expect([...document.querySelectorAll("datalist option")].map((o) => o.textContent)).toEqual(["Slack", "Xcode"]);
    });

    it("hides titles for an app, changes its mode and removes it (R10.3)", async () => {
      const user = userEvent.setup();
      const { calls } = backend({ privacy: { redacted_apps: [XCODE.app_id] } });
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      const mode = await screen.findByRole("combobox", { name: "Privacy for Xcode" });
      expect(mode).toHaveValue("redact_title");
      await user.selectOptions(mode, "Never record");
      await waitFor(() =>
        expect(calls.filter((c) => c.cmd === "privacy_set").at(-1)?.args).toEqual({ appId: XCODE.app_id, mode: "exclude" }),
      );
      await waitFor(() => expect(screen.getByRole("combobox", { name: "Privacy for Xcode" })).toHaveValue("exclude"));

      await user.click(screen.getByRole("button", { name: "Remove Xcode" }));
      await waitFor(() =>
        expect(calls.filter((c) => c.cmd === "privacy_set").at(-1)?.args).toEqual({ appId: XCODE.app_id, mode: null }),
      );
      expect(await screen.findByText(/No apps listed/)).toBeInTheDocument();
    });

    it("chooses Hide titles for a new app and explains the difference", async () => {
      const user = userEvent.setup();
      const { calls } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await user.click(await screen.findByRole("radio", { name: "Hide titles" }));
      expect(screen.getByText(/window title is never stored/)).toBeInTheDocument();
      await user.type(screen.getByRole("combobox", { name: "App" }), "com.example.Notes");
      await user.click(screen.getByRole("button", { name: "Add app" }));

      await waitFor(() => expect(calls.find((c) => c.cmd === "privacy_set")?.args.mode).toBe("redact_title"));
    });

    it("validates the bundle id before calling the backend", async () => {
      const user = userEvent.setup();
      const { calls } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await user.click(await screen.findByRole("button", { name: "Add app" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Pick an app or type its bundle id.");
      await user.type(screen.getByRole("combobox", { name: "App" }), "Slack");
      await user.click(screen.getByRole("button", { name: "Add app" }));
      expect(screen.getByRole("alert")).toHaveTextContent("looks like com.example.App");
      expect(screen.getByRole("combobox", { name: "App" })).toHaveAttribute("aria-invalid", "true");
      expect(count(calls, "privacy_set")).toBe(0);
    });
  });

  describe("deleting data (two-step confirmation, R10.4)", () => {
    it("deletes a date range: prepare, read the consequences, then confirm with the token", async () => {
      const user = userEvent.setup();
      const { calls, order } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await screen.findByRole("button", { name: "Delete range…" });
      fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-05" } });
      await user.click(screen.getByRole("button", { name: "Delete range…" }));

      const dialog = await screen.findByRole("alertdialog", { name: "Delete this date range?" });
      const expected = { from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 9, 6).getTime() };
      expect(calls.find((c) => c.cmd === "prepare_delete")?.args).toEqual({ op: { kind: "range", range: expected } });
      expect(dialog).toHaveTextContent("permanently deleted");
      expect(dialog).toHaveTextContent("cannot be undone");
      expect(count(calls, "delete_range")).toBe(0);

      await user.click(within(dialog).getByRole("button", { name: "Delete range" }));

      await waitFor(() =>
        expect(calls.find((c) => c.cmd === "delete_range")?.args).toEqual({ range: expected, confirmToken: "token-1" }),
      );
      expect(await screen.findByText("Deleted 7 segments.")).toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(order).toEqual(["prepare", "delete_range"]);
    });

    it("cancelling never deletes anything, and Escape cancels too", async () => {
      const user = userEvent.setup();
      const { calls } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await user.click(await screen.findByRole("button", { name: "Delete all data…" }));
      const dialog = await screen.findByRole("alertdialog");
      // Focus starts on Cancel so a stray Enter cannot confirm.
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Delete all data…" }));
      await screen.findByRole("alertdialog");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

      expect(count(calls, "delete_all")).toBe(0);
      expect(count(calls, "delete_range")).toBe(0);
      expect(screen.queryByText(/was deleted|Deleted \d+ /)).not.toBeInTheDocument();
    });

    it("rejects a reversed range without asking the backend", async () => {
      const user = userEvent.setup();
      const { calls } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await screen.findByRole("button", { name: "Delete range…" });
      fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-05" } });
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
      await user.click(screen.getByRole("button", { name: "Delete range…" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("not after the end date");
      expect(count(calls, "prepare_delete")).toBe(0);
    });

    it("deletes data older than N days", async () => {
      const user = userEvent.setup();
      const { calls } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      const days = await screen.findByRole("spinbutton", { name: "Older than (days)" });
      await user.clear(days);
      await user.type(days, "45");
      await user.click(screen.getByRole("button", { name: "Delete older data…" }));

      const dialog = await screen.findByRole("alertdialog", { name: "Delete everything older than 45 days?" });
      expect(calls.find((c) => c.cmd === "prepare_delete")?.args).toEqual({ op: { kind: "older_than_days", days: 45 } });
      await user.click(within(dialog).getByRole("button", { name: "Delete older data" }));

      await waitFor(() =>
        expect(calls.find((c) => c.cmd === "purge_older_than")?.args).toEqual({ days: 45, confirmToken: "token-1" }),
      );
      expect(await screen.findByText("Deleted 3 segments.")).toBeInTheDocument();
    });

    it("tells how much a purge removes before the user confirms", async () => {
      const user = userEvent.setup();
      const { calls } = backend({ impact: { segments: 120, streak_days_cut: null } });
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await user.click(await screen.findByRole("button", { name: "Delete older data…" }));

      const dialog = await screen.findByRole("alertdialog");
      expect(await within(dialog).findByText("This would delete 120 segments.")).toBeInTheDocument();
      expect(within(dialog).queryByText(/streak/)).not.toBeInTheDocument();
      expect(calls.find((c) => c.cmd === "retention_impact")?.args).toEqual({ days: 30 });
    });

    it("warns when the purge would cut into an active streak", async () => {
      const user = userEvent.setup();
      backend({ impact: { segments: 40, streak_days_cut: 10 } });
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await user.click(await screen.findByRole("button", { name: "Delete older data…" }));

      const dialog = await screen.findByRole("alertdialog");
      expect(await within(dialog).findByText(/would cut 10 days of it/)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Delete older data" })).toBeEnabled();
    });

    it("refuses 0 or empty days", async () => {
      const user = userEvent.setup();
      const { calls } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      const days = await screen.findByRole("spinbutton", { name: "Older than (days)" });
      await user.clear(days);
      await user.type(days, "0");
      await user.click(screen.getByRole("button", { name: "Delete older data…" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("whole number of days");
      expect(days).toHaveAttribute("aria-invalid", "true");
      expect(count(calls, "prepare_delete")).toBe(0);
    });

    it("deletes everything with tracking stopped, then resumes tracking if it was running", async () => {
      const user = userEvent.setup();
      const { calls, order } = backend({ state: "running" });
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await waitFor(() => expect(count(calls, "get_status")).toBeGreaterThan(0));
      await user.click(await screen.findByRole("button", { name: "Delete all data…" }));
      const dialog = await screen.findByRole("alertdialog", { name: "Delete all tracked data?" });
      expect(dialog).toHaveTextContent("Tracking pauses for a moment");
      await user.click(within(dialog).getByRole("button", { name: "Delete everything" }));

      expect(await screen.findByText("All tracked data was deleted.")).toBeInTheDocument();
      expect(order).toEqual(["prepare", "stop", "delete_all", "start"]);
    });

    it("does not touch tracking when it is not running", async () => {
      const user = userEvent.setup();
      const { order } = backend({ state: "paused" });
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await user.click(await screen.findByRole("button", { name: "Delete all data…" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).not.toHaveTextContent("Tracking pauses");
      await user.click(within(dialog).getByRole("button", { name: "Delete everything" }));

      await screen.findByText("All tracked data was deleted.");
      expect(order).toEqual(["prepare", "delete_all"]);
    });

    it("keeps the dialog open with a clear message when the confirmation expired", async () => {
      const user = userEvent.setup();
      const { expireToken, calls } = backend();
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await user.click(await screen.findByRole("button", { name: "Delete all data…" }));
      const dialog = await screen.findByRole("alertdialog");
      expireToken();
      await user.click(within(dialog).getByRole("button", { name: "Delete everything" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("confirmation expired");
      expect(count(calls, "delete_all")).toBe(1);
      expect(screen.queryByText("All tracked data was deleted.")).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("shows a failure to prepare and never opens the dialog", async () => {
      const user = userEvent.setup();
      mockBackend({
        privacy_list: () => ({ store_titles: true, excluded_apps: [], redacted_apps: [] }),
        get_status: () => status({ state: "stopped" }),
        get_report: () => report(),
        prepare_delete: () => {
          throw { kind: "internal", message: "engine unavailable" };
        },
      });
      renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

      await user.click(await screen.findByRole("button", { name: "Delete all data…" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("engine unavailable");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("changes the automatic cleanup and shows the stored value", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<PrivacyContainer onOpenSettings={() => {}} />);

    const select = await screen.findByRole("combobox", { name: "Keep data for" });
    expect(select).toHaveValue("forever");
    await user.selectOptions(select, "90 days");

    await waitFor(() =>
      expect(calls.find((c) => c.cmd === "settings_update")?.args.patch).toMatchObject({
        retention: { kind: "days", days: 90 },
        theme: null,
      }),
    );
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Keep data for" })).toHaveValue("90"));
  });
});
