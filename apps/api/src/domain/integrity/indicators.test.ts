import { ProvenanceRecorder } from '@athena/shared';
import { describe, expect, it } from 'vitest';
import {
  assessAttempt,
  finalComposition,
  focusSummary,
  offlineIntervals,
  reviewPriority,
  type Reason,
  type TimedEvent,
} from './indicators';

const t0 = new Date('2026-11-27T09:00:00Z').getTime();
const at = (sec: number) => new Date(t0 + sec * 1000);
const ev = (type: string, sec: number, extra: Partial<TimedEvent> = {}): TimedEvent => ({
  type,
  severity: 'info',
  at: at(sec),
  receivedAt: at(sec),
  payload: {},
  reviewStatus: null,
  ...extra,
});

/** Types `text` one character at a time, `gapMs` apart, starting at `start`. */
function type(rec: ProvenanceRecorder, before: string, text: string, start: number, gapMs = 180): { value: string; now: number } {
  let value = before;
  let now = start;
  for (const ch of text) {
    const next = value + ch;
    rec.record(value, next, { now });
    value = next;
    now += gapMs;
  }
  return { value, now };
}

describe('provenance reasons', () => {
  it('flags an essay whose final text mostly arrived in one paste, with the share and size', () => {
    const rec = new ProvenanceRecorder();
    const typed = type(rec, '', 'Processes own an address space; threads share it. ', 0);
    const pasted = 'A'.repeat(612);
    rec.record(typed.value, typed.value + pasted, { pasted: true, now: typed.now + 5_000 });
    const provenance = rec.snapshot();

    const result = assessAttempt({
      events: [],
      endAt: at(3600),
      written: [{ answerId: 'ans-1', label: 'Q4 · Processes vs threads', noun: 'essay', finalText: typed.value + pasted, provenance }],
      similarity: [],
    });

    const reason = result.reasons.find((r) => r.kind === 'pasted_text')!;
    expect(reason.level).toBe('high');
    expect(reason.text).toBe('Q4 · Processes vs threads: 92% of the final essay text arrived in 1 paste (612 chars)');
    expect(reason.innocent).toMatch(/draft/);
    expect(reason.ref).toEqual({ answerId: 'ans-1' });
    expect(result.priority).toBe('high');
    expect(result.written[0]!.composition).toEqual({ typed: 50, pasted: 612, burst: 0, total: 662 });
  });

  it('ignores a short pasted formula', () => {
    const rec = new ProvenanceRecorder();
    const typed = type(rec, '', 'The answer is ', 0);
    rec.record(typed.value, `${typed.value}O(n log n)`, { pasted: true, now: typed.now + 500 });
    const result = assessAttempt({
      events: [],
      endAt: at(600),
      written: [{ answerId: 'a', label: 'Q1', noun: 'short answer', finalText: `${typed.value}O(n log n)`, provenance: rec.snapshot() }],
      similarity: [],
    });
    expect(result.reasons).toEqual([]);
    expect(result.priority).toBe('none');
  });

  it('describes pasted text that was later rewritten without claiming it is in the final answer', () => {
    const rec = new ProvenanceRecorder();
    const pasted = 'x'.repeat(300);
    rec.record('', pasted, { pasted: true, now: 0 });
    rec.record(pasted, '', { now: 2_000 });
    const final = type(rec, '', 'My own explanation of the concept.', 4_000);
    const composition = finalComposition(rec.snapshot())!;
    expect(composition.pasted).toBe(0);
    const result = assessAttempt({
      events: [],
      endAt: at(600),
      written: [{ answerId: 'a', label: 'Q2', noun: 'essay', finalText: final.value, provenance: rec.snapshot() }],
      similarity: [],
    });
    const reason = result.reasons.find((r) => r.kind === 'pasted_text')!;
    expect(reason.text).toContain('all later deleted or rewritten');
    expect(reason.level).toBe('medium'); // a 300-char paste is still worth a look
  });

  it('reports bursts: large inserts without a paste event', () => {
    const rec = new ProvenanceRecorder();
    const burst = 'b'.repeat(240);
    rec.record('', burst, { now: 0 });
    const result = assessAttempt({
      events: [],
      endAt: at(600),
      written: [{ answerId: 'a', label: 'Q3', noun: 'code', finalText: burst, provenance: rec.snapshot() }],
      similarity: [],
    });
    const reason = result.reasons.find((r) => r.kind === 'burst_text')!;
    expect(reason.text).toBe('Q3: 1 burst inserted 240 chars at once without a paste');
    expect(reason.level).toBe('medium');
  });
});

describe('focusSummary', () => {
  it('pairs focus_lost with focus_returned and prefers the measured duration', () => {
    const events = [ev('focus_lost', 10), ev('focus_returned', 40), ev('focus_lost', 100), ev('focus_returned', 101, { payload: { awayMs: 90_000 } })];
    expect(focusSummary(events, at(600))).toEqual({ count: 2, totalMs: 120_000, longestMs: 90_000 });
  });

  it('counts a tab still away at the end, capped at 30 minutes per interval', () => {
    expect(focusSummary([ev('focus_lost', 0)], at(7200))).toEqual({ count: 1, totalMs: 30 * 60_000, longestMs: 30 * 60_000 });
  });

  it('phrases the reason with count and total time', () => {
    const events = Array.from({ length: 9 }, (_, i) => [ev('focus_lost', i * 100, { severity: 'low' }), ev('focus_returned', i * 100 + 27)]).flat();
    const result = assessAttempt({ events, endAt: at(3600), written: [], similarity: [] });
    const reason = result.reasons.find((r) => r.kind === 'tab_away')!;
    expect(reason.text).toBe('Left the exam tab 9 times (4 min total, longest 27 s)');
    expect(reason.level).toBe('low');
    expect(result.incidents.byType.focus_lost).toBe(9);
    expect(result.incidents.review.open).toBe(9);
  });
});

describe('offlineIntervals', () => {
  it('pairs went_offline with the next sign of life', () => {
    const out = offlineIntervals([ev('went_offline', 60), ev('came_online', 240)], at(3600));
    expect(out).toEqual([{ from: at(60), to: at(240), ms: 180_000, open: false }]);
  });

  it('uses the late arrival of the went_offline report as the return when nothing else marks it', () => {
    const out = offlineIntervals([ev('went_offline', 60, { receivedAt: at(300) })], at(3600));
    expect(out).toEqual([{ from: at(60), to: at(300), ms: 240_000, open: false }]);
  });

  it('keeps an interval open until the end when the client never came back', () => {
    const out = offlineIntervals([ev('went_offline', 3000)], at(3600));
    expect(out[0]).toMatchObject({ ms: 600_000, open: true });
  });
});

describe('reviewPriority', () => {
  const r = (kind: Reason['kind'], level: Reason['level'], cleared = false): Reason => ({ kind, level, text: '', innocent: '', cleared });

  it('is a transparent rule over the reasons', () => {
    expect(reviewPriority([])).toBe('none');
    expect(reviewPriority([r('tab_away', 'low')])).toBe('low');
    expect(reviewPriority([r('tab_away', 'low'), r('copy_attempt', 'low'), r('offline', 'low')])).toBe('medium');
    expect(reviewPriority([r('second_display', 'medium')])).toBe('medium');
    expect(reviewPriority([r('second_display', 'medium'), r('tab_away', 'medium')])).toBe('high');
    expect(reviewPriority([r('pasted_text', 'high')])).toBe('high');
  });

  it('does not count indicators a reviewer cleared', () => {
    expect(reviewPriority([r('second_display', 'medium', true)])).toBe('none');
    const events = [ev('multiple_displays', 10, { severity: 'medium', reviewStatus: 'no_concern' })];
    const result = assessAttempt({ events, endAt: at(600), written: [], similarity: [] });
    expect(result.reasons[0]).toMatchObject({ kind: 'second_display', cleared: true });
    expect(result.priority).toBe('none');
  });

  it('turns a flagged similarity pair into a high reason that names the other attempt', () => {
    const result = assessAttempt({
      events: [],
      endAt: at(600),
      written: [],
      similarity: [{ kind: 'objective', otherAttemptId: 'att-2', otherName: 'Bilal Khan', sharedWrong: 5, z: 6.24 }],
    });
    expect(result.reasons[0]!.text).toBe('Shares 5 uncommon wrong answers with Bilal Khan, 6.2 standard deviations above a typical pair');
    expect(result.priority).toBe('high');
  });
});
