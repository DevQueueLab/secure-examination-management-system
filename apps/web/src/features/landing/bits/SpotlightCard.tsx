/**
 * Adapted from React Bits by David Haz, Components/SpotlightCard (TS + Tailwind variant).
 * https://github.com/DavidHDev/react-bits
 * Licence: MIT + Commons Clause License Condition v1.0. Copyright (c) 2026 David Haz.
 */
'use client';

import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { ATHENA } from './palette';
import { prefersReducedMotion, useIsoLayoutEffect } from './shared';

export type SpotlightShape = 'circle' | 'beam';

export type SpotlightCardProps = HTMLAttributes<HTMLDivElement> & {
  /** Light colour. Defaults to gold on the dark theme, wine on the light one. */
  spotlightColor?: string;
  /** Panel fill. Defaults to near-black lifted 4% toward warm light (dark) or marble grey (light). */
  surfaceColor?: string;
  /** Peak alpha of the light, 0 to 1. Kept low by default. */
  intensity?: number;
  spotlightSize?: number;
  softness?: number;
  shape?: SpotlightShape;
  /** Distance in px outside the card at which the light starts to appear. */
  proximity?: number;
  smoothing?: number;
  /** Let the light drift on its own while the pointer is away. */
  ambient?: boolean;
  /** Brighten briefly while pressed. */
  flare?: boolean;
  theme?: 'dark' | 'light';
};

type Palette = { surface: string; light: string; fill: number };

type Settings = {
  shape: SpotlightShape;
  fill: string;
  size: number;
  intensity: number;
  proximity: number;
  smoothing: number;
  ambient: boolean;
  flare: boolean;
};

const THEMES: Record<'dark' | 'light', Palette> = {
  dark: { surface: `color-mix(in srgb, ${ATHENA.light} 4%, ${ATHENA.ink})`, light: ATHENA.gold, fill: 1 },
  light: { surface: ATHENA.marble, light: ATHENA.wine, fill: 0.5 }
};

const SHAPES: SpotlightShape[] = ['circle', 'beam'];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const falloff = (color: string, softness: number) => {
  const soft = clamp(softness, 0, 1);
  const core = (1 - soft) ** 1.5 * 0.85;
  const stop = (alpha: number, at: number) =>
    `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(2)}%, transparent) ${(at * 100).toFixed(2)}%`;
  const list = [stop(1, 0)];
  for (let i = 0; i <= 14; i++) {
    const t = core + ((1 - core) * i) / 14;
    const g = (t - core) / (1 - core);
    const smooth = 1 - g * g * (3 - 2 * g);
    const glow = Math.exp(-4.6 * g * g) * (1 - g ** 6);
    list.push(stop(smooth + (glow - smooth) * soft, t));
  }
  return list.join(', ');
};

// The spotlight itself is a soft radial falloff that follows the pointer; it has no flat equivalent.
const spotlight = (s: Settings, size: number, x: number, y: number) => {
  if (s.shape === 'beam') {
    const reach = Math.max(size * 0.6, y + size * 0.55);
    return `radial-gradient(${(size * 0.55).toFixed(1)}px ${reach.toFixed(1)}px at ${x.toFixed(1)}px 0px, ${s.fill})`; // taste-skill-ignore
  }
  return `radial-gradient(circle ${size.toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px, ${s.fill})`; // taste-skill-ignore
};

/** A panel with a warm cursor spotlight. Server HTML is the plain panel; the light starts after mount. */
const SpotlightCard = ({
  children,
  className = '',
  style,
  spotlightColor,
  surfaceColor,
  intensity = 0.12,
  spotlightSize = 260,
  softness = 0.8,
  shape = 'circle',
  proximity = 60,
  smoothing = 0.3,
  ambient = false,
  flare = false,
  theme = 'dark',
  ...rest
}: SpotlightCardProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLSpanElement>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const palette = THEMES[theme] ?? THEMES.dark;
  const color = spotlightColor ?? palette.light;
  const form = SHAPES.includes(shape) ? shape : 'circle';
  const settings: Settings = {
    shape: form,
    fill: falloff(color, softness),
    size: Math.max(20, spotlightSize),
    intensity: clamp(intensity, 0, 1) * palette.fill,
    proximity: Math.max(0, proximity),
    smoothing: clamp(smoothing, 0, 1),
    ambient,
    flare
  };
  const settingsRef = useRef(settings);

  useIsoLayoutEffect(() => {
    settingsRef.current = settings;
  });

  useEffect(() => {
    wakeRef.current?.();
  });

  useEffect(() => {
    const root = rootRef.current;
    const light = lightRef.current;
    if (!root || !light) return undefined;

    const reduce = prefersReducedMotion();
    const state = { x: 0, y: 0, presence: 0, flare: 0, time: Math.random() * 60, pressed: false, visible: true };
    const pointer = { x: 0, y: 0, active: false };
    let drawn = '';
    let focus: Element | null = null;
    let raf = 0;
    let last = 0;
    let alive = true;

    const paint = (s: Settings) => {
      const size = s.size * (1 + 0.2 * state.flare);
      const boost = 1 + 0.7 * state.flare;
      const fill = spotlight(s, size, state.x, state.y);
      if (fill !== drawn) {
        drawn = fill;
        light.style.background = fill;
      }
      light.style.opacity = String(Math.min(1, state.presence * s.intensity * boost));
    };

    const tick = (now: number) => {
      raf = 0;
      if (!alive) return;
      const s = settingsRef.current;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const rect = root.getBoundingClientRect();
      let tx = state.x;
      let ty = state.y;
      let target = 0;

      if (focus && root.contains(focus)) {
        const box = focus.getBoundingClientRect();
        tx = box.left + box.width / 2 - rect.left;
        ty = box.top + box.height / 2 - rect.top;
        target = 1;
      } else if (pointer.active) {
        tx = pointer.x - rect.left;
        ty = pointer.y - rect.top;
        const gap = Math.hypot(Math.max(0, -tx, tx - rect.width), Math.max(0, -ty, ty - rect.height));
        if (gap === 0) target = 1;
        else if (s.proximity > 0) target = Math.max(0, 1 - gap / s.proximity) ** 2;
      }

      if (target < 0.6 && s.ambient && state.visible && !reduce) {
        state.time += dt;
        const drift = 0.6 - target;
        tx += (rect.width * (0.5 + 0.34 * Math.sin(state.time * 0.43)) - tx) * (drift / 0.6);
        ty += (rect.height * (0.5 + 0.3 * Math.sin(state.time * 0.61 + 1.3)) - ty) * (drift / 0.6);
        target = 0.6;
      }

      if (state.presence < 0.02 && target > 0 && !s.ambient) {
        state.x = tx;
        state.y = ty;
      }

      const follow = reduce || s.smoothing === 0 ? 1 : 1 - Math.exp(-dt / (0.015 + s.smoothing * 0.22));
      state.x += (tx - state.x) * follow;
      state.y += (ty - state.y) * follow;

      const fade = reduce ? 1 : 1 - Math.exp(-dt / (target > state.presence ? 0.1 : 0.32));
      state.presence += (target - state.presence) * fade;
      if (Math.abs(target - state.presence) < 0.002) state.presence = target;

      const press = state.pressed && s.flare && !reduce ? 1 : 0;
      state.flare += (press - state.flare) * (1 - Math.exp(-dt / (press ? 0.05 : 0.28)));
      if (Math.abs(press - state.flare) < 0.002) state.flare = press;

      paint(s);

      const moving = Math.abs(tx - state.x) > 0.1 || Math.abs(ty - state.y) > 0.1;
      const settled = !moving && state.presence === target && state.flare === press;
      if (!settled || (s.ambient && state.visible && !reduce)) raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (raf || !alive) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      if (state.presence > 0 || settingsRef.current.proximity > 0 || root.contains(event.target as Node | null)) wake();
    };
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      pointer.active = false;
      wake();
    };
    const onDown = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      state.pressed = true;
      wake();
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') pointer.active = false;
      if (!state.pressed && event.pointerType === 'mouse') return;
      state.pressed = false;
      wake();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.matches(':focus-visible')) return;
      focus = event.target;
      wake();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (root.contains(event.relatedTarget as Node | null)) return;
      focus = null;
      wake();
    };
    const onScroll = () => {
      if (pointer.active || state.presence > 0) wake();
    };

    const observer = new IntersectionObserver(entries => {
      state.visible = entries.some(entry => entry.isIntersecting);
      if (state.visible) wake();
    });
    observer.observe(root);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('pointerout', onOut);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    wake();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('pointerout', onOut);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      wakeRef.current = null;
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn('relative isolate overflow-hidden rounded-3xl p-8', className)}
      style={{ backgroundColor: surfaceColor ?? palette.surface, ...style } as CSSProperties}
      {...rest}
    >
      <span
        ref={lightRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-0"
      />
      {children}
    </div>
  );
};

export default SpotlightCard;
