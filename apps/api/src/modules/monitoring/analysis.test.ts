import { describe, expect, it } from 'vitest';
import { connectivitySegments, detectOutage, eventTime, progressSeries, safePayload, type OutageInput } from './analysis';

const NOW = new Date('2026-11-27T10:50:00Z');
const at = (minutesAgo: number, seconds = 0) => new Date(NOW.getTime() - minutesAgo * 60_000 + seconds * 1000);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${i + 1}`);

function input(over: Partial<OutageInput> = {}): OutageInput {
  return {
    now: NOW,
    inProgress: ids(10).map((attemptId) => ({ attemptId, lastSeenAt: at(0, -5) })),
    wentOffline: [],
    cameOnline: [],
    compensated: [],
    ...over,
  };
}

describe('detectOutage', () => {
  it('suggests one extension when 30% drop inside the same two minutes', () => {
    const s = detectOutage(
      input({
        wentOffline: ['a1', 'a2', 'a3'].map((attemptId, i) => ({ attemptId, at: at(8, i * 20), receivedAt: at(3, i * 20) })),
      }),
    );
    expect(s).toMatchObject({ kind: 'bulk_extension', affected: 3, inProgress: 10, stillOffline: 0, minutes: 5 });
    expect(s?.attemptIds.sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('stays quiet below 30% or when drops are spread out', () => {
    expect(detectOutage(input({ wentOffline: ['a1', 'a2'].map((attemptId) => ({ attemptId, at: at(5), receivedAt: at(4) })) }))).toBeNull();
    const spread = ['a1', 'a2', 'a3', 'a4'].map((attemptId, i) => ({ attemptId, at: at(15 - i * 3), receivedAt: at(14 - i * 3) }));
    expect(detectOutage(input({ wentOffline: spread }))).toBeNull();
  });

  it('needs at least three candidates, whatever the share', () => {
    const two = input({ inProgress: ids(2).map((attemptId) => ({ attemptId, lastSeenAt: at(5) })) });
    expect(detectOutage(two)).toBeNull();
  });

  it('counts silent clients (stale heartbeat) as offline and reports who is still out', () => {
    const s = detectOutage(
      input({
        inProgress: ids(10).map((attemptId, i) => ({ attemptId, lastSeenAt: i < 4 ? at(6, i * 10) : at(0, -3) })),
      }),
    );
    expect(s).toMatchObject({ affected: 4, stillOffline: 4, minutes: 6 });
  });

  it('ignores onsets older than the lookback (stale seeded data does not look like an outage)', () => {
    const s = detectOutage(input({ inProgress: ids(10).map((attemptId) => ({ attemptId, lastSeenAt: at(45) })) }));
    expect(s).toBeNull();
  });

  it('drops candidates already compensated, so applying it does not offer it again', () => {
    const wentOffline = ['a1', 'a2', 'a3', 'a4'].map((attemptId) => ({ attemptId, at: at(8), receivedAt: at(6) }));
    const compensated = ['a1', 'a2'].map((attemptId) => ({ attemptId, at: at(1) }));
    expect(detectOutage(input({ wentOffline, compensated }))).toBeNull();
    expect(detectOutage(input({ wentOffline }))?.affected).toBe(4);
  });

  it('uses came_online events for time lost and rounds the median up to whole minutes', () => {
    const wentOffline = ['a1', 'a2', 'a3'].map((attemptId) => ({ attemptId, at: at(10), receivedAt: at(10) }));
    const cameOnline = [
      { attemptId: 'a1', at: at(9) },
      { attemptId: 'a2', at: at(7, -30) },
      { attemptId: 'a3', at: at(2) },
    ];
    // Lost 1, 2.5 and 8 minutes: the median 2.5 rounds up to 3.
    expect(detectOutage(input({ wentOffline, cameOnline }))?.minutes).toBe(3);
  });
});

describe('connectivitySegments', () => {
  const startedAt = new Date('2026-11-27T10:00:00Z');
  const t = (m: number) => new Date(startedAt.getTime() + m * 60_000);

  it('pairs went_offline with came_online and covers the whole attempt', () => {
    const segs = connectivitySegments({
      startedAt,
      endAt: t(30),
      live: false,
      lastSeenAt: t(30),
      now: t(40),
      events: [
        { type: 'went_offline', at: t(10) },
        { type: 'came_online', at: t(13) },
      ],
    });
    expect(segs.map((s) => [s.state, s.from.slice(11, 16), s.to.slice(11, 16)])).toEqual([
      ['online', '10:00', '10:10'],
      ['offline', '10:10', '10:13'],
      ['online', '10:13', '10:30'],
    ]);
  });

  it('adds a trailing heartbeat gap for a live attempt that went silent', () => {
    const segs = connectivitySegments({ startedAt, endAt: t(20), live: true, lastSeenAt: t(18), now: t(20), events: [] });
    expect(segs.at(-1)).toMatchObject({ state: 'offline', source: 'heartbeat', from: t(18).toISOString() });
  });

  it('keeps an unfinished offline period open until the end (auto-submitted while offline)', () => {
    const segs = connectivitySegments({ startedAt, endAt: t(60), live: false, lastSeenAt: t(50), now: t(70), events: [{ type: 'went_offline', at: t(50) }] });
    expect(segs.at(-1)).toMatchObject({ state: 'offline', to: t(60).toISOString() });
  });
});

describe('payload and time helpers', () => {
  it('never passes on what the candidate wrote or pasted', () => {
    expect(safePayload({ text: 'secret', pastedText: 'x', length: 120, durationMs: 4000, ok: true, nested: { a: 1 } })).toEqual({
      length: 120,
      durationMs: 4000,
      ok: true,
    });
  });

  it('trusts the browser clock only between the start and the server receipt', () => {
    const startedAt = new Date('2026-11-27T10:00:00Z');
    const createdAt = new Date('2026-11-27T10:20:00Z');
    expect(eventTime({ createdAt, clientTs: new Date('2026-11-27T10:15:00Z') }, startedAt).toISOString()).toBe('2026-11-27T10:15:00.000Z');
    expect(eventTime({ createdAt, clientTs: new Date('2026-11-27T10:25:00Z') }, startedAt)).toBe(createdAt);
    expect(eventTime({ createdAt, clientTs: new Date('2026-11-27T08:00:00Z') }, startedAt)).toBe(createdAt);
  });

  it('builds a cumulative progress series', () => {
    const startedAt = new Date('2026-11-27T10:00:00Z');
    const series = progressSeries({
      startedAt,
      endAt: new Date('2026-11-27T10:30:00Z'),
      answeredAt: [new Date('2026-11-27T10:12:00Z'), new Date('2026-11-27T10:05:00Z')],
    });
    expect(series.map((p) => p.answered)).toEqual([0, 1, 2, 2]);
    expect(series[1]!.at).toBe('2026-11-27T10:05:00.000Z');
  });
});
