import type { Difficulty } from '@athena/shared';
import { createRng } from '../rng';
import { estimateP } from './difficulty';
import { selectPaper } from './select';
import type { PaperInput, PaperSelection, SelectableQuestion } from './types';

/** Above this many papers, overlap is estimated from a deterministic sample of pairs instead of all pairs. */
const EXACT_PAIR_LIMIT = 2_000;
const SAMPLED_PAIRS = 2_000;

export interface PaperSimulation {
  runs: number;
  /** Whether difficulty balancing was applied to the simulated papers. */
  balanced: boolean;
  tolerancePercent: number;
  /** Answer marks of every paper (constant for a well-formed exam). */
  totalMarks: number;
  /** Expected score of a purely random paper, in percent of total marks: the balancing target. */
  targetPercent: number;
  /** Expected score of each simulated paper, in percent of total marks, in run order. */
  papers: number[];
  spread: {
    meanPercent: number;
    stdDevPercent: number;
    minPercent: number;
    maxPercent: number;
    /** Share (0..1) of papers whose expected score is within tolerance of the target. */
    withinTolerance: number;
  };
  /** Jaccard similarity of the question sets of two papers (1 = identical papers). */
  overlap: { pairs: number; sampled: boolean; mean: number; min: number; max: number };
  /** How often each question appears across the simulated papers. */
  exposure: {
    questionId: string;
    sectionId: string;
    difficulty: Difficulty;
    expectedP: number;
    appearances: number;
    rate: number;
  }[];
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Monte Carlo view of the papers an exam can produce. Pure: the same input always gives the same report,
 * because run i uses seed `simulation:i` and pairs are sampled from a fixed seed.
 *
 * - `balanced` overrides the exam setting, so a report can compare random papers with balanced ones.
 * - Per-paper expected % shows how fair the difficulty is (spread around the target).
 * - Pairwise Jaccard overlap shows how different neighbours' papers are (all pairs, or a sample for large runs).
 * - Exposure shows how often each question is shown, i.e. how much any single leak would reveal.
 *
 * Only selection runs here (no option shuffles or variable draws), which keeps thousands of runs cheap.
 */
export function simulatePapers<Q extends SelectableQuestion>(
  input: PaperInput<Q>,
  runs: number,
  balanced: boolean,
): PaperSimulation {
  const count = Math.max(1, Math.floor(runs));
  const settings = {
    ...input.settings,
    fairness: { ...input.settings.fairness, balanceDifficulty: balanced },
  };
  const papers: PaperSelection<Q>[] = [];
  for (let i = 0; i < count; i++)
    papers.push(selectPaper({ ...input, settings }, `simulation:${i}`));

  const percents = papers.map((p) => p.paperExpected * 100);
  const mean = percents.reduce((a, b) => a + b, 0) / count;
  const variance = percents.reduce((a, b) => a + (b - mean) ** 2, 0) / count;

  const sets = papers.map((p) => new Set(p.items.map((i) => i.question.questionId)));
  const appearances = new Map<string, number>();
  for (const set of sets) for (const id of set) appearances.set(id, (appearances.get(id) ?? 0) + 1);

  const first = papers[0]!;
  return {
    runs: count,
    balanced,
    tolerancePercent: input.settings.fairness.tolerancePercent,
    totalMarks: first.totalMarks,
    targetPercent: round(first.targetExpected * 100),
    papers: percents.map((p) => round(p)),
    spread: {
      meanPercent: round(mean),
      stdDevPercent: round(Math.sqrt(variance)),
      minPercent: round(Math.min(...percents)),
      maxPercent: round(Math.max(...percents)),
      withinTolerance: round(papers.filter((p) => p.withinTolerance).length / count, 4),
    },
    overlap: pairwiseOverlap(sets),
    exposure: [...input.sections]
      .sort((a, b) => a.position - b.position)
      .flatMap((section) =>
        [...section.questions]
          .sort((a, b) => a.position - b.position)
          .map((q) => {
            const seen = appearances.get(q.questionId) ?? 0;
            return {
              questionId: q.questionId,
              sectionId: section.id,
              difficulty: q.difficulty,
              expectedP: round(estimateP(q), 4),
              appearances: seen,
              rate: round(seen / count, 4),
            };
          }),
      ),
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const id of a) if (b.has(id)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 1 : shared / union;
}

function pairwiseOverlap(sets: Set<string>[]): PaperSimulation['overlap'] {
  const n = sets.length;
  const allPairs = (n * (n - 1)) / 2;
  if (allPairs === 0) return { pairs: 0, sampled: false, mean: 1, min: 1, max: 1 };
  const values: number[] = [];
  if (allPairs <= EXACT_PAIR_LIMIT) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) values.push(jaccard(sets[i]!, sets[j]!));
  } else {
    const rng = createRng('simulation:pairs');
    for (let k = 0; k < SAMPLED_PAIRS; k++) {
      const i = rng.int(n);
      const j = (i + 1 + rng.int(n - 1)) % n; // any index except i
      values.push(jaccard(sets[i]!, sets[j]!));
    }
  }
  return {
    pairs: values.length,
    sampled: allPairs > EXACT_PAIR_LIMIT,
    mean: round(values.reduce((a, b) => a + b, 0) / values.length, 4),
    min: round(Math.min(...values), 4),
    max: round(Math.max(...values), 4),
  };
}
