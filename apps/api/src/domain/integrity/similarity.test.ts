import { encodeFingerprint } from '@athena/shared';
import { describe as group, expect, it } from 'vitest';
import {
  analyzeObjective,
  analyzeWritten,
  itemContentKey,
  jaccard,
  normalizeText,
  responseKey,
  shingles,
  type ObjectiveResponse,
} from './similarity';

const options = [
  { id: 'o1', text: '0.2 m/s²' },
  { id: 'o2', text: '5 m/s²' },
  { id: 'o3', text: '12 m/s²' },
  { id: 'o4', text: '20 m/s²' },
];

group('canonical keys', () => {
  it('treats shuffled option orders as the same item but different variant numbers as different items', () => {
    const a = itemContentKey('single_choice', { stem: 'A net force of 10 N acts on a 2 kg mass.', options });
    const b = itemContentKey('single_choice', { stem: 'A net force of 10 N acts on a 2 kg mass.', options: [...options].reverse() });
    expect(a).toBe(b);
    const v1 = itemContentKey('numeric', { stem: 'Rest to 18 m/s in 6 s.', unit: 'm/s²' });
    const v2 = itemContentKey('numeric', { stem: 'Rest to 20 m/s in 5 s.', unit: 'm/s²' });
    expect(v1).not.toBe(v2);
  });

  it('normalizes responses so equal answers compare equal', () => {
    expect(responseKey('multiple_choice', { optionIds: ['o3', 'o1'] })).toBe(responseKey('multiple_choice', { optionIds: ['o1', 'o3'] }));
    expect(responseKey('numeric', { value: ' 3.50 ' })).toBe('3.5');
    expect(responseKey('short_text', { text: '  A   Stack ' })).toBe('a stack');
    expect(responseKey('single_choice', { optionId: null })).toBeNull();
    expect(responseKey('long_text', { text: 'essay' })).toBeNull();
  });
});

/**
 * 22 candidates, 8 shared items. Everyone answers mostly right with a few scattered, common mistakes;
 * candidates 3 and 17 share four rare wrong answers within a minute of each other.
 */
function cohort(): ObjectiveResponse[] {
  const out: ObjectiveResponse[] = [];
  const base = new Date('2026-11-24T07:00:00Z').getTime();
  const ids = Array.from({ length: 22 }, (_, i) => `att-${String(i).padStart(2, '0')}`);
  for (let item = 0; item < 8; item++) {
    ids.forEach((attemptId, c) => {
      // A common mistake on every item: about a quarter of the class gives wrong answer "w-common".
      const commonMistake = (c + item) % 4 === 0;
      let responseKey = commonMistake ? 'w-common' : 'right';
      let correct = !commonMistake;
      if ((c === 3 || c === 17) && item < 4) {
        responseKey = `w-rare-${item}`;
        correct = false;
      }
      out.push({ attemptId, itemKey: `item-${item}`, responseKey, correct, answeredAt: new Date(base + item * 300_000 + (c === 17 ? 40_000 : c * 7_000)) });
    });
  }
  return out;
}

group('analyzeObjective', () => {
  it('flags the pair sharing rare wrong answers and nobody else', () => {
    const { pairs, distribution } = analyzeObjective(cohort());
    const flagged = pairs.filter((p) => p.flagged);
    expect(flagged).toHaveLength(1);
    const pair = flagged[0]!;
    expect([pair.a, pair.b]).toEqual(['att-03', 'att-17']);
    expect(pair.sharedWrong).toHaveLength(4);
    expect(pair.sharedWrong[0]!.weight).toBeCloseTo(-Math.log(2 / 22), 3);
    expect(pair.sharedWrong[0]!.share).toBeCloseTo(2 / 22, 4);
    expect(pair.comparableItems).toBe(8);
    expect(pair.z!).toBeGreaterThan(3);
    expect(pair.within2Min).toBe(1);
    expect(distribution.pairs).toBe(231);
    expect(distribution.enough).toBe(true);
  });

  it('does not flag pairs who share only common mistakes', () => {
    const { pairs } = analyzeObjective(cohort());
    const common = pairs.find((p) => p.a === 'att-00' && p.b === 'att-04');
    expect(common?.sharedWrong.every((w) => w.responseKey === 'w-common')).toBe(true);
    expect(common?.flagged).toBe(false);
  });

  it('only compares candidates who saw the same item content', () => {
    const responses: ObjectiveResponse[] = cohort().map((r) =>
      // Candidate 17 saw different variant numbers on every item: their answers cannot match candidate 3's.
      r.attemptId === 'att-17' ? { ...r, itemKey: `${r.itemKey}-variant-b` } : r,
    );
    const { pairs } = analyzeObjective(responses);
    expect(pairs.find((p) => p.a === 'att-03' && p.b === 'att-17')).toBeUndefined();
  });

  it('counts the same wrong number given on papers with different parameter values', () => {
    const base = cohort().filter((r) => r.itemKey !== 'item-0' && r.itemKey !== 'item-1');
    // Items 0 and 1 are parameterized: odd candidates got variant b. Candidates 3 and 17 sit on different variants
    // yet both answered 7.35, which is wrong for both papers.
    const parameterized: ObjectiveResponse[] = cohort()
      .filter((r) => r.itemKey === 'item-0' || r.itemKey === 'item-1')
      .map((r) => {
        const c = Number(r.attemptId.slice(-2));
        const variant = c % 2 ? 'b' : 'a';
        const copied = c === 3 || c === 17;
        return {
          ...r,
          itemKey: `${r.itemKey}-${variant}`,
          questionKey: r.itemKey,
          responseKey: copied ? '7.35' : r.correct ? `right-${variant}` : r.responseKey,
          correct: copied ? false : r.correct,
        };
      });
    // 3 is odd (variant b) and 17 is odd too: move 17 to variant a so their numbers differ.
    for (const r of parameterized) if (r.attemptId === 'att-17') r.itemKey = r.itemKey.replace(/-b$/, '-a');
    const { pairs } = analyzeObjective([...base, ...parameterized]);
    const pair = pairs.find((p) => p.a === 'att-03' && p.b === 'att-17')!;
    const cross = pair.sharedWrong.filter((w) => w.crossVariant);
    expect(cross).toHaveLength(2);
    expect(cross[0]!.itemKeyB).not.toBe(cross[0]!.itemKey);
    expect(pair.flagged).toBe(true);
  });

  it('returns no z-score for a cohort too small to compare', () => {
    const tiny = cohort().filter((r) => ['att-03', 'att-17', 'att-05'].includes(r.attemptId));
    const { pairs, distribution } = analyzeObjective(tiny);
    expect(distribution.enough).toBe(false);
    expect(pairs.every((p) => p.z === null && !p.flagged)).toBe(true);
  });
});

group('written similarity', () => {
  const working =
    'Using v = u + at with u = 0, the acceleration is a = v / t. Substituting the values gives a = 18 / 6 = 3 m/s squared, directed forward.';

  it('normalizes case, punctuation, whitespace and strips fingerprints, keeping offsets', () => {
    const text = `Hello,   World!${encodeFingerprint('7F3K9Q')} Again`;
    const t = normalizeText(text);
    expect(t.norm).toBe('hello world again');
    expect(text.slice(t.map[6]!, t.map[10]! + 1)).toBe('World');
  });

  it('flags near-identical working and returns the shared passages in original offsets', () => {
    const copy = working.replace('18 / 6 = 3', '20 / 5 = 4').replace('directed forward', 'in the forward direction');
    const { pairs } = analyzeWritten([
      { attemptId: 'att-03', groupKey: 'q1:working', text: working },
      { attemptId: 'att-17', groupKey: 'q1:working', text: copy },
      { attemptId: 'att-09', groupKey: 'q1:working', text: 'I divided the final speed by the time it took because the car started from rest, so the change in speed is just the final speed.' },
    ]);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0]!;
    expect(pair.jaccard).toBeGreaterThan(0.45);
    const firstPassage = working.slice(pair.aPassages[0]!.start, pair.aPassages[0]!.end);
    expect(firstPassage.startsWith('Using v = u + at')).toBe(true);
    expect(pair.bPassages.length).toBeGreaterThan(0);
  });

  it('ignores short texts and wording that every candidate was given', () => {
    const stem = 'Explain the difference between a process and a thread and give one situation where threads are preferable.';
    const restated = `${stem} `;
    const { pairs } = analyzeWritten([
      { attemptId: 'a', groupKey: 'q', baseline: stem, text: `${restated}Threads share memory so they are cheap to create and switch between.` },
      { attemptId: 'b', groupKey: 'q', baseline: stem, text: `${restated}A process is isolated; a crash in one does not take the others down with it.` },
      { attemptId: 'c', groupKey: 'q', text: 'Too short to compare.' },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('computes Jaccard over shingle sets', () => {
    expect(jaccard(shingles('abcdefg'), shingles('abcdefg'))).toBe(1);
    expect(jaccard(shingles('abcdefg'), shingles('zzzzzzz'))).toBe(0);
  });
});
