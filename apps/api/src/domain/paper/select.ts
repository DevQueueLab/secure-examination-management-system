import { DIFFICULTIES } from '@athena/shared';
import { createRng, type Rng } from '../rng';
import { estimateP, expectedMarks } from './difficulty';
import type {
  PaperInput,
  PaperSection,
  PaperSelection,
  SelectableQuestion,
  SelectedQuestion,
} from './types';

/** Upper bound on balancing swaps per paper. Every swap strictly reduces the gap, so this is a safety net. */
export const MAX_BALANCE_SWAPS = 200;
const EPS = 1e-9;

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** A pool section draws fewer questions than it holds ("draw N of M"). */
export const isPool = (s: PaperSection<SelectableQuestion>) =>
  s.drawCount !== null && s.drawCount < s.questions.length;

interface Pool<Q> {
  chosen: Q[];
  rest: Q[];
}

/**
 * Selects and orders one candidate's paper. Pure and deterministic: (input, seed) -> paper.
 *
 * 1. Draw. Fixed sections deliver every question. Pools draw `drawCount` questions with the seeded RNG:
 *    a plain random draw, or, when difficulty balancing is on, a draw stratified by difficulty label
 *    (each label gets its proportional share of the draw).
 * 2. Balance (setting on and at least one pool). The target is the expected score of a random paper:
 *    the fixed questions' marks x p plus, per pool, drawCount x mean(marks x p). While the paper's expected score
 *    is further than tolerancePercent of the total from the target, swap a drawn question for an undrawn one of
 *    the same pool and the same marks (so the total never changes). Among the swaps that reduce the gap, prefer
 *    ones that land within tolerance, then ones that keep the difficulty label, then pick one at random, so
 *    papers stay varied instead of converging on one "optimal" paper.
 * 3. Order. Questions are shuffled within their section when shuffleQuestions is on; sections keep their order.
 */
export function selectPaper<Q extends SelectableQuestion>(
  input: PaperInput<Q>,
  seed: string,
): PaperSelection<Q> {
  const rng = createRng(seed);
  const sections = [...input.sections].sort(byPosition);
  const balance = input.settings.fairness.balanceDifficulty && sections.some(isPool);

  const pools = new Map<string, Pool<Q>>();
  const fixed = new Map<string, Q[]>();
  let targetScore = 0;
  for (const section of sections) {
    const questions = [...section.questions].sort(byPosition);
    if (!isPool(section)) {
      fixed.set(section.id, questions);
      targetScore += sum(questions.map(expectedMarks));
      continue;
    }
    const k = Math.max(0, section.drawCount!);
    const chosen = balance ? stratifiedDraw(questions, k, rng) : rng.shuffle(questions).slice(0, k);
    pools.set(section.id, { chosen, rest: questions.filter((q) => !chosen.includes(q)) });
    targetScore += (k * sum(questions.map(expectedMarks))) / questions.length;
  }

  const drawn = () => [
    ...[...fixed.values()].flat(),
    ...[...pools.values()].flatMap((p) => p.chosen),
  ];
  const totalMarks = sum(drawn().map((q) => q.marks));
  const tolerance = (input.settings.fairness.tolerancePercent / 100) * totalMarks;
  let expectedScore = sum(drawn().map(expectedMarks));
  let swaps = 0;
  if (balance)
    ({ expectedScore, swaps } = balancePools(
      [...pools.values()],
      expectedScore,
      targetScore,
      tolerance,
      rng,
    ));

  const items: SelectedQuestion<Q>[] = [];
  for (const section of sections) {
    const chosen = fixed.get(section.id) ?? pools.get(section.id)!.chosen;
    const ordered = input.settings.shuffleQuestions
      ? rng.shuffle(chosen)
      : [...chosen].sort(byPosition);
    for (const question of ordered) {
      items.push({
        sectionId: section.id,
        position: items.length + 1,
        question,
        expectedP: estimateP(question),
      });
    }
  }

  return {
    items,
    totalMarks,
    expectedScore,
    targetScore,
    paperExpected: totalMarks > 0 ? expectedScore / totalMarks : 0,
    targetExpected: totalMarks > 0 ? targetScore / totalMarks : 0,
    balanced: balance,
    withinTolerance: Math.abs(expectedScore - targetScore) <= tolerance + EPS,
    swaps,
  };
}

/**
 * Draws k of the questions so every difficulty label receives its proportional share of the draw
 * (largest-remainder rounding, ties broken by the seed), choosing at random within each label.
 */
function stratifiedDraw<Q extends SelectableQuestion>(questions: Q[], k: number, rng: Rng): Q[] {
  const strata = DIFFICULTIES.map((d) => questions.filter((q) => q.difficulty === d)).filter(
    (s) => s.length > 0,
  );
  const exact = strata.map((s) => (k * s.length) / questions.length);
  const quota = exact.map((x) => Math.floor(x + EPS));
  let remaining = k - sum(quota);
  const byRemainder = strata
    .map((_, i) => ({ i, remainder: exact[i]! - quota[i]!, tieBreak: rng.next() }))
    .sort((a, b) => b.remainder - a.remainder || a.tieBreak - b.tieBreak);
  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    if (quota[i]! < strata[i]!.length) {
      quota[i]!++;
      remaining--;
    }
  }
  return strata.flatMap((stratum, i) => rng.shuffle(stratum).slice(0, quota[i]));
}

interface Swap<Q> {
  pool: Pool<Q>;
  out: number;
  in: number;
  next: number;
  sameLabel: boolean;
}

/** Swap optimizer (see selectPaper). Mutates the pools' chosen/rest lists and returns the new expected score. */
function balancePools<Q extends SelectableQuestion>(
  pools: Pool<Q>[],
  expected: number,
  target: number,
  tolerance: number,
  rng: Rng,
) {
  let current = expected;
  let swaps = 0;
  while (swaps < MAX_BALANCE_SWAPS && Math.abs(current - target) > tolerance + EPS) {
    const gap = Math.abs(current - target);
    const improving: Swap<Q>[] = [];
    for (const pool of pools) {
      pool.chosen.forEach((out, o) => {
        pool.rest.forEach((candidate, i) => {
          if (candidate.marks !== out.marks) return;
          const next = current - expectedMarks(out) + expectedMarks(candidate);
          if (Math.abs(next - target) < gap - EPS)
            improving.push({
              pool,
              out: o,
              in: i,
              next,
              sameLabel: candidate.difficulty === out.difficulty,
            });
        });
      });
    }
    if (improving.length === 0) break;
    const finishing = improving.filter((s) => Math.abs(s.next - target) <= tolerance + EPS);
    const tier = finishing.length > 0 ? finishing : improving;
    const keepsLabel = tier.filter((s) => s.sameLabel);
    const swap = rng.pick(keepsLabel.length > 0 ? keepsLabel : tier);
    const removed = swap.pool.chosen[swap.out]!;
    swap.pool.chosen[swap.out] = swap.pool.rest[swap.in]!;
    swap.pool.rest[swap.in] = removed;
    current = swap.next;
    swaps++;
  }
  return { expectedScore: current, swaps };
}
