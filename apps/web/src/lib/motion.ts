'use client';

import { useReducedMotion as useMotionReducedMotion, type Transition, type Variants } from 'motion/react';
import { useSyncExternalStore } from 'react';

/**
 * Spring presets, named for the interaction rather than the numbers.
 * `bounce` and `visualDuration` map to Apple's damping ratio and response:
 * bounce 0 is critically damped (damping 1.0); bounce 0.2 is roughly damping 0.8.
 */
export const spring = {
  /** Default for UI that appears or moves without a gesture behind it. */
  smooth: { type: 'spring', bounce: 0, visualDuration: 0.32 },
  /** Fast feedback: selection indicators, toggles, segmented thumbs. */
  snappy: { type: 'spring', bounce: 0, visualDuration: 0.22 },
  /** Selection that travels (the nav needle, tab rules, segmented thumbs): a slight overshoot, then settle. */
  glide: { type: 'spring', bounce: 0.18, visualDuration: 0.3 },
  /** Sheets and drawers (damping ~0.8, response 0.3). */
  sheet: { type: 'spring', bounce: 0.14, visualDuration: 0.3 },
  /** Only after a flick or drag carried momentum. */
  bouncy: { type: 'spring', bounce: 0.22, visualDuration: 0.4 },
  /** Large layout moves (repositioning, reordering). */
  gentle: { type: 'spring', bounce: 0, visualDuration: 0.45 },
} as const satisfies Record<string, Transition>;

/** Cross-fade used in place of travel when motion is reduced. */
export const fade: Transition = { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] };

function subscribeReduceAttr(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] });
  return () => observer.disconnect();
}

/**
 * True when the OS asks for reduced motion, or the workspace preference sets
 * `data-reduce-motion="true"` on <html>.
 */
export function useReducedMotion(): boolean {
  const system = useMotionReducedMotion() ?? false;
  const attr = useSyncExternalStore(
    subscribeReduceAttr,
    () => document.documentElement.dataset.reduceMotion === 'true',
    () => false,
  );
  return system || attr;
}

/** Pick the spring, or a short cross-fade when motion is reduced. */
export function useSpring(preset: keyof typeof spring = 'smooth'): Transition {
  const reduced = useReducedMotion();
  return reduced ? fade : spring[preset];
}

/** Enter/exit variants that keep opacity but drop travel when motion is reduced. */
export function usePresenceVariants(offset: { x?: number; y?: number; scale?: number } = { y: 8 }): Variants {
  const reduced = useReducedMotion();
  if (reduced) {
    return { initial: { opacity: 0 }, animate: { opacity: 1, transition: fade }, exit: { opacity: 0, transition: fade } };
  }
  return {
    initial: { opacity: 0, x: offset.x ?? 0, y: offset.y ?? 0, scale: offset.scale ?? 1 },
    animate: { opacity: 1, x: 0, y: 0, scale: 1, transition: spring.smooth },
    exit: { opacity: 0, x: offset.x ?? 0, y: offset.y ?? 0, scale: offset.scale ?? 1, transition: { ...spring.snappy } },
  };
}

/** Apple's momentum projection: where a flick would come to rest. decelerationRate 0.998 ~ scroll feel. */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
