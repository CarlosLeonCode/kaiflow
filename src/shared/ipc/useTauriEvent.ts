import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { events } from "./bindings";
import { queryKeys } from "./queryKeys";

/** The part of a generated event handle the hooks rely on. */
export interface EventSource<T> {
  listen(callback: (event: { payload: T }) => void): Promise<() => void>;
}

/**
 * Subscribes to a backend event for the lifetime of the component. The handler may change
 * between renders without resubscribing; a subscription that resolves after unmount is
 * released immediately.
 */
export function useTauriEvent<T>(source: EventSource<T>, handler: (payload: T) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const release = (fn: () => void) => {
      try {
        fn();
      } catch {
        // The event bus is already gone (window closing): nothing left to release.
      }
    };
    source
      .listen((event) => latest.current(event.payload))
      .then((stop) => {
        if (active) unlisten = stop;
        else release(stop);
      })
      .catch(() => {
        // Outside Tauri (plain browser, Vite dev) there is no event bus: nothing to do.
      });
    return () => {
      active = false;
      if (unlisten) release(unlisten);
    };
  }, [source]);
}

/**
 * Keeps the query cache in sync with the backend: the frontend is a cache of the Rust
 * state (design section 9), so every backend event maps to a cache update or invalidation.
 */
export function useBackendEventSync(): void {
  const client = useQueryClient();
  const invalidate = (key: readonly unknown[]) => void client.invalidateQueries({ queryKey: key });

  useTauriEvent(events.trackingStatusChanged, (status) => {
    client.setQueryData(queryKeys.status, status);
    invalidate(queryKeys.reports);
    invalidate(queryKeys.timelines);
  });
  useTauriEvent(events.currentSegmentChanged, () => {
    invalidate(queryKeys.status);
    invalidate(queryKeys.reports);
    invalidate(queryKeys.timelines);
  });
  useTauriEvent(events.dataChanged, () => {
    invalidate(queryKeys.reports);
    invalidate(queryKeys.timelines);
    invalidate(queryKeys.idleGaps);
  });
  useTauriEvent(events.idleGapPending, () => invalidate(queryKeys.idleGaps));
  useTauriEvent(events.idleGapResolved, () => {
    invalidate(queryKeys.idleGaps);
    invalidate(queryKeys.reports);
  });
  useTauriEvent(events.permissionChanged, () => {
    invalidate(queryKeys.permission);
    invalidate(queryKeys.status);
  });
  useTauriEvent(events.shortcutStatusChanged, () => invalidate(queryKeys.status));
}
