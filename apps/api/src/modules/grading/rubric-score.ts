import { round3 } from '../../domain/rng';

/**
 * Rubric arithmetic, kept pure so it is shared by single grading, group grading and retroactive re-scoring.
 *   part score = clamp(Σ selected item points + adjustment, 0, part max)
 * An explicit score is never clamped: it must already lie in [0, max] ("validation against assigned marks").
 */

export interface PartScore {
  /** Unclamped Σ points + adjustment. */
  raw: number;
  score: number;
  clamped: boolean;
}

export function rubricPartScore(points: readonly number[], adjustment: number, max: number): PartScore {
  const raw = round3(points.reduce((a, b) => a + b, 0) + adjustment);
  const score = round3(Math.min(max, Math.max(0, raw)));
  return { raw, score, clamped: score !== raw };
}

export type ResolvedPartScore =
  | { ok: true; score: number; adjustment: number; clamped: boolean }
  | { ok: false; field: 'score' | 'adjustment'; message: string };

const marksLabel = (n: number) => `${n} mark${n === 1 ? '' : 's'}`;

/**
 * Turns a grading request into the stored part score and adjustment.
 * - With an explicit score, the adjustment is derived (score − Σ points), so later rubric edits shift it
 *   consistently, exactly as if the grader had typed that adjustment.
 * - Without one, the rubric total plus the adjustment is clamped to the part's range.
 */
export function resolvePartScore(input: { points: readonly number[]; max: number; adjustment?: number; score?: number }): ResolvedPartScore {
  const { points, max } = input;
  const sumPoints = round3(points.reduce((a, b) => a + b, 0));
  if (input.score !== undefined) {
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > max) {
      return { ok: false, field: 'score', message: `Enter a score between 0 and ${max} (this part is worth ${marksLabel(max)})` };
    }
    return { ok: true, score: round3(input.score), adjustment: round3(input.score - sumPoints), clamped: false };
  }
  const adjustment = input.adjustment ?? 0;
  if (!Number.isFinite(adjustment) || Math.abs(adjustment) > max) {
    return { ok: false, field: 'adjustment', message: `An adjustment can move the score by at most ${marksLabel(max)}` };
  }
  const r = rubricPartScore(points, adjustment, max);
  return { ok: true, score: r.score, adjustment: round3(adjustment), clamped: r.clamped };
}

/**
 * Re-scores a part after a rubric item's points change. If the stored score no longer matches the stored
 * rubric + adjustment (someone set it another way, e.g. a dispute resolution), the stored score is taken as
 * the truth and the adjustment is re-derived from it, so the edit applies as a delta instead of discarding it.
 */
export function rescorePart(input: {
  oldPoints: readonly number[];
  newPoints: readonly number[];
  adjustment: number;
  current: number | null;
  max: number;
}): { score: number; adjustment: number } {
  const expected = rubricPartScore(input.oldPoints, input.adjustment, input.max).score;
  let adjustment = input.adjustment;
  if (input.current !== null && Math.abs(expected - input.current) > 1e-9) {
    adjustment = round3(input.current - input.oldPoints.reduce((a, b) => a + b, 0));
  }
  return { score: rubricPartScore(input.newPoints, adjustment, input.max).score, adjustment };
}
