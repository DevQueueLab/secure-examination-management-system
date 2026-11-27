import { describe, expect, it } from 'vitest';
import { rescorePart, resolvePartScore, rubricPartScore } from './rubric-score';

describe('rubricPartScore', () => {
  it('sums selected points and the adjustment', () => {
    expect(rubricPartScore([2, 1.5], 0.5, 5)).toEqual({ raw: 4, score: 4, clamped: false });
  });

  it('clamps above the part maximum', () => {
    expect(rubricPartScore([3, 2], 1, 4)).toEqual({ raw: 6, score: 4, clamped: true });
  });

  it('clamps below zero (deductions can never make a part negative)', () => {
    expect(rubricPartScore([2, -3], -1, 5)).toEqual({ raw: -2, score: 0, clamped: true });
  });

  it('avoids floating point drift', () => {
    expect(rubricPartScore([0.1, 0.2], 0, 1).score).toBe(0.3);
  });

  it('handles an empty selection', () => {
    expect(rubricPartScore([], 0, 5)).toEqual({ raw: 0, score: 0, clamped: false });
  });
});

describe('resolvePartScore', () => {
  it('rejects an explicit score above the assigned marks', () => {
    const r = resolvePartScore({ points: [], max: 6, score: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe('score');
      expect(r.message).toMatch(/between 0 and 6/);
    }
  });

  it('rejects a negative explicit score', () => {
    expect(resolvePartScore({ points: [2], max: 6, score: -0.5 }).ok).toBe(false);
  });

  it('accepts the boundaries 0 and max', () => {
    expect(resolvePartScore({ points: [], max: 6, score: 0 })).toMatchObject({ ok: true, score: 0 });
    expect(resolvePartScore({ points: [], max: 6, score: 6 })).toMatchObject({ ok: true, score: 6 });
  });

  it('derives the adjustment from an explicit score so later rubric edits stay consistent', () => {
    expect(resolvePartScore({ points: [2, 1], max: 6, score: 4.5 })).toEqual({ ok: true, score: 4.5, adjustment: 1.5, clamped: false });
  });

  it('clamps rubric totals instead of rejecting them', () => {
    expect(resolvePartScore({ points: [4, 4], max: 6, adjustment: 0 })).toEqual({ ok: true, score: 6, adjustment: 0, clamped: true });
  });

  it('rejects an adjustment larger than the part', () => {
    const r = resolvePartScore({ points: [1], max: 2, adjustment: 3 });
    expect(r).toMatchObject({ ok: false, field: 'adjustment' });
  });
});

describe('rescorePart', () => {
  it('applies a point change through the stored adjustment', () => {
    // Items 2 + 1 with +0.5 adjustment = 3.5; the first item becomes worth 3.
    expect(rescorePart({ oldPoints: [2, 1], newPoints: [3, 1], adjustment: 0.5, current: 3.5, max: 6 })).toEqual({ score: 4.5, adjustment: 0.5 });
  });

  it('re-clamps exactly (not as a delta) when the old total was clamped', () => {
    // 3 + 3 = 6 clamped to 5; lowering one item to 2 gives 5 again, not 4.
    expect(rescorePart({ oldPoints: [3, 3], newPoints: [2, 3], adjustment: 0, current: 5, max: 5 }).score).toBe(5);
  });

  it('respects a score that was changed outside the rubric', () => {
    // Rubric says 3 but a dispute set 4: the +1 survives the edit.
    expect(rescorePart({ oldPoints: [2, 1], newPoints: [2, 2], adjustment: 0, current: 4, max: 6 })).toEqual({ score: 5, adjustment: 1 });
  });
});
