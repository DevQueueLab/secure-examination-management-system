import { describe, expect, it } from 'vitest';
import { canonicalJson, ledgerDigest, type LedgerEntry } from './ledger';

const entry = (metadata: Record<string, unknown>, newScore = 2.5): LedgerEntry => ({
  organizationId: 'org',
  examId: 'exam',
  attemptId: 'attempt',
  answerId: 'answer',
  action: 'manual_grade',
  actorId: 'grader',
  previousScore: 0,
  newScore,
  reason: null,
  metadata,
});

describe('grade ledger digest', () => {
  it('does not depend on metadata key order (jsonb reorders keys)', () => {
    const a = ledgerDigest(null, entry({ part: 'answer', rubricItemIds: ['r1'], adjustment: 0, nested: { b: 1, a: 2 } }), '2026-11-27T10:00:00.000Z');
    const b = ledgerDigest(null, entry({ nested: { a: 2, b: 1 }, adjustment: 0, rubricItemIds: ['r1'], part: 'answer' }), '2026-11-27T10:00:00.000Z');
    expect(a).toBe(b);
  });

  it('hashes scores at stored precision', () => {
    const raw = ledgerDigest('prev', entry({}, 2.3333333), '2026-11-27T10:00:00.000Z');
    const stored = ledgerDigest('prev', entry({}, 2.333), '2026-11-27T10:00:00.000Z');
    expect(raw).toBe(stored);
  });

  it('changes when anything material changes', () => {
    const base = ledgerDigest('prev', entry({ part: 'answer' }), 't');
    expect(ledgerDigest('other', entry({ part: 'answer' }), 't')).not.toBe(base);
    expect(ledgerDigest('prev', entry({ part: 'working' }), 't')).not.toBe(base);
    expect(ledgerDigest('prev', entry({ part: 'answer' }, 3), 't')).not.toBe(base);
  });

  it('drops undefined fields the way jsonb does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});
