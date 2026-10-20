import { useEffect, useSyncExternalStore } from "react";

export type ThemeSetting = "light" | "dark" | "system";

const QUERY = "(prefers-color-scheme: dark)";

/** Settings store the theme as a free string; anything unknown behaves as `system`. */
export function parseTheme(value: string | undefined): ThemeSetting {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveDark(theme: ThemeSetting, systemDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && systemDark);
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

export function applyTheme(theme: ThemeSetting): void {
  const dark = resolveDark(theme, systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

/** Applies the theme and, for `system`, follows OS changes live. */
export function useTheme(theme: ThemeSetting): void {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);
}

function subscribeToDarkClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** True while the resolved theme is dark (follows the `dark` class on <html>). */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribeToDarkClass,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}
