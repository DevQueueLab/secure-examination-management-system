'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { THEME_STORAGE_KEY } from './theme-script';

/** App appearance. The exam workspace adds sepia and contrast through `useDocumentTheme`. */
export type Appearance = 'system' | 'light' | 'dark';
export type WorkspaceTheme = 'system' | 'light' | 'dark' | 'sepia' | 'contrast';

export { THEME_STORAGE_KEY };

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

function readAppearance(): Appearance {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyAppearance(appearance: Appearance) {
  const dark = appearance === 'dark' || (appearance === 'system' && systemPrefersDark());
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onMedia = () => {
    if (readAppearance() === 'system') applyAppearance('system');
    callback();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) {
      applyAppearance(readAppearance());
      callback();
    }
  };
  media.addEventListener('change', onMedia);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(callback);
    media.removeEventListener('change', onMedia);
    window.removeEventListener('storage', onStorage);
  };
}

interface ThemeContextValue {
  appearance: Appearance;
  /** What is actually on screen. */
  resolved: 'light' | 'dark';
  setAppearance: (appearance: Appearance) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

let lastPointer: { x: number; y: number; t: number } | null = null;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const appearance = useSyncExternalStore(subscribe, readAppearance, () => 'system' as Appearance);
  const resolved = useSyncExternalStore<'light' | 'dark'>(
    subscribe,
    () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
    () => 'light',
  );

  const setAppearance = useCallback((next: Appearance) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode: still apply for this page */
    }
    const root = document.documentElement;
    const willBeDark = next === 'dark' || (next === 'system' && systemPrefersDark());
    const changes = willBeDark !== root.classList.contains('dark');
    const still = root.dataset.reduceMotion === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (changes && !still && typeof document.startViewTransition === 'function') {
      // The new theme spreads from where the person clicked, as a circle, over about 500 ms.
      const recent = lastPointer && performance.now() - lastPointer.t < 2000;
      const x = recent ? lastPointer!.x : window.innerWidth / 2;
      const y = recent ? lastPointer!.y : window.innerHeight / 2;
      const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const vt = document.startViewTransition(() => {
        applyAppearance(next);
        emit();
      });
      vt.ready
        .then(() => {
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
            { duration: 500, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', pseudoElement: '::view-transition-new(root)' },
          );
        })
        .catch(() => {});
      return;
    }
    // Ease the brightness jump instead of cutting it.
    root.style.setProperty('transition', 'background-color 240ms ease, color 240ms ease');
    applyAppearance(next);
    window.setTimeout(() => root.style.removeProperty('transition'), 260);
    emit();
  }, []);

  // Remember the last press, so a theme change can spread from it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', onDown, { capture: true });
  }, []);

  const value = useMemo(() => ({ appearance, resolved, setAppearance }), [appearance, resolved, setAppearance]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/**
 * Applies a workspace theme to <html> while the calling component is mounted (exam workspace),
 * so dialogs and toasts rendered in portals follow it too. 'system' leaves the app appearance alone.
 */
export function useDocumentTheme(theme: WorkspaceTheme | undefined, options: { reduceMotion?: boolean } = {}) {
  const { reduceMotion } = options;
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    if (theme && theme !== 'system') root.dataset.theme = theme;
    else delete root.dataset.theme;
    return () => {
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
    };
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (reduceMotion) root.dataset.reduceMotion = 'true';
    else delete root.dataset.reduceMotion;
    return () => {
      delete root.dataset.reduceMotion;
    };
  }, [reduceMotion]);
}
