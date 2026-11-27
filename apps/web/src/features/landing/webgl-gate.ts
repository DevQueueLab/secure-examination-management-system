'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * One gate for every decorative WebGL piece on the public pages (the 3D mark, light rays, backgrounds).
 *
 * - Never on the server, under prefers-reduced-motion, or on weak devices (4 cores or fewer, 4 GB or less).
 * - Mounted only once the browser is idle and the host element is within one viewport of the screen.
 * - At most MAX_LIVE contexts alive at once: a third waits on its poster until a slot frees.
 * - `paused` is true while the tab is hidden or the host is off screen, so render loops can stop.
 */
const MAX_LIVE = 2;
const live = new Set<symbol>();
const waiting = new Set<() => void>();

function release(id: symbol) {
  if (!live.delete(id)) return;
  for (const wake of [...waiting]) wake();
}

/** Device and preference check, evaluated in the browser only. */
export function canRunWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 8) <= 4) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) return false;
  return 'WebGLRenderingContext' in window;
}

function subscribeHidden(cb: () => void) {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

/** True while the tab is hidden. */
export function useDocumentHidden(): boolean {
  return useSyncExternalStore(
    subscribeHidden,
    () => document.hidden,
    () => false,
  );
}

export interface WebGLGate {
  /** Render the WebGL component now. */
  mount: boolean;
  /** Stop the render loop (tab hidden or host off screen). */
  paused: boolean;
}

export function useWebGLGate(ref: RefObject<HTMLElement | null>, { margin = '100% 0px 100% 0px' } = {}): WebGLGate {
  const [allowed, setAllowed] = useState(false);
  const [idle, setIdle] = useState(false);
  const [near, setNear] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [slot, setSlot] = useState(false);
  const hidden = useDocumentHidden();

  // Device check and idle wait, once. Both flags flip together when the browser is idle; nothing mounts before then.
  useEffect(() => {
    if (!canRunWebGL()) return;
    const ready = () => {
      setAllowed(true);
      setIdle(true);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(ready, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(h);
    }
    const t = window.setTimeout(ready, 600);
    return () => window.clearTimeout(t);
  }, []);

  // Near (within one viewport) and on screen, from two observers.
  useEffect(() => {
    const el = ref.current;
    if (!el || !allowed) return;
    const nearIo = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { rootMargin: margin });
    const seenIo = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { rootMargin: '0px' });
    nearIo.observe(el);
    seenIo.observe(el);
    return () => {
      nearIo.disconnect();
      seenIo.disconnect();
    };
  }, [ref, allowed, margin]);

  // Slot: acquire while wanted, release when not.
  const wanted = allowed && idle && near;
  useEffect(() => {
    if (!wanted) return;
    const id = Symbol('webgl');
    let cancelled = false;
    const tryTake = () => {
      if (cancelled) return;
      if (live.size < MAX_LIVE) {
        live.add(id);
        waiting.delete(tryTake);
        setSlot(true);
      }
    };
    waiting.add(tryTake);
    tryTake();
    return () => {
      cancelled = true;
      waiting.delete(tryTake);
      setSlot(false);
      release(id);
    };
  }, [wanted]);

  const mount = wanted && slot;
  return { mount, paused: !mount || hidden || !onScreen };
}
