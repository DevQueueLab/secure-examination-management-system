import { and, count, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { AttemptEventType, EventSeverity } from '@athena/shared';
import type { Executor } from '../../db/client';
import { attemptEvents, attempts, memberships, users } from '../../db/schema';
import { initialsOf, safePayload } from '../monitoring/analysis';
import type { CandidateRef, MonitorEvent } from '../monitoring/monitoring.types';
import { reviewPriorityFor, type ReviewPriority } from './attempt.policy';

type AttemptRef = { id: string; examId: string; organizationId: string };
type EventRow = typeof attemptEvents.$inferSelect;

const INDICATORS: EventSeverity[] = ['low', 'medium', 'high'];

/** Insert values for one timeline event, stamped with server time from the engine's clock. */
export function timelineEvent(
  attempt: AttemptRef,
  type: AttemptEventType,
  severity: EventSeverity,
  payload: Record<string, unknown>,
  at: Date,
  clientTs: Date | null = null,
): typeof attemptEvents.$inferInsert {
  return {
    attemptId: attempt.id,
    examId: attempt.examId,
    organizationId: attempt.organizationId,
    type,
    severity,
    payload,
    clientTs,
    createdAt: at,
  };
}

/**
 * Recomputes the attempt's review priority from indicators nobody has cleared ("no concern"),
 * with the same rule the monitor uses after a review.
 */
export async function refreshReviewPriority(
  tx: Executor,
  attemptId: string,
): Promise<ReviewPriority> {
  const rows = await tx
    .select({ severity: attemptEvents.severity, n: count() })
    .from(attemptEvents)
    .where(
      and(
        eq(attemptEvents.attemptId, attemptId),
        inArray(attemptEvents.severity, INDICATORS),
        or(isNull(attemptEvents.reviewStatus), ne(attemptEvents.reviewStatus, 'no_concern')),
      ),
    )
    .groupBy(attemptEvents.severity);
  const counts = { low: 0, medium: 0, high: 0 };
  for (const r of rows) if (r.severity !== 'info') counts[r.severity] = r.n;
  const priority = reviewPriorityFor(counts);
  await tx.update(attempts).set({ reviewPriority: priority }).where(eq(attempts.id, attemptId));
  return priority;
}

/** How the live monitor names a candidate (name, roll number, initials). */
export async function candidateRefOf(
  db: Executor,
  userId: string,
  organizationId: string,
): Promise<CandidateRef> {
  const [row] = await db
    .select({ name: users.name, rollNumber: memberships.externalId })
    .from(users)
    .leftJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.organizationId, organizationId)),
    )
    .where(eq(users.id, userId))
    .limit(1);
  const name = row?.name ?? 'Candidate';
  return { userId, name, rollNumber: row?.rollNumber ?? null, initials: initialsOf(name) };
}

/** The monitor's event shape, so pushes from the engine and from monitoring render identically. */
export function toMonitorEvent(row: EventRow, candidate: CandidateRef): MonitorEvent {
  return {
    id: row.id,
    attemptId: row.attemptId,
    candidate,
    type: row.type,
    severity: row.severity,
    createdAt: row.createdAt.toISOString(),
    clientTs: row.clientTs?.toISOString() ?? null,
    payload: safePayload(row.payload),
    review:
      row.severity === 'info'
        ? null
        : { status: row.reviewStatus ?? 'open', note: null, reviewedAt: null, reviewedBy: null },
  };
}
