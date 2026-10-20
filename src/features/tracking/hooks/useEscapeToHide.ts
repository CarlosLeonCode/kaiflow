import { useEffect } from "react";

import { useHidePopoverMutation } from "@/shared/ipc";

/**
 * Escape dismisses the popover like any macOS menu-bar panel. The window has no window
 * permissions (R6.5), so the backend hides it (`hide_popover`). Escape that something else
 * already handled (a closed dropdown, a cancelled edit) is left alone.
 */
export function useEscapeToHide(): void {
  const { mutate } = useHidePopoverMutation();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      mutate();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mutate]);
}
