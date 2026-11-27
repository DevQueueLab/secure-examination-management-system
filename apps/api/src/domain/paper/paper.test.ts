import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@athena/shared';
import {
  assemblePaper,
  estimateP,
  selectPaper,
  simulatePapers,
  type DeliverableQuestion,
  type PaperInput,
  type PaperSettings,
} from './index';

const settings = (
  over: Partial<PaperSettings['fairness']> = {},
  shuffle = true,
): PaperSettings => ({
  shuffleQuestions: shuffle,
  shuffleOptions: shuffle,
  fairness: { balanceDifficulty: true, tolerancePercent: 3, ...over },
});

let counter = 0;
function question(
  difficulty: Difficulty,
  marks: number,
  observedP: number | null = null,
  observedN = 0,
): DeliverableQuestion {
  const n = ++counter;
  return {
    questionId: `q${n}`,
    examQuestionId: `eq${n}`,
    questionVersionId: `v${n}`,
    type: 'single_choice',
    marks,
    difficulty,
    observedP,
    observedN,
    position: n,
    content: {
      stem: `Question ${n}`,
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
      ],
    },
    answerKey: { correct: 'b' },
  };
}

/** A realistic exam: a calibrated pool "draw 4 of 8" (2 marks each) and a fixed section. */
function exam(fairness: Partial<PaperSettings['fairness']> = {}): PaperInput<DeliverableQuestion> {
  return {
    settings: settings(fairness),
    sections: [
      {
        id: 'pool',
        position: 0,
        drawCount: 4,
        questions: [
          question('easy', 2, 0.92, 40),
          question('easy', 2, 0.86, 40),
          question('easy', 2, 0.8, 30),
          question('medium', 2, 0.62, 30),
          question('medium', 2, 0.55, 30),
          question('hard', 2, 0.38, 30),
          question('hard', 2, 0.25, 30),
          question('hard', 2, 0.18, 30),
        ],
      },
      {
        id: 'fixed',
        position: 1,
        drawCount: null,
        questions: [question('medium', 3), question('hard', 3), question('easy', 3)],
      },
    ],
  };
}

const ids = (input: PaperInput<DeliverableQuestion>, seed: string) =>
  selectPaper(input, seed).items.map((i) => i.question.questionId);
const seeds = (n: number) => Array.from({ length: n }, (_, i) => `seed-${i}`);

describe('difficulty estimate', () => {
  it('uses the label prior until real attempts exist', () => {
    expect(estimateP({ difficulty: 'easy', observedP: null, observedN: 0 })).toBeCloseTo(0.8);
    expect(estimateP({ difficulty: 'hard', observedP: null, observedN: 0 })).toBeCloseTo(0.4);
  });
  it('blends prior and observed data by sample size', () => {
    // (10 * 0.6 + 10 * 0.2) / 20
    expect(estimateP({ difficulty: 'medium', observedP: 0.2, observedN: 10 })).toBeCloseTo(0.4);
    expect(estimateP({ difficulty: 'medium', observedP: 0.2, observedN: 990 })).toBeCloseTo(
      0.204,
      3,
    );
  });
});

describe('paper selection', () => {
  const input = exam();

  it('is deterministic per seed', () => {
    expect(ids(input, 'cand-1')).toEqual(ids(input, 'cand-1'));
    expect(selectPaper(input, 'cand-1')).toEqual(selectPaper(input, 'cand-1'));
  });

  it('keeps the paper total and size constant', () => {
    for (const seed of seeds(200)) {
      const paper = selectPaper(input, seed);
      expect(paper.totalMarks).toBe(17);
      expect(paper.items).toHaveLength(7);
      expect(new Set(paper.items.map((i) => i.question.questionId)).size).toBe(7);
      expect(paper.items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('keeps sections in order and draws pool questions only into their own section', () => {
    const paper = selectPaper(input, 'cand-2');
    expect(paper.items.slice(0, 4).every((i) => i.sectionId === 'pool')).toBe(true);
    expect(paper.items.slice(4).every((i) => i.sectionId === 'fixed')).toBe(true);
  });

  it('puts every balanced paper within tolerance of the random-paper target', () => {
    for (const seed of seeds(300)) {
      const paper = selectPaper(input, seed);
      expect(paper.balanced).toBe(true);
      expect(paper.withinTolerance).toBe(true);
      expect(Math.abs(paper.expectedScore - paper.targetScore)).toBeLessThanOrEqual(
        0.03 * paper.totalMarks + 1e-9,
      );
    }
  });

  it('still produces different papers for different candidates', () => {
    const distinctSets = new Set(seeds(100).map((s) => [...ids(input, s)].sort().join(',')));
    expect(distinctSets.size).toBeGreaterThan(10);
    const distinctOrders = new Set(seeds(100).map((s) => ids(input, s).join(',')));
    expect(distinctOrders.size).toBeGreaterThan(distinctSets.size);
  });

  it('keeps authoring order when shuffling is off', () => {
    const fixedOrder: PaperInput<DeliverableQuestion> = { ...input, settings: settings({}, false) };
    const positions = selectPaper(fixedOrder, 'cand-3').items.map((i) => i.question.position);
    expect(positions.slice(0, 4)).toEqual([...positions.slice(0, 4)].sort((a, b) => a - b));
    expect(positions.slice(4)).toEqual([...positions.slice(4)].sort((a, b) => a - b));
  });

  it('does a plain random draw when balancing is off', () => {
    const off = exam({ balanceDifficulty: false });
    const paper = selectPaper(off, 'cand-4');
    expect(paper.balanced).toBe(false);
    expect(paper.swaps).toBe(0);
  });

  it('delivers every question of an exam without pools and does not balance', () => {
    const fixedOnly: PaperInput<DeliverableQuestion> = {
      settings: settings(),
      sections: [
        {
          id: 's',
          position: 0,
          drawCount: null,
          questions: [question('easy', 1), question('hard', 1)],
        },
      ],
    };
    const paper = selectPaper(fixedOnly, 'x');
    expect(paper.items).toHaveLength(2);
    expect(paper.balanced).toBe(false);
    expect(paper.paperExpected).toBeCloseTo((0.8 + 0.4) / 2);
  });
});

describe('paper assembly', () => {
  const input = exam();

  it('prepares each item deterministically from its own stream and never exposes the key in content', () => {
    const a = assemblePaper(input, 'cand-9');
    const b = assemblePaper(input, 'cand-9');
    expect(a.items.map((i) => i.prepared)).toEqual(b.items.map((i) => i.prepared));
    for (const item of a.items) {
      expect(JSON.stringify(item.prepared.content)).not.toMatch(/correct|answerKey/);
      expect(item.prepared.answerKey).toEqual({ correct: 'b' });
    }
  });

  it('reports the expected score as a fraction of the paper total', () => {
    const paper = assemblePaper(input, 'cand-10');
    expect(paper.paperExpected).toBeCloseTo(paper.expectedScore / 17);
    expect(paper.paperExpected).toBeGreaterThan(0);
    expect(paper.paperExpected).toBeLessThan(1);
  });
});

describe('paper simulation', () => {
  const input = exam({ tolerancePercent: 2 });

  it('is pure: the same input gives the same report', () => {
    expect(simulatePapers(input, 120, true)).toEqual(simulatePapers(input, 120, true));
  });

  it('shows balancing narrows the difficulty spread while papers still vary', () => {
    const random = simulatePapers(input, 400, false);
    const balanced = simulatePapers(input, 400, true);
    expect(balanced.targetPercent).toBeCloseTo(random.targetPercent);
    expect(balanced.spread.stdDevPercent).toBeLessThan(random.spread.stdDevPercent / 2);
    expect(balanced.spread.withinTolerance).toBe(1);
    expect(random.spread.withinTolerance).toBeLessThan(1);
    expect(balanced.overlap.max).toBeLessThanOrEqual(1);
    expect(balanced.overlap.min).toBeLessThan(1);
  });

  it('reports exposure that adds up to the paper size', () => {
    const report = simulatePapers(input, 200, true);
    const perPaper = report.exposure.reduce((a, e) => a + e.rate, 0);
    expect(perPaper).toBeCloseTo(7, 2);
    expect(report.exposure.filter((e) => e.sectionId === 'fixed').every((e) => e.rate === 1)).toBe(
      true,
    );
    expect(
      report.exposure.filter((e) => e.sectionId === 'pool').every((e) => e.rate > 0 && e.rate < 1),
    ).toBe(true);
  });

  it('samples overlap pairs for large runs', () => {
    const report = simulatePapers(input, 100, true);
    expect(report.overlap.sampled).toBe(true);
    expect(report.overlap.pairs).toBe(2000);
    const small = simulatePapers(input, 20, true);
    expect(small.overlap).toMatchObject({ sampled: false, pairs: 190 });
  });
});
