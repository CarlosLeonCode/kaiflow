/** Id under which closing the guided setup is remembered, next to the dismissed section intros. */
export const GUIDE_ID = "activities-guide";

/** Days the live rule preview looks back. */
export const PREVIEW_DAYS = 7;

/** Moves keyboard focus to the first control of an element found by id, and scrolls to it. */
export function focusFirstControl(id: string): void {
  const root = document.getElementById(id);
  if (!root) return;
  root.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  const target = root.matches("[tabindex]")
    ? root
    : root.querySelector<HTMLElement>("button:not([disabled]), select, input, [tabindex]");
  target?.focus();
}
