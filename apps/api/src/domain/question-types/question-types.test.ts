import { describe, expect, it } from 'vitest';
import { DEFAULT_EXAM_SETTINGS, type MarkingScheme } from '@athena/shared';
import { createRng } from '../rng';
import { parseNumber } from './numeric';
import { questionType } from './registry';
import { longestOrderedRun } from './structured';

const scheme = (over: Partial<MarkingScheme> = {}): MarkingScheme => ({ ...DEFAULT_EXAM_SETTINGS.marking, ...over });
const opts = (...ids: string[]) => ids.map((id) => ({ id, text: id.toUpperCase() }));

describe('multiple select schemes', () => {
  const h = questionType('multiple_choice');
  const prepared = h.prepare({ stem: 'Pick primes', options: opts('a', 'b', 'c', 'd', 'e') }, { correct: ['a', 'b'] }, {
    rng: createRng('s'),
    shuffleOptions: false,
  });
  const key = prepared.answerKey;

  it('all_or_nothing gives credit only for the exact set', () => {
    expect(h.grade(key, { optionIds: ['a', 'b'] }, 4, scheme({ multiSelect: 'all_or_nothing' })).score).toBe(4);
    expect(h.grade(key, { optionIds: ['a'] }, 4, scheme({ multiSelect: 'all_or_nothing' })).score).toBe(0);
  });
  it('partial gives per-pick credit but zero when any wrong option is picked', () => {
    expect(h.grade(key, { optionIds: ['a'] }, 4, scheme({ multiSelect: 'partial' })).score).toBe(2);
    expect(h.grade(key, { optionIds: ['a', 'c'] }, 4, scheme({ multiSelect: 'partial' })).score).toBe(0);
  });
  it('partial_penalty subtracts wrong picks and floors at zero; picking everything earns nothing', () => {
    expect(h.grade(key, { optionIds: ['a', 'b', 'c'] }, 6, scheme({ multiSelect: 'partial_penalty' })).score).toBe(4);
    expect(h.grade(key, { optionIds: ['a', 'b', 'c', 'd', 'e'] }, 6, scheme()).score).toBe(0);
  });
  it('blank answers score zero', () => {
    expect(h.grade(key, { optionIds: [] }, 4, scheme()).score).toBe(0);
  });
});

describe('single choice', () => {
  const h = questionType('single_choice');
  it('applies negative marking only to wrong answers', () => {
    const key = { correct: 'b' };
    expect(h.grade(key, { optionId: 'b' }, 2, scheme({ negativeMarking: 0.25 })).score).toBe(2);
    expect(h.grade(key, { optionId: 'a' }, 2, scheme({ negativeMarking: 0.25 })).score).toBe(-0.5);
    expect(h.grade(key, { optionId: null }, 2, scheme({ negativeMarking: 0.25 })).score).toBe(0);
  });
  it('rejects a key pointing at a missing option', () => {
    expect(() => h.validateDraft({ stem: 'Q', options: opts('a', 'b') }, { correct: 'z' })).toThrow(/correct/i);
  });
  it('shuffles options deterministically per seed', () => {
    const c = { stem: 'Q', options: opts('a', 'b', 'c', 'd') };
    const one = h.prepare(c, { correct: 'a' }, { rng: createRng('seed-1'), shuffleOptions: true }).variant;
    const two = h.prepare(c, { correct: 'a' }, { rng: createRng('seed-1'), shuffleOptions: true }).variant;
    expect(one).toEqual(two);
  });
});

describe('numeric', () => {
  const h = questionType('numeric');
  it('parses human number formats', () => {
    expect(parseNumber(' 1,250.5 ')).toBe(1250.5);
    expect(parseNumber('-3e2')).toBe(-300);
    expect(parseNumber('12abc')).toBeNull();
  });
  it('grades within absolute and relative tolerance', () => {
    expect(h.grade({ answer: 9.81, tolerance: { type: 'absolute', value: 0.05 } }, { value: '9.8' }, 3, scheme()).score).toBe(3);
    expect(h.grade({ answer: 100, tolerance: { type: 'relative', value: 0.01 } }, { value: '102' }, 3, scheme()).score).toBe(0);
  });
  it('builds per-candidate variants from variables and a formula', () => {
    const content = { stem: 'A car covers {{d}} km in {{t}} h. Speed?', variables: [{ name: 'd', min: 100, max: 200, step: 10 }, { name: 't', min: 2, max: 4, step: 1 }] };
    const key = { answer: null, formula: 'd / t', tolerance: { type: 'absolute', value: 0.01 } };
    const { content: c, key: k } = h.validateDraft(content, key);
    const p = h.prepare(c, k, { rng: createRng('cand-7'), shuffleOptions: false });
    const { d, t } = p.variant.values as { d: number; t: number };
    expect(p.content.stem).toContain(`${d} km in ${t} h`);
    expect(p.content.variables).toBeUndefined();
    expect(p.answerKey.answer).toBeCloseTo(d / t);
  });
});

describe('structured types', () => {
  it('ordering credits the longest correctly ordered run', () => {
    expect(longestOrderedRun(['b', 'a', 'c', 'd'], ['a', 'b', 'c', 'd'])).toBe(3);
    const h = questionType('ordering');
    expect(h.grade({ order: ['a', 'b', 'c', 'd'] }, { order: ['a', 'b', 'd', 'c'] }, 4, scheme()).score).toBe(3);
  });
  it('fill in the blanks gives per-blank credit, case-insensitive by default', () => {
    const h = questionType('fill_blanks');
    const key = { blanks: { b1: ['100'], b2: ['Celsius', 'C'] }, caseSensitive: false };
    expect(h.grade(key, { blanks: { b1: '100', b2: 'celsius' } }, 2, scheme()).score).toBe(2);
    expect(h.grade(key, { blanks: { b1: '90', b2: 'c' } }, 2, scheme()).score).toBe(1);
  });
  it('matching credits each correct pair', () => {
    const h = questionType('matching');
    expect(h.grade({ pairs: { p1: 'x', p2: 'y' } }, { pairs: { p1: 'x', p2: 'x' } }, 2, scheme()).score).toBe(1);
  });
  it('written answers need a human unless blank', () => {
    const h = questionType('long_text');
    expect(h.grade({}, { text: 'An answer' }, 5, scheme()).score).toBeNull();
    expect(h.grade({}, { text: '  ' }, 5, scheme()).score).toBe(0);
  });
});
