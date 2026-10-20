import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { queryKeys, type UpdateInfoDto } from "@/shared/ipc";
import { mockBackend, renderWithProviders } from "@/test/ipc";

import { UpdateBannerContainer, UpdatesPanelContainer } from "./UpdateContainers";

const UPDATE: UpdateInfoDto = {
  version: "0.2.0",
  current_version: "0.1.0",
  notes: "Faster history.",
  date: null,
};

describe("UpdateBannerContainer", () => {
  it("renders nothing while no update is announced", () => {
    mockBackend({});
    const { container } = renderWithProviders(<UpdateBannerContainer />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the announced update and installs it on request", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({ update_install: () => null });
    const { client } = renderWithProviders(<UpdateBannerContainer />);
    client.setQueryData(queryKeys.update, UPDATE);

    await user.click(await screen.findByRole("button", { name: "Install and restart" }));

    await waitFor(() => expect(calls.filter((c) => c.cmd === "update_install")).toHaveLength(1));
    expect(screen.getByText("Version 0.2.0 is available")).toBeInTheDocument();
  });

  it("shows a failed install in place and lets the user retry", async () => {
    const user = userEvent.setup();
    mockBackend({
      update_install: () => {
        throw { kind: "internal", message: "signature mismatch" };
      },
    });
    const { client } = renderWithProviders(<UpdateBannerContainer />);
    client.setQueryData(queryKeys.update, UPDATE);

    await user.click(await screen.findByRole("button", { name: "Install and restart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not install: signature mismatch");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

describe("UpdatesPanelContainer", () => {
  it("reports that the app is current after a manual check", async () => {
    const user = userEvent.setup();
    const { calls } = mockBackend({ update_check: () => null });
    renderWithProviders(<UpdatesPanelContainer />);

    await user.click(screen.getByRole("button", { name: "Check now for updates" }));

    expect(await screen.findByText("You are on the latest version.")).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === "update_check")).toHaveLength(1);
  });

  it("turns a found update into an install action with its notes", async () => {
    const user = userEvent.setup();
    mockBackend({ update_check: () => UPDATE });
    renderWithProviders(<UpdatesPanelContainer />);

    await user.click(screen.getByRole("button", { name: "Check now for updates" }));

    expect(await screen.findByRole("button", { name: "Install and restart to version 0.2.0" })).toBeInTheDocument();
    expect(screen.getByText("Faster history.")).toBeInTheDocument();
  });

  it("explains a failed check", async () => {
    const user = userEvent.setup();
    mockBackend({
      update_check: () => {
        throw { kind: "internal", message: "offline" };
      },
    });
    renderWithProviders(<UpdatesPanelContainer />);

    await user.click(screen.getByRole("button", { name: "Check now for updates" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check for updates: offline");
  });
});
