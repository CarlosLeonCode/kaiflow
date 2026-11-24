import { useEffect, useRef } from "react";

import { commands, events, unwrap, type MainSectionDto } from "@/shared/ipc";

/**
 * Follows another window's request to show a section (the popover's strokes chip opens
 * Goals). The backend keeps the request until it is taken: the window takes it once it is
 * listening, which covers a webview that loaded after the request, and again on each
 * `main-section-requested` event, so a request never replays later.
 */
export function useMainSectionRequests(onRequest: (section: MainSectionDto) => void): void {
  const latest = useRef(onRequest);
  useEffect(() => {
    latest.current = onRequest;
  });

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const take = () =>
      unwrap(commands.takeMainSection())
        .then((section) => {
          if (active && section) latest.current(section);
        })
        .catch(() => {
          // Nothing to navigate to: the window simply stays where it is.
        });
    events.mainSectionRequested
      .listen(() => void take())
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {
        // Outside Tauri there is no event bus; the pending request is still taken below.
      })
      .finally(() => void take());
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
}
