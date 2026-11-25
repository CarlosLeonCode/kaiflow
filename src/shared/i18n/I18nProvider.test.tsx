import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppProviders, createQueryClient } from "@/shared/app/AppProviders";
import { useUpdateSettingsMutation, type SettingsDto, type SettingsPatchDto } from "@/shared/ipc";
import { mergePatch, mockBackend, renderWithProviders, settings } from "@/test/ipc";

import { useLocale, useT } from "./context";

function Probe() {
  const t = useT();
  const locale = useLocale();
  const update = useUpdateSettingsMutation();
  return (
    <>
      <p>
        {t.shell.sections.today} ({locale})
      </p>
      <button type="button" onClick={() => update.mutate({ language: "es" })}>
        switch
      </button>
    </>
  );
}

function backend(initial: Partial<SettingsDto>) {
  let stored = settings(initial);
  return mockBackend({
    settings_get: () => stored,
    settings_update: (args) => {
      stored = mergePatch(args.patch as SettingsPatchDto, stored);
      return stored;
    },
  });
}

describe("I18nProvider", () => {
  it("renders English by default and switches to Spanish when the setting changes", async () => {
    const user = userEvent.setup();
    backend({ language: "system" });
    renderWithProviders(<Probe />);

    expect(await screen.findByText("Today (en)")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    await user.click(screen.getByRole("button", { name: "switch" }));

    expect(await screen.findByText("Hoy (es)")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
  });

  it("uses the OS language while settings load and for system", async () => {
    backend({ language: "system" });
    const client = createQueryClient();
    render(
      <AppProviders client={client} systemLanguage="es">
        <Probe />
      </AppProviders>,
    );
    // Before and after `settings_get` answers: no flash of English.
    expect(screen.getByText("Hoy (es)")).toBeInTheDocument();
    expect(await screen.findByText("Hoy (es)")).toBeInTheDocument();
  });

  it("an explicit setting wins over the OS language", async () => {
    backend({ language: "en" });
    render(
      <AppProviders client={createQueryClient()} systemLanguage="es">
        <Probe />
      </AppProviders>,
    );
    expect(await screen.findByText("Today (en)")).toBeInTheDocument();
  });
});
