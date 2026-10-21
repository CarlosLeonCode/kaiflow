import { events, useTauriEvent } from "@/shared/ipc";

import { playChime } from "../lib/chime";

/**
 * Plays the end-of-block chime when the backend asks for it: the sound setting is on and no
 * system notification (with its own sound) could be shown. Mounted once, in the popover.
 */
export function useFocusChime(play: () => void = playChime): void {
  useTauriEvent(events.focusEnded, (ended) => {
    if (ended.chime) play();
  });
}
