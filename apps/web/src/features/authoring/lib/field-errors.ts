import { isApiError } from '@/lib/api';

/** Field map from an API validation error ({} for anything else). Paths are dot-separated: `content.options.1.text`. */
export function apiFields(error: unknown): Record<string, string> {
  return isApiError(error) ? error.fields : {};
}

/**
 * The message for a field path: an exact match first, then the first nested issue under it.
 * `errorAt(fields, 'content.options')` finds `content.options` or `content.options.2.text`.
 */
export function errorAt(fields: Record<string, string>, ...paths: string[]): string | undefined {
  for (const path of paths) {
    if (fields[path]) return fields[path];
  }
  for (const path of paths) {
    const nested = Object.keys(fields).find((k) => k.startsWith(`${path}.`));
    if (nested) return fields[nested];
  }
  return undefined;
}

/** Messages whose paths none of the given prefixes claim, so nothing the API says is silently lost. */
export function unclaimed(fields: Record<string, string>, claimed: string[]): string[] {
  return Object.entries(fields)
    .filter(([k]) => !claimed.some((c) => k === c || k.startsWith(`${c}.`)))
    .map(([, v]) => v);
}

/** After errors render, bring the first invalid control into view (instantly when the viewer asks for reduced motion). */
export function revealFirstError() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  });
}
