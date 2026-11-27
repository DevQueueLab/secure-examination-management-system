import { examSettingsSchema, type ExamSettings } from '@athena/shared';
import { ValidationError } from '../../lib/errors';
import { parse } from '../../lib/validate';

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge for settings patches: objects merge key by key, everything else (arrays, null, scalars) replaces. */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
    return out;
  }
  return patch;
}

/**
 * Applies a partial settings patch onto stored (or default) settings and validates the result. Merging first
 * matters: parsing a partial nested object alone would silently reset its siblings to their defaults.
 */
export function mergeSettings(base: ExamSettings, patch: Record<string, unknown> | undefined): ExamSettings {
  const merged = deepMerge(base, patch ?? {});
  try {
    return parse(examSettingsSchema, merged);
  } catch (e) {
    if (e instanceof ValidationError && e.fields) {
      const fields = Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [`settings.${k}`, v]));
      throw new ValidationError(e.message, fields);
    }
    throw e;
  }
}

/** Settings that change how papers are built or sat. They lock once a real candidate has started. */
export const LOCKED_SETTINGS = ['shuffleQuestions', 'shuffleOptions', 'navigation', 'lateEntryMinutes', 'allowCalculator', 'allowScratchpad', 'marking', 'integrity', 'fairness'] as const;

/** Exam fields that lock once a real candidate has started (windowClosesAt may still move later). */
export const LOCKED_FIELDS = ['windowOpensAt', 'durationMinutes', 'totalMarks', 'structure'] as const;
