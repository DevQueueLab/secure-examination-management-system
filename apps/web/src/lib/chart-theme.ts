/**
 * Athena's data palette, from the theme tokens in globals.css (all four themes, AA-checked as marks).
 *
 *   data-1  carmine   the subject: this exam, this candidate, the balanced draw
 *   data-2  graphite  the comparison: the cohort, the random draw, last term
 *   data-3  gold      targets: pass marks, target lines, tolerance bands
 *   data-4  wine      a secondary series when a third is unavoidable
 *   data-5  rest      everything else, "other", the remainder
 *
 * No blue or violet, ever. Prefer the var() strings: they follow the theme (light, dark, sepia, contrast)
 * without re-rendering. Use `readDataPalette` only for canvas renderers that need resolved colours.
 */

export const DATA_TOKENS = ['--data-1', '--data-2', '--data-3', '--data-4', '--data-5'] as const;

/** Series colours in order, as CSS values for SVG fills, strokes and inline styles. */
export const dataSeries = DATA_TOKENS.map((t) => `var(${t})`) as readonly string[];

/** Roles, for charts that compare a subject against a baseline and a target. */
export const dataPalette = {
  subject: 'var(--data-1)',
  comparison: 'var(--data-2)',
  target: 'var(--data-3)',
  secondary: 'var(--data-4)',
  rest: 'var(--data-5)',
} as const;

/** Tailwind classes for the same roles (bg-*, text-*, stroke-*, fill-*). */
export const dataClass = {
  subject: { bg: 'bg-data-1', text: 'text-data-1', stroke: 'stroke-data-1', fill: 'fill-data-1' },
  comparison: { bg: 'bg-data-2', text: 'text-data-2', stroke: 'stroke-data-2', fill: 'fill-data-2' },
  target: { bg: 'bg-data-3', text: 'text-data-3', stroke: 'stroke-data-3', fill: 'fill-data-3' },
  secondary: { bg: 'bg-data-4', text: 'text-data-4', stroke: 'stroke-data-4', fill: 'fill-data-4' },
  rest: { bg: 'bg-data-5', text: 'text-data-5', stroke: 'stroke-data-5', fill: 'fill-data-5' },
} as const;

/** Chart furniture: gridlines recede, axis labels stay legible, target bands are a gold tint. */
export const chartTheme = {
  grid: 'var(--separator)',
  axis: 'var(--separator-strong)',
  label: 'var(--label-secondary)',
  tick: 'var(--label-tertiary)',
  band: 'var(--gold-tint)',
  target: 'var(--data-3)',
  surface: 'var(--surface)',
  font: 'var(--font-sans)',
} as const;

/**
 * Resolved colours for canvas or WebGL renderers, read from an element inside the themed subtree
 * (defaults to <html>). Returns the five data colours in order; empty strings during SSR.
 */
export function readDataPalette(el?: Element | null): string[] {
  if (typeof window === 'undefined') return DATA_TOKENS.map(() => '');
  const style = getComputedStyle(el ?? document.documentElement);
  return DATA_TOKENS.map((t) => style.getPropertyValue(t).trim());
}
