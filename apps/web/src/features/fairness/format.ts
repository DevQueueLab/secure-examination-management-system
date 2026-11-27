/** Number formatting for the fairness report. Minus signs are typographic (−). */

const minus = (s: string) => s.replace(/^-/, '−');

/** "57.9%" */
export function fmtPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return `${minus(n.toFixed(digits))}%`;
}

/** A 0–1 share as a whole percentage: "82%". */
export function fmtShare(x: number | null | undefined, digits = 0): string {
  return x === null || x === undefined ? '–' : fmtPercent(x * 100, digits);
}

/**
 * A share where rounding must not overstate: only an exact 1 reads "100%" (and only 0 reads "0%"), so 99.8% of
 * papers is never shown as all of them. "100%", "99.8%", "97%".
 */
export function fmtShareStrict(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  const pct = x * 100;
  if (pct >= 100) return '100%';
  if (pct <= 0) return '0%';
  const v = Math.min(99.9, Math.max(0.1, Number(pct.toFixed(1))));
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

const listFmt = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

/** "a, b and c" */
export function listOf(items: string[]): string {
  return listFmt.format(items);
}

/** A deviation band: "±1.8%". */
export function fmtBand(points: number, digits = 1): string {
  return `±${Math.abs(points).toFixed(digits)}%`;
}

/** Percentage points, signed: "+12 pts", "−35 pts". */
export function fmtSignedPoints(delta: number | null, digits = 0): string {
  if (delta === null || !Number.isFinite(delta)) return '–';
  const v = Number((delta * 100).toFixed(digits));
  if (v === 0) return '0 pts';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)} ${Math.abs(v) === 1 ? 'pt' : 'pts'}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : dateTimeFmt.format(d);
}

export const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;
