import type { DisputeCategory, DisputeStatus } from '@athena/shared';

/**
 * Pure rules for the dispute process: when a candidate may raise one, how long staff have to answer it,
 * and who may not decide it. Kept free of I/O so they are unit-tested and shared by every endpoint.
 */

/** Statuses in which a dispute still waits for a decision. */
export const ACTIVE_STATUSES = ['open', 'under_review', 'needs_info'] as const satisfies readonly DisputeStatus[];
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export const MAX_DISPUTES_PER_ATTEMPT = 5;
/** Days staff have to decide a dispute, and an appeal. */
export const SLA_DAYS = 5;
export const APPEAL_SLA_DAYS = 3;
/** Days after a decision during which the candidate may appeal it (once). */
export const APPEAL_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

export const isActiveStatus = (status: DisputeStatus): status is ActiveStatus => (ACTIVE_STATUSES as readonly string[]).includes(status);

export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * DAY_MS);

export const dueAtFor = (raisedAt: Date, isAppeal: boolean) => addDays(raisedAt, isAppeal ? APPEAL_SLA_DAYS : SLA_DAYS);

export const isOverdue = (status: DisputeStatus, dueAt: Date | null, now: Date) => isActiveStatus(status) && !!dueAt && now.getTime() > dueAt.getTime();

/** Categories that are about one question and therefore need one. */
export const needsItem = (category: DisputeCategory) => category === 'grading_error' || category === 'ambiguous_question';

export interface WindowInput {
  category: DisputeCategory;
  allowDisputes: boolean;
  windowDays: number;
  resultsPublished: boolean;
  resultsPublishedAt: Date | null;
  attemptStatus: string;
  submittedAt: Date | null;
  now: Date;
}

export type WindowCode = 'DISPUTES_DISABLED' | 'NOT_SUBMITTED' | 'NOT_PUBLISHED' | 'WINDOW_CLOSED';

export type WindowDecision =
  | { ok: true; opensAt: Date; closesAt: Date }
  | { ok: false; code: WindowCode; message: string; closesAt: Date | null };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * When a dispute may be raised:
 * - grading and question disputes once results are published, for `disputeWindowDays` after publication;
 * - technical incidents as soon as the attempt is submitted (the candidate knows at once), for the same number
 *   of days after submission, or after publication when that is later (its effect may only show in the score).
 */
export function disputeWindow(input: WindowInput): WindowDecision {
  if (!input.allowDisputes) {
    return { ok: false, code: 'DISPUTES_DISABLED', message: 'This exam does not accept disputes.', closesAt: null };
  }
  if (input.attemptStatus !== 'submitted' || !input.submittedAt) {
    return { ok: false, code: 'NOT_SUBMITTED', message: 'You can raise a dispute once your attempt is submitted.', closesAt: null };
  }
  const published = input.resultsPublished && input.resultsPublishedAt !== null;
  let opensAt: Date;
  if (input.category === 'technical_incident') {
    opensAt = published && input.resultsPublishedAt! > input.submittedAt ? input.resultsPublishedAt! : input.submittedAt;
  } else {
    if (!published) {
      return {
        ok: false,
        code: 'NOT_PUBLISHED',
        message: 'Grading and question disputes open when results are published. A technical incident can be reported now.',
        closesAt: null,
      };
    }
    opensAt = input.resultsPublishedAt!;
  }
  const closesAt = addDays(opensAt, input.windowDays);
  if (input.now.getTime() > closesAt.getTime()) {
    return { ok: false, code: 'WINDOW_CLOSED', message: `The dispute window for this exam closed on ${day(closesAt)}.`, closesAt };
  }
  return { ok: true, opensAt, closesAt };
}

export type AppealDecision = { ok: true; closesAt: Date } | { ok: false; message: string; closesAt: Date | null };

/** An appeal is allowed once, on a decided original (never on an appeal), within APPEAL_WINDOW_DAYS of the decision. */
export function appealWindow(d: { status: DisputeStatus; appealOf: string | null; resolvedAt: Date | null; hasAppeal: boolean }, now: Date): AppealDecision {
  if (d.appealOf) return { ok: false, message: 'An appeal decision is final.', closesAt: null };
  if (d.hasAppeal || d.status === 'appealed') return { ok: false, message: 'You have already appealed this decision.', closesAt: null };
  if (d.status !== 'resolved' || !d.resolvedAt) return { ok: false, message: 'You can appeal once the dispute has a decision.', closesAt: null };
  const closesAt = addDays(d.resolvedAt, APPEAL_WINDOW_DAYS);
  if (now.getTime() > closesAt.getTime()) return { ok: false, message: `The appeal window closed on ${day(closesAt)}.`, closesAt };
  return { ok: true, closesAt };
}

export interface ConflictInput {
  /** Everyone who graded the disputed answer, frozen when the dispute was raised plus the current grader. */
  graderIds: readonly string[];
  /** For an appeal: who decided the original dispute. */
  originalResolverId: string | null;
}

/**
 * Conflict of interest: nobody decides a dispute about their own grading, and an appeal goes to someone other
 * than whoever decided the original. Returns the reason, or null when the user may decide.
 */
export function conflictOfInterest(userId: string, input: ConflictInput): string | null {
  if (input.graderIds.includes(userId)) return 'You graded this answer, so a colleague must decide this dispute.';
  if (input.originalResolverId === userId) return 'You decided the original dispute, so the appeal needs a different reviewer.';
  return null;
}

/** Remedy arithmetic: per candidate, before and after, in marks and percent. */
export interface RemedyImpact {
  scoreBefore: number;
  scoreAfter: number;
  maxBefore: number;
  maxAfter: number;
}

const pct = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 10_000) / 100 : 0);

export function summarizeImpacts(impacts: readonly RemedyImpact[]) {
  const deltas = impacts.map((i) => Math.round((i.scoreAfter - i.scoreBefore) * 1000) / 1000);
  const gains = deltas.filter((d) => d > 1e-9);
  const losses = deltas.filter((d) => d < -1e-9);
  const pDeltas = impacts.map((i) => pct(i.scoreAfter, i.maxAfter) - pct(i.scoreBefore, i.maxBefore));
  return {
    gains: {
      count: gains.length,
      avg: gains.length ? Math.round((gains.reduce((a, b) => a + b, 0) / gains.length) * 1000) / 1000 : 0,
      max: gains.length ? Math.max(...gains) : 0,
    },
    rawLosses: { count: losses.length, max: losses.length ? Math.abs(Math.min(...losses)) : 0 },
    unchanged: deltas.length - gains.length - losses.length,
    percentUp: pDeltas.filter((d) => d > 0.005).length,
    percentDown: pDeltas.filter((d) => d < -0.005).length,
  };
}

export const percentOf = pct;
