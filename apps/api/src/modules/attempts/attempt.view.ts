import { and, asc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  weaveFingerprint,
  type AnnouncementView,
  type ClarificationView,
  type ScratchpadState,
} from '@athena/shared';
import type { Executor } from '../../db/client';
import {
  announcementReads,
  announcements,
  attemptItems,
  clarifications,
  scratchpads,
} from '../../db/schema';

/**
 * Candidate-facing readers. Everything returned here is safe to send to the candidate's browser:
 * no answer keys, no other candidates' identities, no explanations before results.
 */

/** Content fields that can give the answer away; they are shown only with published results. */
const POST_RESULT_FIELDS = new Set(['explanation']);

/**
 * The item content a candidate may see during the attempt. When watermarking is on, the attempt fingerprint
 * is woven invisibly into the stem so a leaked copy of the paper traces back to this attempt (IC-5.5).
 */
export function candidateContent(
  content: Record<string, unknown>,
  fingerprint: string | null,
): Record<string, unknown> {
  const safe = Object.fromEntries(
    Object.entries(content).filter(([key]) => !POST_RESULT_FIELDS.has(key)),
  );
  if (fingerprint && typeof safe.stem === 'string')
    safe.stem = weaveFingerprint(safe.stem, fingerprint);
  return safe;
}

/** Exam-wide announcements plus those addressed to this candidate, oldest first, optionally only newer than one. */
export async function announcementsFor(
  db: Executor,
  examId: string,
  userId: string,
  newerThanId?: string,
): Promise<AnnouncementView[]> {
  const rows = await db
    .select({
      id: announcements.id,
      body: announcements.body,
      priority: announcements.priority,
      createdAt: announcements.createdAt,
      readAt: announcementReads.readAt,
    })
    .from(announcements)
    .leftJoin(
      announcementReads,
      and(
        eq(announcementReads.announcementId, announcements.id),
        eq(announcementReads.userId, userId),
      ),
    )
    .where(
      and(
        eq(announcements.examId, examId),
        or(isNull(announcements.targetUserId), eq(announcements.targetUserId, userId)),
        // Compared in SQL so microsecond timestamps are not truncated to JavaScript milliseconds.
        newerThanId
          ? sql`${announcements.createdAt} > coalesce((select a2.created_at from announcements a2 where a2.id = ${newerThanId}), '-infinity'::timestamptz)`
          : undefined,
      ),
    )
    .orderBy(asc(announcements.createdAt));
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    read: r.readAt !== null,
  }));
}

/**
 * The candidate's own clarification requests plus answered broadcasts. A broadcast asked on another
 * candidate's paper is linked to this candidate's copy of the same question (or to none).
 */
export async function clarificationsFor(
  db: Executor,
  examId: string,
  attemptId: string,
  items: { id: string; questionId: string }[],
): Promise<ClarificationView[]> {
  const itemByQuestion = new Map(items.map((i) => [i.questionId, i.id]));
  const rows = await db
    .select({
      id: clarifications.id,
      attemptId: clarifications.attemptId,
      attemptItemId: clarifications.attemptItemId,
      questionId: attemptItems.questionId,
      question: clarifications.question,
      answer: clarifications.answer,
      broadcast: clarifications.broadcast,
      createdAt: clarifications.createdAt,
      answeredAt: clarifications.answeredAt,
    })
    .from(clarifications)
    .leftJoin(attemptItems, eq(attemptItems.id, clarifications.attemptItemId))
    .where(
      and(
        eq(clarifications.examId, examId),
        or(
          eq(clarifications.attemptId, attemptId),
          and(eq(clarifications.broadcast, true), isNotNull(clarifications.answer)),
        ),
      ),
    )
    .orderBy(asc(clarifications.createdAt));
  return rows.map((r) => {
    const mine = r.attemptId === attemptId;
    return {
      id: r.id,
      question: r.question,
      answer: r.answer,
      itemId: mine
        ? r.attemptItemId
        : r.questionId
          ? (itemByQuestion.get(r.questionId) ?? null)
          : null,
      broadcast: r.broadcast,
      mine,
      createdAt: r.createdAt.toISOString(),
      answeredAt: r.answeredAt?.toISOString() ?? null,
    };
  });
}

export async function scratchpadsFor(db: Executor, attemptId: string): Promise<ScratchpadState[]> {
  const rows = await db
    .select({
      pageKey: scratchpads.pageKey,
      kind: scratchpads.kind,
      data: scratchpads.data,
      revision: scratchpads.revision,
    })
    .from(scratchpads)
    .where(eq(scratchpads.attemptId, attemptId))
    .orderBy(asc(scratchpads.pageKey));
  return rows;
}
