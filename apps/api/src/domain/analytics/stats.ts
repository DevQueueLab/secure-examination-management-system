/**
 * Descriptive and psychometric statistics. Pure functions over plain numbers, so they are trivially testable
 * and shared by the analytics endpoint and the PDF reports.
 */

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function mean(xs: readonly number[]): number | null {
  return xs.length ? sum(xs) / xs.length : null;
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Population variance (divides by n). Used inside reliability formulas, where only ratios matter. */
export function variance(xs: readonly number[]): number | null {
  const m = mean(xs);
  if (m === null) return null;
  return sum(xs.map((x) => (x - m) ** 2)) / xs.length;
}

/** Sample standard deviation (divides by n - 1), the figure reported to examiners. */
export function sampleSd(xs: readonly number[]): number | null {
  if (xs.length < 2) return xs.length === 1 ? 0 : null;
  const m = mean(xs)!;
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** Pearson correlation; null when either side has no variance or there are fewer than 3 pairs. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Point-biserial correlation between an item and the test. For a 0/1 item it equals Pearson's r; for partial
 * credit it is the item-total correlation. Callers pass the rest score (total minus this item) so the item does
 * not correlate with itself ("corrected" item-total correlation).
 */
export function pointBiserial(itemScores: readonly number[], restScores: readonly number[]): number | null {
  return pearson(itemScores, restScores);
}

/**
 * Kuder-Richardson 20 for dichotomous (0/1) items.
 *   KR-20 = k/(k-1) * (1 - Σ p_i q_i / σ²_X)
 * `matrix[person][item]` holds 0 or 1. Null when fewer than 2 items or people, or the totals have no variance.
 */
export function kr20(matrix: readonly (readonly number[])[]): number | null {
  const n = matrix.length;
  const k = matrix[0]?.length ?? 0;
  if (n < 2 || k < 2) return null;
  let pq = 0;
  for (let j = 0; j < k; j++) {
    const p = sum(matrix.map((row) => row[j]!)) / n;
    pq += p * (1 - p);
  }
  const totalVar = variance(matrix.map((row) => sum(row)))!;
  if (totalVar === 0) return null;
  return (k / (k - 1)) * (1 - pq / totalVar);
}

/**
 * Cronbach's alpha for polytomous (partial-credit) items; equals KR-20 when every item is 0/1.
 *   α = k/(k-1) * (1 - Σ σ²_i / σ²_X)
 */
export function cronbachAlpha(matrix: readonly (readonly number[])[]): number | null {
  const n = matrix.length;
  const k = matrix[0]?.length ?? 0;
  if (n < 2 || k < 2) return null;
  let itemVar = 0;
  for (let j = 0; j < k; j++) itemVar += variance(matrix.map((row) => row[j]!))!;
  const totalVar = variance(matrix.map((row) => sum(row)))!;
  if (totalVar === 0) return null;
  return (k / (k - 1)) * (1 - itemVar / totalVar);
}

/**
 * Upper-lower discrimination index. People are ranked by their total; the top and bottom `fraction` (27% by
 * convention, at least one person each) are compared on the item's mean score fraction.
 *   D = mean(item | upper group) - mean(item | lower group), in [-1, 1].
 */
export function discriminationIndex(
  rows: readonly { item: number; total: number }[],
  fraction = 0.27,
): { d: number; upper: number; lower: number; groupSize: number } | null {
  if (rows.length < 4) return null;
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const g = Math.max(1, Math.round(rows.length * fraction));
  const upper = mean(sorted.slice(0, g).map((r) => r.item))!;
  const lower = mean(sorted.slice(-g).map((r) => r.item))!;
  return { d: upper - lower, upper, lower, groupSize: g };
}

/** Splits ids into upper and lower groups by total (same convention as discriminationIndex). */
export function extremeGroups<T extends { total: number }>(rows: readonly T[], fraction = 0.27): { upper: T[]; lower: T[] } {
  if (rows.length < 4) return { upper: [], lower: [] };
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const g = Math.max(1, Math.round(rows.length * fraction));
  return { upper: sorted.slice(0, g), lower: sorted.slice(-g) };
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

/** Equal-width bins over [min, max]; the last bin includes its upper edge (so 100% lands in 90-100). */
export function histogram(values: readonly number[], bins = 10, min = 0, max = 100): HistogramBin[] {
  const width = (max - min) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
    out[idx]!.count++;
  }
  return out;
}

/** Percentile rank: share of the cohort scoring below, counting ties as half. 0-100. */
export function percentileRank(value: number, cohort: readonly number[]): number | null {
  if (!cohort.length) return null;
  let below = 0;
  let equal = 0;
  for (const c of cohort) {
    if (c < value - 1e-9) below++;
    else if (Math.abs(c - value) <= 1e-9) equal++;
  }
  return ((below + equal / 2) / cohort.length) * 100;
}

/** Conventional reading of a reliability coefficient. */
export function reliabilityBand(value: number | null): 'excellent' | 'good' | 'acceptable' | 'questionable' | 'poor' | null {
  if (value === null) return null;
  if (value >= 0.9) return 'excellent';
  if (value >= 0.8) return 'good';
  if (value >= 0.7) return 'acceptable';
  if (value >= 0.6) return 'questionable';
  return 'poor';
}

export const round = (n: number | null, digits = 3): number | null =>
  n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits;
