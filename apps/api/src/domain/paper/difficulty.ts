import { DIFFICULTY_PRIOR } from '@athena/shared';
import type { SelectableQuestion } from './types';

/**
 * Weight of the author's difficulty label, in pseudo-attempts. A brand-new question is judged by its label;
 * after a few dozen real attempts the observed data dominates.
 */
export const PRIOR_WEIGHT = 10;

/**
 * Calibrated probability that a candidate answers the question correctly:
 *   p = (PRIOR_WEIGHT * prior + n * observedP) / (PRIOR_WEIGHT + n)
 * where prior comes from the difficulty label (DIFFICULTY_PRIOR) and observedP from real attempts.
 */
export function estimateP(
  q: Pick<SelectableQuestion, 'difficulty' | 'observedP' | 'observedN'>,
): number {
  const prior = DIFFICULTY_PRIOR[q.difficulty];
  const n = q.observedP === null ? 0 : Math.max(0, q.observedN);
  const observed = Math.min(1, Math.max(0, q.observedP ?? prior));
  return (PRIOR_WEIGHT * prior + n * observed) / (PRIOR_WEIGHT + n);
}

/** Expected marks a candidate earns on the question: marks x p. */
export const expectedMarks = (q: SelectableQuestion) => q.marks * estimateP(q);
