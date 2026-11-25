import { createContext, useContext } from "react";

/**
 * Whether the window draws its own title area: on macOS the dashboard uses an overlay title bar
 * (the traffic lights float over the content), so page headers are its drag area. Windows and
 * Linux have a native title bar, where a drag region would only make a header move or maximize
 * the window. The main window provides the value for its OS; macOS is the default.
 */
export const OverlayTitleBarContext = createContext(true);

/** `data-tauri-drag-region` when the window has an overlay title bar, nothing otherwise. */
export function useDragRegion(): { "data-tauri-drag-region"?: true } {
  return useContext(OverlayTitleBarContext)
    ? { "data-tauri-drag-region": true }
    : {};
}
