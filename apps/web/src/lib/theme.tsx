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
    // Ease the brightness jump instead of cutting it.
    const root = document.documentElement;
    root.style.setProperty('transition', 'background-color 240ms ease, color 240ms ease');
    applyAppearance(next);
    window.setTimeout(() => root.style.removeProperty('transition'), 260);
    emit();
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
