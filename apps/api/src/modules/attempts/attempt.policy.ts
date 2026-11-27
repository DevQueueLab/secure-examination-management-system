import { timingSafeEqual } from 'node:crypto';
import type { AttemptEventType, EventSeverity, ExamStatus } from '@athena/shared';
import { hmac, sha256 } from '../../lib/crypto';

/**
 * Pure attempt rules: timing, availability, integrity classification and receipts. No I/O, so every rule here
 * is unit-tested directly and shared by the service, the lobby and the background jobs.
 */

// ---------- timing ----------

/** Writes are still accepted this long after the deadline, to absorb the latency of the final autosave. */
export const DEADLINE_GRACE_MS = 2_000;

export const isPastDeadline = (deadlineAt: Date, now: Date) =>
  now.getTime() > deadlineAt.getTime() + DEADLINE_GRACE_MS;

/** Effective time limit in minutes with accommodations (e.g. 1.5x time plus 10 extra minutes). */
export const timeLimitMinutes = (durationMinutes: number, timeMultiplier = 1, extraMinutes = 0) =>
  durationMinutes * timeMultiplier + extraMinutes;

/**
 * The server deadline, fixed at start: min(start + duration x multiplier + extra minutes, window close).
 * The window cap means a late starter gets less time instead of writing after the exam closed.
 * Sandbox previews pass windowClosesAt = null (no cap).
 */
export function computeDeadline(input: {
  startedAt: Date;
  durationMinutes: number;
  timeMultiplier?: number;
  extraMinutes?: number;
  windowClosesAt: Date | null;
}): Date {
  const limitMs = Math.round(
    timeLimitMinutes(input.durationMinutes, input.timeMultiplier, input.extraMinutes) * 60_000,
  );
  const natural = input.startedAt.getTime() + limitMs;
  return new Date(
    input.windowClosesAt ? Math.min(natural, input.windowClosesAt.getTime()) : natural,
  );
}

// ---------- availability ----------

export type StartBlock =
  | { kind: 'unpublished' }
  | { kind: 'archived' }
  | { kind: 'not_open'; at: Date }
  | { kind: 'late_entry_closed'; at: Date }
  | { kind: 'closed'; at: Date };

/** Why a new attempt cannot start right now, or null when it can. Resuming an attempt is never blocked here. */
export function startBlock(
  exam: {
    status: ExamStatus;
    windowOpensAt: Date;
    windowClosesAt: Date;
    lateEntryMinutes: number | null;
  },
  now: Date,
): StartBlock | null {
  if (exam.status === 'archived') return { kind: 'archived' };
  if (exam.status !== 'published') return { kind: 'unpublished' };
  const t = now.getTime();
  if (t < exam.windowOpensAt.getTime()) return { kind: 'not_open', at: exam.windowOpensAt };
  if (t >= exam.windowClosesAt.getTime()) return { kind: 'closed', at: exam.windowClosesAt };
  if (exam.lateEntryMinutes !== null) {
    const lateEntryEnds = new Date(exam.windowOpensAt.getTime() + exam.lateEntryMinutes * 60_000);
    if (t > lateEntryEnds.getTime()) return { kind: 'late_entry_closed', at: lateEntryEnds };
  }
  return null;
}

export function startBlockMessage(block: StartBlock, timeZone?: string): string {
  switch (block.kind) {
    case 'unpublished':
      return 'This exam is not available yet';
    case 'archived':
      return 'This exam has been archived';
    case 'not_open':
      return `This exam opens at ${formatInstant(block.at, timeZone)}`;
    case 'late_entry_closed':
      return `Late entry closed at ${formatInstant(block.at, timeZone)}. Contact your examiner if you need help.`;
    case 'closed':
      return `This exam closed at ${formatInstant(block.at, timeZone)}`;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "29 Nov 2026, 11:28 (Asia/Karachi)" in the candidate's zone when known, otherwise UTC. */
export function formatInstant(at: Date, timeZone?: string): string {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const text = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(at);
  return zone === 'UTC' ? `${text} UTC` : `${text} (${zone})`;
}

// ---------- access ----------

/** Constant-time, case-insensitive comparison of an exam access code (hashing first equalizes lengths). */
export function accessCodeMatches(expected: string, given: string | undefined): boolean {
  const digest = (v: string) => Buffer.from(sha256(v.trim().toUpperCase()), 'hex');
  return timingSafeEqual(digest(expected), digest(given ?? ''));
}

/** A write is applied only when its revision is newer than the stored one (mirrors the SQL guard in sync). */
export const isNewerRevision = (incoming: number, stored: number | null | undefined) =>
  incoming > (stored ?? 0);

// ---------- integrity events ----------

/** Event types a client may report. Lifecycle events (started, submitted, time_extended...) are server-only. */
export const CLIENT_EVENT_TYPES: ReadonlySet<AttemptEventType> = new Set<AttemptEventType>([
  'went_offline',
  'came_online',
  'focus_lost',
  'focus_returned',
  'fullscreen_exited',
  'fullscreen_entered',
  'copy_attempt',
  'paste',
  'context_menu',
  'multiple_displays',
  'print_attempt',
  'announcement_read',
]);

/** Pastes longer than this are a medium indicator (a typical sentence is shorter). */
export const LARGE_PASTE_CHARS = 200;

/** Severity of an indicator. Indicators prompt human review; they are never verdicts or penalties. */
export function eventSeverity(
  type: AttemptEventType,
  payload: Record<string, unknown>,
): EventSeverity {
  switch (type) {
    case 'focus_lost':
    case 'fullscreen_exited':
    case 'copy_attempt':
    case 'context_menu':
    case 'print_attempt':
      return 'low';
    case 'paste':
      return Number(payload.length ?? 0) > LARGE_PASTE_CHARS ? 'medium' : 'low';
    case 'multiple_displays':
      return 'medium';
    default:
      return 'info';
  }
}

export type ReviewPriority = 'none' | 'low' | 'medium' | 'high';

/** Review priority from counts of open (not cleared) indicators. */
export function reviewPriorityFor(counts: {
  low: number;
  medium: number;
  high: number;
}): ReviewPriority {
  if (counts.high > 0 || counts.medium >= 3 || counts.low >= 15) return 'high';
  if (counts.medium > 0 || counts.low >= 5) return 'medium';
  if (counts.low > 0) return 'low';
  return 'none';
}

const MAX_EVENT_PAYLOAD_CHARS = 2_000;

/** Keeps client event payloads small: oversized payloads keep only their short scalar fields. */
export function boundedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(payload).length <= MAX_EVENT_PAYLOAD_CHARS) return payload;
  const scalars = Object.entries(payload).filter(
    ([, v]) =>
      typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200),
  );
  return { ...Object.fromEntries(scalars.slice(0, 20)), truncated: true };
}

// ---------- receipts ----------

/** JSON with object keys sorted recursively, so equal values always serialize identically. */
export function canonicalJson(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .filter((k) => obj[k] !== undefined)
          .map((k) => [k, sortKeys(obj[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

export interface ReceiptAnswer {
  itemId: string;
  response: unknown;
  working: unknown;
}

const RECEIPT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U

/**
 * Submission receipt: HMAC-SHA256(secret, attemptId + canonical JSON of the final answers), shown as
 * RCPT-XXXX-XXXX-XXXX (60 bits). Deterministic, so anyone holding the secret can prove what was submitted.
 */
export function receiptCode(
  secret: string,
  attemptId: string,
  finalAnswers: ReceiptAnswer[],
): string {
  const answers = finalAnswers
    .map((a) => ({ itemId: a.itemId, response: a.response ?? null, working: a.working ?? null }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  let bits = BigInt(`0x${hmac(secret, attemptId + canonicalJson(answers)).slice(0, 15)}`);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code = RECEIPT_ALPHABET[Number(bits & 31n)] + code;
    bits >>= 5n;
  }
  return `RCPT-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}
