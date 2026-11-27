import { describe, expect, it } from 'vitest';
import { analyzeItems, computeReliability, type AttemptRecord, type ItemDefinition, type ItemObservation } from './item-analysis';
import { cronbachAlpha, discriminationIndex, histogram, kr20, mean, median, pearson, percentileRank, pointBiserial, sampleSd } from './stats';

// A Guttman-style 0/1 matrix: 5 people x 4 items. p = .8 .6 .4 .2, Σpq = 0.8, σ²(total) = 2.
const GUTTMAN = [
  [1, 1, 1, 1],
  [1, 1, 1, 0],
  [1, 1, 0, 0],
  [1, 0, 0, 0],
  [0, 0, 0, 0],
];

describe('descriptive statistics', () => {
  it('mean, median and sample SD', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(mean([])).toBeNull();
  });

  it('histogram puts 100% in the last bin and ignores nothing else', () => {
    const bins = histogram([0, 9.99, 10, 55, 100]);
    expect(bins).toHaveLength(10);
    expect(bins[0]!.count).toBe(2);
    expect(bins[1]!.count).toBe(1);
    expect(bins[5]!.count).toBe(1);
    expect(bins[9]!.count).toBe(1);
  });

  it('percentile rank counts ties as half', () => {
    expect(percentileRank(50, [10, 50, 50, 90])).toBe(50);
    expect(percentileRank(90, [10, 50, 50, 90])).toBe(87.5);
  });
});

describe('KR-20 and Cronbach alpha', () => {
  it('KR-20 matches the hand calculation: 4/3 × (1 − 0.8/2) = 0.8', () => {
    expect(kr20(GUTTMAN)).toBeCloseTo(0.8, 10);
  });

  it('alpha equals KR-20 for dichotomous items', () => {
    expect(cronbachAlpha(GUTTMAN)).toBeCloseTo(kr20(GUTTMAN)!, 10);
  });

  it('alpha for partial credit: k=2, item variances 2/3 + 2/3, total variance 8/3 → 1', () => {
    // Two perfectly parallel items scored 0..2.
    expect(cronbachAlpha([[0, 0], [1, 1], [2, 2]])).toBeCloseTo(1, 10);
  });

  it('is undefined without variance or with too few items', () => {
    expect(kr20([[1, 1], [1, 1]])).toBeNull();
    expect(kr20([[1], [0]])).toBeNull();
  });
});

describe('point-biserial', () => {
  it('equals Pearson r against the rest score: 2/√5', () => {
    expect(pointBiserial([1, 1, 0, 0], [4, 3, 2, 1])).toBeCloseTo(2 / Math.sqrt(5), 10);
  });

  it('is negative when weaker candidates get the item right', () => {
    expect(pointBiserial([0, 0, 1, 1], [4, 3, 2, 1])!).toBeLessThan(0);
  });

  it('is null when the item has no variance', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('discrimination index (upper 27% − lower 27%)', () => {
  const ranked = (items: number[]) => items.map((item, i) => ({ item, total: 100 - i * 10 }));

  it('is 1 when only the strongest get it right', () => {
    expect(discriminationIndex(ranked([1, 1, 1, 1, 1, 0, 0, 0, 0, 0]))!.d).toBe(1);
  });

  it('is −1 when only the weakest get it right', () => {
    expect(discriminationIndex(ranked([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]))!.d).toBe(-1);
  });

  it('uses groups of round(27% × n): 3 of 10', () => {
    const r = discriminationIndex(ranked([1, 0, 1, 0, 0, 0, 0, 1, 0, 0]))!;
    expect(r.groupSize).toBe(3);
    expect(r.d).toBeCloseTo(1 / 3, 10);
  });

  it('needs at least four people', () => {
    expect(discriminationIndex(ranked([1, 0, 1]))).toBeNull();
  });
});

describe('item analysis', () => {
  // Ten candidates. Q1 is keyed o1, but the strongest candidates all chose o2: a classic miskey.
  const attempts: AttemptRecord[] = Array.from({ length: 10 }, (_, i) => ({ attemptId: `a${i}`, score: 10 - i, max: 10, complete: true }));
  const def: ItemDefinition = {
    questionId: 'q1',
    label: 'Q1',
    number: 1,
    title: 'Heap parent',
    type: 'single_choice',
    category: 'Data Structures',
    options: [
      { id: 'o1', text: 'i/2' },
      { id: 'o2', text: '2i' },
      { id: 'o3', text: 'i-1' },
    ],
    correct: ['o1'],
  };
  const picks = ['o2', 'o2', 'o2', 'o1', 'o2', 'o1', 'o1', 'o3', 'o1', 'o1'];
  const obs: ItemObservation[] = picks.map((p, i) => ({
    attemptId: `a${i}`,
    score: p === 'o1' ? 1 : 0,
    max: 1,
    answered: true,
    flagged: false,
    timeSpentMs: 30_000,
    selected: [p],
    sectionId: null,
  }));

  it('flags a probable miskey and negative discrimination', () => {
    const [a] = analyzeItems([def], new Map([['q1', obs]]), attempts);
    expect(a!.discrimination!).toBeLessThan(0);
    const kinds = a!.insights.map((i) => i.kind);
    expect(kinds).toContain('miskey');
    expect(kinds).toContain('negative_discrimination');
    const miskey = a!.insights.find((i) => i.kind === 'miskey')!;
    expect(miskey.detail).toMatch(/chose B more often than the key A/);
  });

  it('counts distractor selections overall and per group', () => {
    const [a] = analyzeItems([def], new Map([['q1', obs]]), attempts);
    const d = a!.distractors!;
    expect(d.upperSize).toBe(3);
    expect(d.options.find((o) => o.id === 'o2')!.upper).toBe(3);
    expect(d.options.find((o) => o.id === 'o1')!.lower).toBe(2);
    expect(d.options.find((o) => o.isKey)!.letter).toBe('A');
  });

  it('chooses KR-20 for 0/1 items and alpha for partial credit', () => {
    const two = (score: (i: number) => number, max: number): ItemObservation[] =>
      attempts.map((a, i) => ({ attemptId: a.attemptId, score: score(i), max, answered: true, flagged: false, timeSpentMs: 0, selected: null, sectionId: null }));
    const defs: ItemDefinition[] = [
      { ...def, questionId: 'x', type: 'true_false', options: null, correct: null },
      { ...def, questionId: 'y', type: 'true_false', options: null, correct: null },
    ];
    const binary = new Map([
      ['x', two((i) => (i < 6 ? 1 : 0), 1)],
      ['y', two((i) => (i < 4 ? 1 : 0), 1)],
    ]);
    expect(computeReliability(defs, binary, attempts).method).toBe('KR-20');
    const partial = new Map([
      ['x', two((i) => (i < 6 ? 2 : 1), 2)],
      ['y', two((i) => (i < 4 ? 1 : 0), 1)],
    ]);
    expect(computeReliability(defs, partial, attempts).method).toBe('Cronbach alpha');
  });
});
