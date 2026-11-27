'use client';

import { DEFAULT_WORKSPACE_PREFERENCES, workspacePreferencesSchema, type WorkspacePreferences } from '@athena/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useDocumentTheme } from '@/lib/theme';

const STORAGE_KEY = 'athena:workspace-preferences';

function readCache(): Partial<WorkspacePreferences> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = workspacePreferencesSchema.partial().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function writeCache(prefs: WorkspacePreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: preferences still apply for this page */
  }
}

/** Only keys that parse: one bad stored value never resets the rest. */
function sanitize(input: Record<string, unknown> | undefined): Partial<WorkspacePreferences> {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  const shape = workspacePreferencesSchema.shape;
  for (const key of Object.keys(shape) as (keyof WorkspacePreferences)[]) {
    if (!(key in input)) continue;
    const parsed = shape[key].safeParse(input[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Partial<WorkspacePreferences>;
}

interface PreferencesValue {
  prefs: WorkspacePreferences;
  set: (patch: Partial<WorkspacePreferences>) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

/**
 * Workspace preferences: the profile copy wins once it loads, the device cache gives an instant first paint
 * (and works offline), and every change applies at once, is cached, then saved to the profile.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { me, updatePreferences } = useAuth();
  const [cache, setCache] = useState<Partial<WorkspacePreferences>>({});
  const [changes, setChanges] = useState<Partial<WorkspacePreferences>>({});
  const [hydrated, setHydrated] = useState(false);
  const pendingPatch = useRef<Partial<WorkspacePreferences>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCache(readCache());
    setHydrated(true);
  }, []);

  const profile = useMemo(() => sanitize(me?.user.preferences), [me?.user.preferences]);
  // Device cache for the first paint and offline, the profile once it loads, and changes made here on top.
  const prefs = useMemo<WorkspacePreferences>(
    () => ({ ...DEFAULT_WORKSPACE_PREFERENCES, ...cache, ...profile, ...changes }),
    [cache, profile, changes],
  );

  useEffect(() => {
    if (hydrated) writeCache(prefs);
  }, [prefs, hydrated]);

  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  // The whole object goes up, not just the change: the profile endpoint fills missing keys with defaults.
  const flushSave = useCallback(() => {
    if (Object.keys(pendingPatch.current).length === 0) return;
    pendingPatch.current = {};
    const full = { ...prefsRef.current };
    updatePreferences(full).catch(() => {
      // Offline or the API is restarting: try again with the next change.
      pendingPatch.current = { ...full, ...pendingPatch.current };
    });
  }, [updatePreferences]);

  const set = useCallback(
    (patch: Partial<WorkspacePreferences>) => {
      setChanges((prev) => ({ ...prev, ...patch }));
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushSave, 600);
    },
    [flushSave],
  );

  const reset = useCallback(() => set({ ...DEFAULT_WORKSPACE_PREFERENCES }), [set]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushSave();
    },
    [flushSave],
  );

  useDocumentTheme(prefs.theme, { reduceMotion: prefs.reduceMotion });

  const value = useMemo(() => ({ prefs, set, reset }), [prefs, set, reset]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside the exam workspace');
  return ctx;
}

const FONT_STACK: Record<WorkspacePreferences['font'], string> = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-serif)',
  readable: 'var(--font-readable), var(--font-sans)',
};

const LEADING: Record<WorkspacePreferences['lineSpacing'], string> = { compact: '1.4', normal: '1.6', relaxed: '1.85' };

/** CSS variables the reading styles use (question text, options, answers). */
export function readingVars(prefs: WorkspacePreferences): CSSProperties {
  return {
    '--reading-scale': String(prefs.fontScale),
    '--reading-font': FONT_STACK[prefs.font],
    '--reading-leading': LEADING[prefs.lineSpacing],
  } as CSSProperties;
}

export const FONT_SCALE_STEPS = [0.85, 0.92, 1, 1.1, 1.2, 1.35, 1.5, 1.6] as const;
