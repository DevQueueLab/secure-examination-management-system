import { describe, expect, it } from 'vitest';
import {
  accessCodeMatches,
  boundedPayload,
  canonicalJson,
  computeDeadline,
  eventSeverity,
  isNewerRevision,
  isPastDeadline,
  receiptCode,
  reviewPriorityFor,
  startBlock,
  startBlockMessage,
} from './attempt.policy';

const at = (iso: string) => new Date(iso);

describe('deadline', () => {
  const window = { windowClosesAt: at('2026-11-27T12:00:00Z') };

  it('is start + duration when nothing caps it', () => {
    expect(
      computeDeadline({ startedAt: at('2026-11-27T09:00:00Z'), durationMinutes: 60, ...window }),
    ).toEqual(at('2026-11-27T10:00:00Z'));
  });
  it('applies the accommodation multiplier and extra minutes', () => {
    const d = computeDeadline({
      startedAt: at('2026-11-27T09:00:00Z'),
      durationMinutes: 60,
      timeMultiplier: 1.5,
      extraMinutes: 10,
      ...window,
    });
    expect(d).toEqual(at('2026-11-27T10:40:00Z'));
  });
  it('never runs past the window close, so late starters get less time', () => {
    const d = computeDeadline({
      startedAt: at('2026-11-27T11:30:00Z'),
      durationMinutes: 60,
      timeMultiplier: 1.5,
      ...window,
    });
    expect(d).toEqual(window.windowClosesAt);
  });
  it('is uncapped for sandbox previews', () => {
    const d = computeDeadline({
      startedAt: at('2026-11-27T11:30:00Z'),
      durationMinutes: 60,
      windowClosesAt: null,
    });
    expect(d).toEqual(at('2026-11-27T12:30:00Z'));
  });
  it('allows a 2 second grace for the final autosave', () => {
    const deadline = at('2026-11-27T10:00:00Z');
    expect(isPastDeadline(deadline, at('2026-11-27T10:00:01.900Z'))).toBe(false);
    expect(isPastDeadline(deadline, at('2026-11-27T10:00:02.100Z'))).toBe(true);
  });
});

describe('start availability', () => {
  const exam = {
    status: 'published' as const,
    windowOpensAt: at('2026-11-27T09:00:00Z'),
    windowClosesAt: at('2026-11-27T12:00:00Z'),
    lateEntryMinutes: null,
  };

  it('blocks before the window with the opening time', () => {
    const block = startBlock(exam, at('2026-11-27T08:59:00Z'));
    expect(block).toEqual({ kind: 'not_open', at: exam.windowOpensAt });
    expect(startBlockMessage(block!)).toBe('This exam opens at 27 Nov 2026, 09:00 UTC');
    expect(startBlockMessage(block!, 'Asia/Karachi')).toBe(
      'This exam opens at 27 Nov 2026, 14:00 (Asia/Karachi)',
    );
  });
  it('is open inside the window and closed at the close', () => {
    expect(startBlock(exam, at('2026-11-27T10:00:00Z'))).toBeNull();
    expect(startBlock(exam, at('2026-11-27T12:00:00Z'))?.kind).toBe('closed');
  });
  it('respects late entry', () => {
    const late = { ...exam, lateEntryMinutes: 15 };
    expect(startBlock(late, at('2026-11-27T09:14:00Z'))).toBeNull();
    expect(startBlock(late, at('2026-11-27T09:16:00Z'))).toEqual({
      kind: 'late_entry_closed',
      at: at('2026-11-27T09:15:00Z'),
    });
  });
  it('blocks drafts and archived exams', () => {
    expect(startBlock({ ...exam, status: 'draft' }, at('2026-11-27T10:00:00Z'))?.kind).toBe(
      'unpublished',
    );
    expect(startBlock({ ...exam, status: 'archived' }, at('2026-11-27T10:00:00Z'))?.kind).toBe(
      'archived',
    );
  });
});

describe('revision rule', () => {
  it('accepts only strictly newer revisions', () => {
    expect(isNewerRevision(1, 0)).toBe(true);
    expect(isNewerRevision(1, null)).toBe(true);
    expect(isNewerRevision(3, 3)).toBe(false);
    expect(isNewerRevision(2, 3)).toBe(false);
  });
});

describe('access code', () => {
  it('matches case-insensitively and ignores surrounding spaces', () => {
    expect(accessCodeMatches('K7Q2', ' k7q2 ')).toBe(true);
    expect(accessCodeMatches('K7Q2', 'K7Q3')).toBe(false);
    expect(accessCodeMatches('K7Q2', undefined)).toBe(false);
  });
});

describe('integrity indicators', () => {
  it('grades severities', () => {
    expect(eventSeverity('focus_lost', {})).toBe('low');
    expect(eventSeverity('paste', { length: 40 })).toBe('low');
    expect(eventSeverity('paste', { length: 600 })).toBe('medium');
    expect(eventSeverity('multiple_displays', {})).toBe('medium');
    expect(eventSeverity('went_offline', {})).toBe('info');
  });
  it('derives review priority from indicator counts', () => {
    expect(reviewPriorityFor({ low: 0, medium: 0, high: 0 })).toBe('none');
    expect(reviewPriorityFor({ low: 2, medium: 0, high: 0 })).toBe('low');
    expect(reviewPriorityFor({ low: 0, medium: 1, high: 0 })).toBe('medium');
    expect(reviewPriorityFor({ low: 6, medium: 0, high: 0 })).toBe('medium');
    expect(reviewPriorityFor({ low: 0, medium: 3, high: 0 })).toBe('high');
  });
  it('bounds oversized payloads', () => {
    const big = boundedPayload({ length: 900, text: 'x'.repeat(5000) });
    expect(big).toEqual({ length: 900, truncated: true });
    expect(boundedPayload({ length: 3 })).toEqual({ length: 3 });
  });
});

describe('receipt', () => {
  const answers = [
    { itemId: 'b-item', response: { optionId: 'o2' }, working: null },
    {
      itemId: 'a-item',
      response: { text: 'stack', extra: { z: 1, a: 2 } },
      working: { text: 'w', scratchPages: [] },
    },
  ];

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    );
  });
  it('is deterministic and independent of answer order', () => {
    const one = receiptCode('secret-0123456789', 'attempt-1', answers);
    const two = receiptCode('secret-0123456789', 'attempt-1', [...answers].reverse());
    expect(one).toBe(two);
    expect(one).toMatch(/^RCPT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });
  it('changes when any answer, the attempt or the secret changes', () => {
    const base = receiptCode('secret-0123456789', 'attempt-1', answers);
    const edited = [{ ...answers[0]!, response: { optionId: 'o3' } }, answers[1]!];
    expect(receiptCode('secret-0123456789', 'attempt-1', edited)).not.toBe(base);
    expect(receiptCode('secret-0123456789', 'attempt-2', answers)).not.toBe(base);
    expect(receiptCode('another-secret-000', 'attempt-1', answers)).not.toBe(base);
  });
});
