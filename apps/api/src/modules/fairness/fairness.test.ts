import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@athena/shared';
import { simulatePapers, type PaperInput, type SelectableQuestion } from '../../domain/paper';
import {
  deviationFrom,
  distinctPapers,
  jaccardToSharedShare,
  needsRecalibration,
  observedItemP,
  observedPaperPercent,
  percentile,
  sharedHistogram,
  spreadOf,
} from './fairness.math';
import { buildSimulationReport } from './fairness.report';

let counter = 0;
const q = (difficulty: Difficulty, marks: number, observedP: number | null = null, observedN = 0): SelectableQuestion => ({
  questionId: `q${++counter}`,
  marks,
  difficulty,
  observedP,
  observedN,
  position: counter,
});

/** "Draw 4 of 8" two-mark pool with a wide difficulty range, plus a fixed section (like the DS midterm). */
function poolExam(): PaperInput {
  return {
    settings: { shuffleQuestions: true, shuffleOptions: true, fairness: { balanceDifficulty: true, tolerancePercent: 3 } },
    sections: [
      {
        id: 'pool',
        position: 0,
        drawCount: 4,
        questions: [q('easy', 2, 0.95, 40), q('easy', 2, 0.9, 40), q('easy', 2, 0.82, 30), q('medium', 2, 0.6, 30), q('medium', 2, 0.52, 30), q('hard', 2, 0.35, 30), q('hard', 2, 0.22, 30), q('hard', 2, 0.15, 30)],
      },
      { id: 'fixed', position: 1, drawCount: null, questions: [q('medium', 3), q('hard', 3), q('easy', 3)] },
    ],
  };
}

const meta = (input: PaperInput) =>
  new Map(
    input.sections.flatMap((s) =>
      s.questions.map((x, i) => [x.questionId, { questionId: x.questionId, label: `Q${i + 1}`, title: `Question ${x.questionId}`, type: 'single_choice' as const, difficulty: x.difficulty, sectionTitle: s.id }]),
    ),
  );

describe('statistics', () => {
  it('spread uses the population standard deviation and the range', () => {
    expect(spreadOf([50, 52, 54])).toEqual({ meanPercent: 52, sdPercent: 1.63, minPercent: 50, maxPercent: 54, rangePercent: 4 });
    expect(spreadOf([])).toEqual({ meanPercent: 0, sdPercent: 0, minPercent: 0, maxPercent: 0, rangePercent: 0 });
  });

  it('percentile is nearest-rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 1)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('deviation reports the worst paper and the 95th percentile around the target', () => {
    const papers = [...Array.from({ length: 19 }, () => 60), 70];
    expect(deviationFrom(papers, 61)).toEqual({ maxPercent: 9, p95Percent: 1 });
  });

  it('converts the Jaccard index of equal-sized papers into the share of shared questions', () => {
    // Two 10-question papers sharing 4: J = 4 / 16 = 0.25 and the share is 4 / 10.
    expect(jaccardToSharedShare(0.25)).toBeCloseTo(0.4, 6);
    expect(jaccardToSharedShare(1)).toBe(1);
    expect(jaccardToSharedShare(0)).toBe(0);
  });
});

describe('shared histogram', () => {
  it('puts both series on one grid with nice edges', () => {
    const { binWidth, bins } = sharedHistogram({ balanced: [59.6, 60.1, 60.4], random: [52.2, 60, 67.9] });
    expect(binWidth).toBe(1);
    expect(bins[0]!.from).toBe(52);
    expect(bins.at(-1)!.to).toBe(68);
    expect(bins.reduce((n, b) => n + b.counts.balanced!, 0)).toBe(3);
    expect(bins.reduce((n, b) => n + b.counts.random!, 0)).toBe(3);
    expect(bins.find((b) => b.from === 60)!.counts).toEqual({ balanced: 2, random: 1 });
  });

  it('keeps the bin count bounded for wide ranges and handles a single value', () => {
    expect(sharedHistogram({ a: [0, 100] }, 28).bins.length).toBeLessThanOrEqual(28);
    const single = sharedHistogram({ a: [55, 55], b: [55] });
    expect(single.bins).toHaveLength(1);
    expect(single.bins[0]!.counts).toEqual({ a: 2, b: 1 });
    expect(sharedHistogram({ a: [] }).bins).toEqual([]);
  });
});

describe('post-exam audit', () => {
  it('measures difficulty on answer marks, clamping negative marking and skipping ungraded parts', () => {
    const p = observedItemP([
      { attemptId: 'a', questionId: 'x', marks: 2, score: 2 },
      { attemptId: 'b', questionId: 'x', marks: 2, score: -0.5 },
      { attemptId: 'c', questionId: 'x', marks: 2, score: 1 },
      { attemptId: 'a', questionId: 'essay', marks: 6, score: null },
    ]);
    expect(p.get('x')).toEqual({ questionId: 'x', n: 3, p: 0.5 });
    expect(p.has('essay')).toBe(false);
  });

  it('scores a paper with the observed p-values of its own questions', () => {
    const p = new Map([
      ['x', { questionId: 'x', n: 10, p: 0.9 }],
      ['y', { questionId: 'y', n: 10, p: 0.3 }],
    ]);
    expect(observedPaperPercent([{ questionId: 'x', marks: 2 }, { questionId: 'y', marks: 2 }], p)).toBe(60);
    expect(observedPaperPercent([{ questionId: 'x', marks: 1 }, { questionId: 'y', marks: 3 }], p)).toBe(45);
    expect(observedPaperPercent([{ questionId: 'z', marks: 2 }], p)).toBeNull();
  });

  it('flags a question only when the gap is large and the sample is big enough', () => {
    expect(needsRecalibration(0.45, 0.8, 22)).toBe(true);
    expect(needsRecalibration(0.65, 0.8, 22)).toBe(false);
    expect(needsRecalibration(0.2, 0.8, 4)).toBe(false);
  });

  it('counts distinct papers regardless of question order', () => {
    const a = [{ questionId: 'x', marks: 1 }, { questionId: 'y', marks: 1 }];
    const b = [{ questionId: 'y', marks: 1 }, { questionId: 'x', marks: 1 }];
    expect(distinctPapers([a, b])).toBe(1);
    expect(distinctPapers([a, [{ questionId: 'z', marks: 1 }]])).toBe(2);
  });
});

describe('simulation report', () => {
  it('shows balanced papers spread far less than random ones while still varying', () => {
    const input = poolExam();
    const report = buildSimulationReport({
      sections: input.sections,
      sectionTitles: new Map([['pool', 'Fundamentals'], ['fixed', 'Problem solving']]),
      questions: meta(input),
      balanced: simulatePapers(input, 400, true),
      random: simulatePapers(input, 400, false),
    });
    expect(report.hasPools).toBe(true);
    expect(report.pools).toEqual([{ sectionId: 'pool', title: 'Fundamentals', drawCount: 4, poolSize: 8 }]);
    expect(report.calibration).toEqual({ priorWeight: 10, labelPriors: { easy: 0.8, medium: 0.6, hard: 0.4 } });
    expect(report.tolerance.holdsForShare).toBe(0.95);
    expect(report.questionsPerPaper).toBe(7);
    // Balancing stops once a paper is inside the ±3% band, so every balanced paper lands in it; random ones do not.
    expect(report.balanced.spread.sdPercent).toBeLessThan(report.random.spread.sdPercent);
    expect(report.balanced.deviation.maxPercent).toBeLessThanOrEqual(3);
    expect(report.random.deviation.maxPercent).toBeGreaterThan(3);
    expect(report.tolerance.balancedShare).toBe(1);
    expect(report.tolerance.randomShare).toBeLessThan(1);
    expect(report.tolerance.achievable).toBe(true);
    expect(report.tolerance.holdsAtPercent).toBeLessThanOrEqual(3);
    // Papers still differ: two papers do not share every question.
    expect(report.balanced.overlap.sharedShare).toBeLessThan(0.95);
    expect(report.balanced.overlap.sharedShare).toBeGreaterThan(0);
    // One grid for both series, every paper counted once per series.
    const totals = report.histogram.bins.reduce((t, b) => ({ balanced: t.balanced + b.balanced, random: t.random + b.random }), { balanced: 0, random: 0 });
    expect(totals).toEqual({ balanced: 400, random: 400 });
    // Fixed questions sit on every paper; pool questions are drawn 4 times in 8 on average.
    const fixed = report.exposure.filter((e) => !e.pooled);
    expect(fixed.every((e) => e.balancedRate === 1 && e.randomRate === 1)).toBe(true);
    const pooled = report.exposure.filter((e) => e.pooled);
    expect(pooled.every((e) => e.uniformRate === 0.5)).toBe(true);
    const meanRate = pooled.reduce((n, e) => n + e.balancedRate, 0) / pooled.length;
    expect(meanRate).toBeCloseTo(0.5, 6);
  });

  it('reports no pools and zero spread for an exam where everyone gets the same questions', () => {
    const input: PaperInput = {
      settings: poolExam().settings,
      sections: [{ id: 'fixed', position: 0, drawCount: null, questions: [q('easy', 2), q('hard', 3)] }],
    };
    const report = buildSimulationReport({
      sections: input.sections,
      sectionTitles: new Map([['fixed', 'Mechanics']]),
      questions: meta(input),
      balanced: simulatePapers(input, 100, true),
      random: simulatePapers(input, 100, false),
    });
    expect(report.hasPools).toBe(false);
    expect(report.balanced.spread.sdPercent).toBe(0);
    expect(report.random.spread.rangePercent).toBe(0);
    expect(report.balanced.overlap.sharedShare).toBe(1);
  });
});
