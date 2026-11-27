'use client';

import { useSyncExternalStore } from 'react';

/**
 * One shared one-second ticker for every countdown on the monitor, anchored to server time: the browser clock
 * is never trusted for deadlines. Each live response re-syncs the offset (server time minus local time).
 */
let offsetMs = 0;
let tick = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      tick = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function syncServerClock(serverNowIso: string, receivedAt = Date.now()): void {
  const server = Date.parse(serverNowIso);
  if (Number.isFinite(server)) offsetMs = server - receivedAt;
}

/** Local clock in ms, for the age of local events such as the last fetch. Re-renders the caller once a second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => tick, () => tick);
}

/** Current server time in ms. Re-renders the caller once a second. */
export function useServerNow(): number {
  return useNow() + offsetMs;
}

/** Server time right now, for event handlers (no re-render). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
