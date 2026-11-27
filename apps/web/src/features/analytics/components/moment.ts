'use client';

import { useEffect, useState } from 'react';

/**
 * Moments are the few places that earn motion: a revealed score counting up, a signed code decoding.
 * Each plays once per tab (kept across remounts, refetches and reloads), and never under reduced motion.
 */
const played = new Set<string>();
const storageKey = (key: string) => `athena:moment:${key}`;

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return document.documentElement.dataset.reduceMotion === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hasPlayed(key: string): boolean {
  if (played.has(key)) return true;
  try {
    return sessionStorage.getItem(storageKey(key)) !== null;
  } catch {
    return false;
  }
}

function mark(key: string, on: boolean) {
  if (on) played.add(key);
  else played.delete(key);
  try {
    if (on) sessionStorage.setItem(storageKey(key), '1');
    else sessionStorage.removeItem(storageKey(key));
  } catch {
    // Storage blocked: the in-memory set still keeps the moment to once per visit.
  }
}

/** Linear progress from 0 to 1 over `durationMs` the first time `key` is shown; 1 straight away after that. */
export function useMoment(key: string, durationMs: number): number {
  const [play] = useState(() => !reducedMotion() && !hasPlayed(key));
  const [t, setT] = useState(play ? 0 : 1);
  useEffect(() => {
    if (!play) return;
    mark(key, true);
    let raf = 0;
    let done = false;
    const start = performance.now();
    const step = (now: number) => {
      // A frame's timestamp can predate `start` by a few ms; clamp so progress never goes negative.
      const p = Math.max(0, Math.min(1, (now - start) / durationMs));
      setT(p);
      if (p < 1) raf = requestAnimationFrame(step);
      else done = true;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted (or Strict Mode's rehearsal unmount): let the next mount play it in full.
      if (!done) mark(key, false);
    };
  }, [play, key, durationMs]);
  return t;
}

/** A critically damped spring's step response: no overshoot, settles where it should. */
export function settle(p: number): number {
  if (p >= 1) return 1;
  const w = 8;
  return 1 - (1 + w * p) * Math.exp(-w * p);
}

const POOL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** The text as it reads at progress `t` of a decode: characters lock in from left to right; dashes stay put. */
export function decodeFrame(text: string, t: number): string {
  if (t >= 1) return text;
  const n = text.length;
  const frame = Math.max(0, Math.floor(t * 40));
  let out = '';
  for (let i = 0; i < n; i++) {
    const ch = text[i]!;
    if (ch === '-' || ch === ' ') {
      out += ch;
      continue;
    }
    const lockAt = 0.15 + (0.8 * (i + 1)) / n;
    out += t >= lockAt ? ch : POOL[(i * 7 + frame * 13 + ((i * frame) % 5)) % POOL.length];
  }
  return out;
}
