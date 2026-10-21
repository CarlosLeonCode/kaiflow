import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { AiSettingsDto, AiSettingsPatchDto } from "@/shared/ipc";
import { aiSettings, mockBackend, renderWithProviders } from "@/test/ipc";

import { AiSettingsPanelContainer } from "./AiSettingsPanelContainer";

function backend(initial: AiSettingsDto = aiSettings(), extra: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  let state = initial;
  const calls = mockBackend({
    ai_settings_get: () => state,
    ai_settings_update: (args) => {
      const patch = args.patch as AiSettingsPatchDto;
      state = {
        ...state,
        selected: patch.selected ?? state.selected,
        include_titles: patch.include_titles ?? state.include_titles,
        monday_review: patch.monday_review ?? state.monday_review,
        providers: state.providers.map((p) =>
          patch.provider && p.provider === patch.provider.provider
            ? {
                ...p,
                enabled: patch.provider.enabled ?? p.enabled,
                consented_at: patch.provider.enabled === true ? 1 : patch.provider.enabled === false ? null : p.consented_at,
                model: patch.provider.model ?? p.model,
              }
            : p,
        ),
      };
      return state;
    },
    ai_set_key: (args) => {
      state = { ...state, providers: state.providers.map((p) => (p.provider === args.provider ? { ...p, has_key: true } : p)) };
      return state;
    },
    ai_delete_key: (args) => {
      state = { ...state, providers: state.providers.map((p) => (p.provider === args.provider ? { ...p, has_key: false, enabled: false } : p)) };
      return state;
    },
    ...extra,
  });
  return calls;
}

const sent = (calls: { cmd: string; args: Record<string, unknown> }[], cmd: string) => calls.filter((c) => c.cmd === cmd);

describe("AiSettingsPanelContainer", () => {
  it("opens without contacting any provider or reading keys", async () => {
    const { calls } = backend();
    renderWithProviders(<AiSettingsPanelContainer />);

    expect(await screen.findByRole("combobox", { name: "Provider" })).toHaveValue("anthropic");
    expect(screen.getByRole("switch", { name: "Use Anthropic (Claude)" })).not.toBeChecked();
    expect(screen.getByText(/Off by default/)).toBeInTheDocument();
    expect(calls.map((c) => c.cmd).filter((cmd) => cmd.startsWith("ai_") || cmd.startsWith("review_"))).toEqual(["ai_settings_get"]);
  });

  it("switching a provider on is an explicit act and is sent as such", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<AiSettingsPanelContainer />);

    await user.click(await screen.findByRole("switch", { name: "Use Anthropic (Claude)" }));

    await waitFor(() => expect(screen.getByRole("switch", { name: "Use Anthropic (Claude)" })).toBeChecked());
    expect(sent(calls, "ai_settings_update")[0]?.args.patch).toEqual({
      selected: null,
      include_titles: null,
      monday_review: null,
      provider: { provider: "anthropic", enabled: true, model: null, base_url: null },
    });
  });

  it("saves a key through ai_set_key, clears the field and never shows it back", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<AiSettingsPanelContainer />);

    const field = await screen.findByPlaceholderText("Paste API key");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "sk-ant-secret-123");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByRole("button", { name: "Remove key" })).toBeInTheDocument();
    expect(sent(calls, "ai_set_key")[0]?.args).toEqual({ provider: "anthropic", key: "sk-ant-secret-123" });
    expect(screen.queryByDisplayValue("sk-ant-secret-123")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sk-ant-secret-123");
    expect(screen.getByText(/Saved in your system keychain/)).toBeInTheDocument();
  });

  it("refuses keys with a clear explanation when the OS has no secure store", async () => {
    backend(aiSettings({ secret_store: { available: false, reason: "no Secret Service is running" } }));
    renderWithProviders(<AiSettingsPanelContainer />);

    expect(await screen.findByTestId("ai-keychain-unavailable")).toHaveTextContent("never stored in plain text");
    expect(screen.queryByPlaceholderText("Paste API key")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Use Anthropic (Claude)" })).toBeDisabled();
  });

  it("Ollama needs no key, only accepts local addresses and lists installed models on request", async () => {
    const user = userEvent.setup();
    const { calls } = backend(aiSettings({ selected: "ollama" }, { enabled: true, consented_at: 1 }), {
      ai_models_list: () => ["llama3.2:latest", "qwen3:8b"],
    });
    renderWithProviders(<AiSettingsPanelContainer />);

    expect(await screen.findByLabelText("Ollama address")).toHaveValue("http://localhost:11434");
    expect(screen.queryByPlaceholderText("Paste API key")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh list" }));

    expect(await screen.findByTestId("ai-notice")).toHaveTextContent("2 models available.");
    // No model was chosen yet: the first installed one is picked so a run can start.
    await waitFor(() =>
      expect(sent(calls, "ai_settings_update").some((c) => (c.args.patch as AiSettingsPatchDto).provider?.model === "llama3.2:latest")).toBe(true),
    );
  });

  it("shows a refused remote address as an error", async () => {
    const user = userEvent.setup();
    backend(aiSettings({ selected: "ollama" }), {
      ai_settings_update: () => {
        throw { kind: "ai", reason: "remote_host_rejected", message: "Ollama must run on this computer: only localhost addresses are allowed." };
      },
    });
    renderWithProviders(<AiSettingsPanelContainer />);

    const address = await screen.findByLabelText("Ollama address");
    await user.clear(address);
    await user.type(address, "https://example.com");
    await user.tab();

    expect(await screen.findByTestId("ai-settings-error")).toHaveTextContent("only localhost addresses are allowed");
  });

  it("tests the connection on demand", async () => {
    const user = userEvent.setup();
    const { calls } = backend(aiSettings({}, { enabled: true, consented_at: 1, has_key: true }), { ai_test: () => 5 });
    renderWithProviders(<AiSettingsPanelContainer />);

    await user.click(await screen.findByRole("button", { name: "Test connection" }));

    expect(await screen.findByTestId("ai-notice")).toHaveTextContent("Connected. The provider lists 5 models.");
    expect(sent(calls, "ai_test")[0]?.args).toEqual({ provider: "anthropic" });
  });

  it("toggles the defaults for titles and the Monday review", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<AiSettingsPanelContainer />);

    await user.click(await screen.findByRole("switch", { name: "Include window titles by default" }));
    await user.click(screen.getByRole("switch", { name: "Monday review" }));

    await waitFor(() => expect(sent(calls, "ai_settings_update")).toHaveLength(2));
    expect(sent(calls, "ai_settings_update").map((c) => c.args.patch)).toEqual([
      { selected: null, include_titles: true, monday_review: null, provider: null },
      { selected: null, include_titles: null, monday_review: true, provider: null },
    ]);
  });
});
