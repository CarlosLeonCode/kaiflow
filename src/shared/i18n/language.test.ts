import { describe, expect, it } from "vitest";

import { parseLanguage, resolveLanguage, systemLanguage } from "./language";

describe("language resolution", () => {
  it("treats any Spanish OS language as Spanish and everything else as English", () => {
    expect(["es", "es-ES", "es-MX", "ES-419"].map(systemLanguage)).toEqual(["es", "es", "es", "es"]);
    expect(["en-US", "fr-FR", "pt-BR", "", undefined].map(systemLanguage)).toEqual(["en", "en", "en", "en", "en"]);
  });

  it("parses unknown settings as system", () => {
    expect(parseLanguage("es")).toBe("es");
    expect(parseLanguage("en")).toBe("en");
    expect(parseLanguage("fr")).toBe("system");
    expect(parseLanguage(undefined)).toBe("system");
  });

  it("follows the OS only for system", () => {
    expect(resolveLanguage("system", "es")).toBe("es");
    expect(resolveLanguage("system", "en")).toBe("en");
    expect(resolveLanguage("en", "es")).toBe("en");
    expect(resolveLanguage("es", "en")).toBe("es");
  });
});
