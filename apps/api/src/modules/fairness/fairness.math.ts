/**
 * Pure maths behind the fairness report (IC-5.2): histogram bins, deviation statistics, overlap conversion and
 * the post-exam difficulty audit. No database and no clock, so every rule here is unit tested.
 */

export const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Observed p further than this from the engine's estimate makes a question a recalibration candidate. */
export const RECALIBRATION_THRESHOLD = 0.2;
/** Fewer graded answers than this are too noisy to call a question miscalibrated. */
export const RECALIBRATION_MIN_N = 5;
/**
 * Share of balanced papers that must land within tolerance for the tolerance to count as achievable. Also the
 * percentile behind Deviation.p95Percent, so "holds at ±x" and "achievable" use the same bar.
 */
export const ACHIEVABLE_SHARE = 0.95;

export interface Spread {
  meanPercent: number;
  sdPercent: number;
  minPercent: number;
  maxPercent: number;
  /** max − min, in percentage points. */
  rangePercent: number;
}

/** Mean, population standard deviation and range of a list of percentages. Zeros for an empty list. */
export function spreadOf(values: readonly number[]): Spread {
  if (values.length === 0) return { meanPercent: 0, sdPercent: 0, minPercent: 0, maxPercent: 0, rangePercent: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { meanPercent: round(mean), sdPercent: round(Math.sqrt(variance)), minPercent: round(min), maxPercent: round(max), rangePercent: round(max - min) };
}

/** Nearest-rank percentile (q in 0..1) of an unsorted list; 0 for an empty list. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1]!;
}

export interface Deviation {
  /** Largest |paper − target| over all papers, in percentage points: "every paper is within ±max". */
  maxPercent: number;
  /** 95th percentile of |paper − target|: the tolerance the papers hold 95% of the time. */
  p95Percent: number;
}

export function deviationFrom(papers: readonly number[], target: number): Deviation {
  const gaps = papers.map((p) => Math.abs(p - target));
  return { maxPercent: round(gaps.length ? Math.max(...gaps) : 0), p95Percent: round(percentile(gaps, ACHIEVABLE_SHARE)) };
}

/**
 * Papers of one exam all hold the same number of questions n, so for two papers sharing s questions the
 * Jaccard index is J = s / (2n − s), i.e. s / n = 2J / (1 + J): the share of one paper also on the other.
 * Applied to the mean Jaccard it is an approximation (slightly high, the transform is concave).
 */
export const jaccardToSharedShare = (jaccard: number) => (jaccard <= 0 ? 0 : round((2 * jaccard) / (1 + jaccard), 4));

export interface HistogramBin {
  from: number;
  to: number;
  mid: number;
  /** Papers per series that fall in [from, to). The last bin is closed on the right. */
  counts: Record<string, number>;
}

const NICE_WIDTHS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];

/**
 * Bins several series on ONE grid so overlaid histograms line up: the narrowest "nice" bin width that keeps the
 * whole range within `maxBins`, with edges on multiples of the width. Values are percentages.
 */
export function sharedHistogram(series: Record<string, readonly number[]>, maxBins = 28): { binWidth: number; bins: HistogramBin[] } {
  const all = Object.values(series).flat();
  if (all.length === 0) return { binWidth: 1, bins: [] };
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const width = NICE_WIDTHS.find((w) => Math.floor(hi / w) - Math.floor(lo / w) + 1 <= maxBins) ?? NICE_WIDTHS.at(-1)!;
  const start = Math.floor(lo / width + 1e-9) * width;
  const count = Math.max(1, Math.floor((hi - start) / width + 1e-9) + 1);
  const names = Object.keys(series);
  const bins: HistogramBin[] = Array.from({ length: count }, (_, i) => {
    const from = round(start + i * width, 4);
    const to = round(start + (i + 1) * width, 4);
    return { from, to, mid: round((from + to) / 2, 4), counts: Object.fromEntries(names.map((n) => [n, 0])) };
  });
  for (const name of names) {
    for (const v of series[name]!) {
      const index = Math.min(count - 1, Math.max(0, Math.floor((v - start) / width + 1e-9)));
      bins[index]!.counts[name]!++;
    }
  }
  return { binWidth: width, bins };
}

// ---------------------------------------------------------------------------------------------------------
// Post-exam audit
// ---------------------------------------------------------------------------------------------------------

/** One graded answer part: what the candidate earned on the answer (method marks excluded) out of its marks. */
export interface GradedObservation {
  attemptId: string;
  questionId: string;
  marks: number;
  /** Answer-part score, or null while a person still has to grade it. */
  score: number | null;
}

export interface ItemP {
  questionId: string;
  /** Graded answers behind the value. */
  n: number;
  /** Mean score fraction, each answer clamped to 0..1 (negative marking counts as 0). */
  p: number;
}

/**
 * Observed difficulty per question: mean of score / marks over graded answers. This is the same quantity the
 * engine calibrates on (`questions.observedP`): answer marks only, so method marks never skew difficulty.
 */
export function observedItemP(observations: readonly GradedObservation[]): Map<string, ItemP> {
  const acc = new Map<string, { n: number; sum: number }>();
  for (const o of observations) {
    if (o.score === null || !(o.marks > 0)) continue;
    const fraction = Math.min(1, Math.max(0, o.score / o.marks));
    const a = acc.get(o.questionId) ?? { n: 0, sum: 0 };
    a.n++;
    a.sum += fraction;
    acc.set(o.questionId, a);
  }
  return new Map([...acc].map(([questionId, a]) => [questionId, { questionId, n: a.n, p: round(a.sum / a.n, 4) }]));
}

export interface PaperItem {
  questionId: string;
  marks: number;
}

/**
 * How hard a paper turned out to be: its expected score using the p-values measured on every candidate,
 *   Σ marks × p_observed / Σ marks.
 * Questions nobody has a graded answer for are left out of both sums. Null when nothing on the paper is graded.
 */
export function observedPaperPercent(items: readonly PaperItem[], pByQuestion: ReadonlyMap<string, ItemP>): number | null {
  let expected = 0;
  let total = 0;
  for (const item of items) {
    const p = pByQuestion.get(item.questionId);
    if (!p || !(item.marks > 0)) continue;
    expected += item.marks * p.p;
    total += item.marks;
  }
  return total > 0 ? round((expected / total) * 100) : null;
}

/** A recalibration candidate: observed p far from the estimate the engine balanced with, on enough answers. */
export const needsRecalibration = (observedP: number, estimate: number, n: number) =>
  n >= RECALIBRATION_MIN_N && Math.abs(observedP - estimate) > RECALIBRATION_THRESHOLD + 1e-9;

/** Number of distinct question sets among the papers (1 for a fixed paper). */
export function distinctPapers(papers: readonly PaperItem[][]): number {
  return new Set(papers.map((items) => items.map((i) => i.questionId).sort().join('|'))).size;
}
