import type { ConnectivitySegment, OutageSuggestion } from './monitoring.types';

/**
 * Pure functions behind the live monitor: no database, no clock of their own (callers pass `now`),
 * so every rule here is unit tested in analysis.test.ts.
 */

/** A client that has not synced for this long is shown as offline. */
export const HEARTBEAT_TIMEOUT_MS = 30_000;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function isOnline(lastSeenAt: Date | null, now: Date, timeoutMs = HEARTBEAT_TIMEOUT_MS): boolean {
  return !!lastSeenAt && now.getTime() - lastSeenAt.getTime() <= timeoutMs;
}

/**
 * When an event happened. Offline events reach the server only after reconnecting, so the browser's own
 * timestamp is closer to the truth, but it is untrusted: accept it only between the attempt start (with a
 * minute of clock skew) and the moment the server received it.
 */
export function eventTime(e: { createdAt: Date; clientTs: Date | null }, startedAt: Date): Date {
  const client = e.clientTs?.getTime();
  if (client === undefined || Number.isNaN(client)) return e.createdAt;
  if (client > e.createdAt.getTime() || client < startedAt.getTime() - 60_000) return e.createdAt;
  return e.clientTs!;
}

const BLOCKED_PAYLOAD_KEY = /text|content|answer|response|clipboard|value|html|body|excerpt|snippet|preview|data/i;

/** Keeps durations, counts and short labels; drops anything that could carry what the candidate wrote. */
export function safePayload(payload: Record<string, unknown> | null | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (BLOCKED_PAYLOAD_KEY.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length <= 120) out[key] = value;
  }
  return out;
}

const OFFLINE_TYPES = new Set(['went_offline']);
/** Any sign that the client is back: it reported so, uploaded its journal or resumed on a device. */
const ONLINE_TYPES = new Set(['came_online', 'offline_journal_received', 'resumed']);

/**
 * Online/offline segments covering the attempt from start to `endAt`. Built from reported went_offline /
 * came_online pairs; while the attempt is live, a client that stopped syncing adds a trailing heartbeat gap.
 * There is no heartbeat history, so older silent gaps are only visible when the client reported them.
 */
export function connectivitySegments(input: {
  startedAt: Date;
  endAt: Date;
  live: boolean;
  lastSeenAt: Date | null;
  now: Date;
  events: { type: string; at: Date }[];
  heartbeatTimeoutMs?: number;
}): ConnectivitySegment[] {
  const timeout = input.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const start = input.startedAt.getTime();
  const end = Math.max(start, input.endAt.getTime());
  const raw: { from: number; to: number; state: 'online' | 'offline'; source: 'reported' | 'heartbeat' }[] = [];
  let state: 'online' | 'offline' = 'online';
  let cursor = start;

  const events = input.events
    .filter((e) => OFFLINE_TYPES.has(e.type) || ONLINE_TYPES.has(e.type))
    .map((e) => ({ type: e.type, t: Math.min(end, Math.max(start, e.at.getTime())) }))
    .sort((a, b) => a.t - b.t);

  for (const e of events) {
    if (OFFLINE_TYPES.has(e.type) && state === 'online') {
      raw.push({ from: cursor, to: e.t, state: 'online', source: 'reported' });
      state = 'offline';
      cursor = e.t;
    } else if (ONLINE_TYPES.has(e.type) && state === 'offline') {
      raw.push({ from: cursor, to: e.t, state: 'offline', source: 'reported' });
      state = 'online';
      cursor = e.t;
    }
  }

  const silentSince = input.lastSeenAt?.getTime();
  const silent = input.live && silentSince !== undefined && input.now.getTime() - silentSince > timeout;
  if (silent && state === 'online') {
    const lost = Math.min(end, Math.max(cursor, silentSince));
    raw.push({ from: cursor, to: lost, state: 'online', source: 'reported' });
    raw.push({ from: lost, to: end, state: 'offline', source: 'heartbeat' });
  } else {
    raw.push({ from: cursor, to: end, state, source: 'reported' });
  }

  return raw
    .filter((s) => s.to > s.from)
    .map((s) => ({ from: new Date(s.from).toISOString(), to: new Date(s.to).toISOString(), state: s.state, source: s.source }));
}

/** Cumulative answered count over time. Each item counts once, at the time it was last answered. */
export function progressSeries(input: { startedAt: Date; endAt: Date; answeredAt: Date[] }): { at: string; answered: number }[] {
  const times = input.answeredAt.map((d) => d.getTime()).sort((a, b) => a - b);
  const points = [{ at: input.startedAt.toISOString(), answered: 0 }];
  times.forEach((t, i) => points.push({ at: new Date(Math.max(t, input.startedAt.getTime())).toISOString(), answered: i + 1 }));
  points.push({ at: input.endAt.toISOString(), answered: times.length });
  return points;
}

export interface OutageInput {
  now: Date;
  /** In-progress attempts whose deadline has not passed. */
  inProgress: { attemptId: string; lastSeenAt: Date | null }[];
  /**
   * went_offline events: `at` from eventTime(), `receivedAt` is when the server got it. A browser can only
   * report going offline once it is back, so a late `receivedAt` also tells when the candidate returned.
   */
  wentOffline: { attemptId: string; at: Date; receivedAt: Date }[];
  /** came_online / offline_journal_received events. */
  cameOnline: { attemptId: string; at: Date }[];
  /** time_extended / outage_compensated events: an attempt compensated after an onset is not offered again. */
  compensated: { attemptId: string; at: Date }[];
  windowMs?: number;
  lookbackMs?: number;
  minShare?: number;
  minAffected?: number;
  heartbeatTimeoutMs?: number;
}

/**
 * Correlated-outage detection. When at least 30% of the candidates in progress (and at least three) lost their
 * connection inside the same two-minute window, the cause is almost certainly shared (venue Wi-Fi, ISP), so
 * the monitor offers one extension for exactly those candidates. Only recent onsets count, and candidates already
 * compensated afterwards are left out, so applying the suggestion makes it go away instead of offering it twice.
 */
export function detectOutage(input: OutageInput): OutageSuggestion | null {
  const windowMs = input.windowMs ?? 2 * 60_000;
  const lookbackMs = input.lookbackMs ?? 20 * 60_000;
  const minShare = input.minShare ?? 0.3;
  const minAffected = input.minAffected ?? 3;
  const timeout = input.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const now = input.now.getTime();
  const total = input.inProgress.length;
  const threshold = Math.max(minAffected, Math.ceil(total * minShare));
  if (total === 0 || threshold > total) return null;

  const live = new Map(input.inProgress.map((a) => [a.attemptId, a]));
  const compensatedAfter = (attemptId: string, t: number) =>
    input.compensated.some((c) => c.attemptId === attemptId && c.at.getTime() >= t);

  type Onset = { attemptId: string; t: number; reportedBackAt: number | null };
  const onsets: Onset[] = [];
  for (const e of input.wentOffline) {
    const t = e.at.getTime();
    const received = e.receivedAt.getTime();
    if (!live.has(e.attemptId) || t < now - lookbackMs || t > now) continue;
    onsets.push({ attemptId: e.attemptId, t, reportedBackAt: received - t > 5_000 ? received : null });
  }
  for (const a of input.inProgress) {
    const seen = a.lastSeenAt?.getTime();
    if (seen === undefined || now - seen <= timeout || seen < now - lookbackMs) continue;
    onsets.push({ attemptId: a.attemptId, t: seen, reportedBackAt: null });
  }
  const candidates = onsets.filter((o) => !compensatedAfter(o.attemptId, o.t)).sort((a, b) => a.t - b.t);

  // Two-pointer sweep for the window holding the most distinct attempts (latest wins a tie).
  let best: { from: number; to: number; ids: Map<string, Onset> } | null = null;
  for (let i = 0, j = 0; i < candidates.length; i++) {
    while (j < candidates.length && candidates[j]!.t - candidates[i]!.t <= windowMs) j++;
    const ids = new Map<string, Onset>();
    for (let k = i; k < j; k++) if (!ids.has(candidates[k]!.attemptId)) ids.set(candidates[k]!.attemptId, candidates[k]!);
    if (!best || ids.size >= best.ids.size) best = { from: candidates[i]!.t, to: candidates[j - 1]!.t, ids };
  }
  if (!best || best.ids.size < threshold) return null;

  // Time lost per candidate: until the first sign they were back, or until now while still offline.
  let stillOffline = 0;
  const lost: number[] = [];
  for (const [attemptId, onset] of best.ids) {
    const seen = live.get(attemptId)?.lastSeenAt?.getTime() ?? null;
    if (seen === null || now - seen > timeout) stillOffline++;
    const backEvents = input.cameOnline.filter((e) => e.attemptId === attemptId && e.at.getTime() > onset.t).map((e) => e.at.getTime());
    const back = Math.min(...backEvents, onset.reportedBackAt ?? Infinity);
    if (Number.isFinite(back)) lost.push(back - onset.t);
    else if (seen === null || now - seen > timeout) lost.push(now - onset.t);
  }
  lost.sort((a, b) => a - b);
  const median = lost.length === 0 ? 5 * 60_000 : lost.length % 2 ? lost[(lost.length - 1) / 2]! : (lost[lost.length / 2 - 1]! + lost[lost.length / 2]!) / 2;
  const minutes = Math.min(30, Math.max(2, Math.ceil(median / 60_000)));

  return {
    kind: 'bulk_extension',
    affected: best.ids.size,
    attemptIds: [...best.ids.keys()],
    inProgress: total,
    windowStart: new Date(best.from).toISOString(),
    windowEnd: new Date(best.to).toISOString(),
    stillOffline,
    minutes,
  };
}
