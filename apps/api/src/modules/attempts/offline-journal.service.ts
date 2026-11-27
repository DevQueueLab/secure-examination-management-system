import { and, asc, count, eq, isNotNull } from 'drizzle-orm';
import { isAutoGraded, RT, type AnswerChange, type OfflineJournal } from '@athena/shared';
import type { Database, Executor } from '../../db/client';
import {
  answers,
  attemptEvents,
  attemptItems,
  attempts,
  exams,
  rubricItems,
} from '../../db/schema';
import { recomputeAttempt } from '../../domain/grading/attempt-score';
import { appendLedger } from '../../domain/ledger/ledger';
import { questionType, type Json } from '../../domain/question-types/registry';
import { ConflictError, NotFoundError } from '../../lib/errors';
import type { Realtime } from '../../realtime/realtime';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { loadExamForStaff } from '../exams/exam-access';
import { AttemptClosedError } from './attempt.errors';
import {
  candidateRefOf,
  refreshReviewPriority,
  timelineEvent,
  toMonitorEvent,
} from './attempt.events';
import { autoGrade } from './attempt.grading';
import { canonicalJson, isNewerRevision } from './attempt.policy';
import { settingsOf } from './attempt.service';

/** What is held on an answer until an examiner decides. */
interface HeldEntry {
  response: Json | null;
  working?: { text: string; scratchPages: string[] } | null;
  revision: number;
  changedAt: string | null;
  sealedAt: string;
  receivedAt: string;
}

export interface JournalDecision {
  accepted: boolean;
  /** Answers replaced by the held offline versions (0 when rejected). */
  applied: number;
  score: number | null;
  maxScore: number;
}

/**
 * Offline journal (IC-5.3). When the deadline passes while a candidate is offline, the attempt is finalized on
 * time ("timeout") and the client seals its local journal. On reconnect, within the exam's grace period, the
 * journal is uploaded here and its newer answers are HELD on the answer rows (pendingOffline). They never count
 * automatically: an examiner accepts them (re-grade, recompute, ledger) or rejects them, and either way the hold
 * is cleared and audited. One upload per attempt; a repeated upload (a retry after a lost response) gets the same answer.
 */
export class OfflineJournalService {
  private readonly db: Executor;
  private readonly now: () => Date;

  constructor(
    private readonly deps: {
      db: Executor;
      audit: Pick<AuditService, 'record'>;
      realtime: Realtime;
      now?: () => Date;
    },
  ) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  async submit(
    auth: TenantAuthContext,
    attemptId: string,
    journal: OfflineJournal,
  ): Promise<{ held: number }> {
    const now = this.now();
    const [row] = await this.db
      .select({ attempt: attempts, settings: exams.settings })
      .from(attempts)
      .innerJoin(exams, eq(exams.id, attempts.examId))
      .where(
        and(
          eq(attempts.id, attemptId),
          eq(attempts.organizationId, auth.organization.id),
          eq(attempts.userId, auth.user.id),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError('Attempt');
    const { attempt } = row;
    // A retry after a lost response gets the first upload's answer, whatever has happened since.
    const repeat = await this.alreadyReceived(this.db, attempt.id);
    if (repeat !== null) return { held: repeat };
    if (attempt.status === 'in_progress')
      throw new ConflictError('Your attempt is still open, so your answers are saved normally.');
    if (attempt.submitReason !== 'timeout')
      throw new AttemptClosedError(
        'This attempt was submitted, so offline answers cannot be added.',
      );
    const grace = settingsOf({ settings: row.settings }).reconnectGraceMinutes;
    if (now.getTime() > attempt.deadlineAt.getTime() + grace * 60_000) {
      throw new AttemptClosedError(
        `Offline answers are accepted for ${grace} minutes after the deadline, and this upload arrived later.`,
      );
    }

    const result = await (this.db as Database).transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(attempts)
        .where(eq(attempts.id, attempt.id))
        .limit(1)
        .for('update');
      if (!locked) throw new NotFoundError('Attempt');
      // Two uploads racing: the first one stands and cannot be replaced.
      const concurrent = await this.alreadyReceived(tx, attempt.id);
      if (concurrent !== null) return { held: concurrent, event: null };

      const items = await tx
        .select({
          id: attemptItems.id,
          type: attemptItems.type,
          content: attemptItems.content,
          workingMarks: attemptItems.workingMarks,
        })
        .from(attemptItems)
        .where(eq(attemptItems.attemptId, attempt.id));
      const stored = await tx
        .select({ id: answers.id, itemId: answers.attemptItemId, revision: answers.revision })
        .from(answers)
        .where(eq(answers.attemptId, attempt.id));
      const storedByItem = new Map(stored.map((s) => [s.itemId, s]));
      const itemById = new Map(items.map((i) => [i.id, i]));

      // The newest journal entry per item; only entries newer than what was counted at the deadline are held.
      const latest = new Map<string, AnswerChange>();
      for (const entry of journal.answers) {
        const previous = latest.get(entry.itemId);
        if (itemById.has(entry.itemId) && (!previous || entry.revision > previous.revision))
          latest.set(entry.itemId, entry);
      }
      let held = 0;
      let invalid = 0;
      for (const [itemId, entry] of latest) {
        const item = itemById.get(itemId)!;
        const answer = storedByItem.get(itemId);
        if (!answer || !isNewerRevision(entry.revision, answer.revision)) continue;
        let response: Json | null = null;
        try {
          response =
            entry.response === null
              ? null
              : questionType(item.type).parseResponse(item.content, entry.response);
        } catch {
          invalid++;
          continue;
        }
        const pending: HeldEntry = {
          response,
          ...(item.workingMarks > 0 && entry.working !== undefined
            ? { working: entry.working }
            : {}),
          revision: entry.revision,
          changedAt: entry.changedAt ?? null,
          sealedAt: journal.sealedAt,
          receivedAt: now.toISOString(),
        };
        await tx
          .update(answers)
          .set({ pendingOffline: { ...pending } })
          .where(eq(answers.id, answer.id));
        held++;
      }
      const [event] = await tx
        .insert(attemptEvents)
        .values(
          timelineEvent(
            attempt,
            'offline_journal_received',
            'medium',
            {
              held,
              invalid,
              entries: journal.answers.length,
              sealedAt: journal.sealedAt,
              lastServerSync: journal.lastServerSync ?? null,
              chain: journal.chain?.slice(0, 64) ?? null,
            },
            now,
          ),
        )
        .returning();
      await refreshReviewPriority(tx, attempt.id);
      return { held, event: event! };
    });

    if (!result.event) return { held: result.held };
    if (!attempt.isSandbox) {
      const candidate = await candidateRefOf(this.db, attempt.userId, attempt.organizationId);
      this.deps.realtime.toExamStaff(attempt.examId, RT.attemptIncident, {
        attemptId: attempt.id,
        event: toMonitorEvent(result.event, candidate),
      });
    }
    await this.deps.audit.record({
      organizationId: attempt.organizationId,
      actorId: auth.user.id,
      action: 'attempt.offline_journal_received',
      entityType: 'attempt',
      entityId: attempt.id,
      summary: `Offline answers held for review (${result.held})`,
      metadata: { examId: attempt.examId, held: result.held, sealedAt: journal.sealedAt },
    });
    return { held: result.held };
  }

  /** Answers still held for an attempt whose journal has arrived, or null when no journal has. */
  private async alreadyReceived(db: Executor, attemptId: string): Promise<number | null> {
    const [received] = await db
      .select({ id: attemptEvents.id })
      .from(attemptEvents)
      .where(
        and(
          eq(attemptEvents.attemptId, attemptId),
          eq(attemptEvents.type, 'offline_journal_received'),
        ),
      )
      .limit(1);
    if (!received) return null;
    const [pending] = await db
      .select({ n: count() })
      .from(answers)
      .where(and(eq(answers.attemptId, attemptId), isNotNull(answers.pendingOffline)));
    return pending?.n ?? 0;
  }

  /** Examiner decision on held offline answers. Callers hold monitor.intervene; exam access is checked here. */
  async decide(
    auth: TenantAuthContext,
    attemptId: string,
    input: { accept: boolean; note?: string | null },
  ): Promise<JournalDecision> {
    const [attempt] = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.id, attemptId),
          eq(attempts.organizationId, auth.organization.id),
          eq(attempts.isSandbox, false),
        ),
      )
      .limit(1);
    if (!attempt) throw new NotFoundError('Attempt');
    await loadExamForStaff(this.db, auth, attempt.examId);
    const now = this.now();
    const note = input.note?.trim() || null;

    const outcome = await (this.db as Database).transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(attempts)
        .where(eq(attempts.id, attempt.id))
        .limit(1)
        .for('update');
      const held = await tx
        .select({ answer: answers, item: attemptItems })
        .from(answers)
        .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
        .where(and(eq(answers.attemptId, attempt.id), isNotNull(answers.pendingOffline)))
        .orderBy(asc(attemptItems.position));
      if (!locked || held.length === 0)
        throw new ConflictError('No offline answers are waiting for review on this attempt');

      if (!input.accept) {
        await tx
          .update(answers)
          .set({ pendingOffline: null })
          .where(and(eq(answers.attemptId, attempt.id), isNotNull(answers.pendingOffline)));
        return { applied: 0, score: locked.score, maxScore: locked.maxScore };
      }

      const rubricTarget = new Map(
        (
          await tx
            .select({ id: rubricItems.id, target: rubricItems.target })
            .from(rubricItems)
            .where(eq(rubricItems.examId, attempt.examId))
        ).map((r) => [r.id, r.target]),
      );
      const itemScores: Record<string, number | null> = {};
      for (const { answer, item } of held) {
        const entry = answer.pendingOffline as unknown as HeldEntry;
        const working = entry.working !== undefined ? entry.working : answer.working;
        // A human grade on a part whose content changed no longer applies: that part is graded again.
        const responseChanged = canonicalJson(entry.response) !== canonicalJson(answer.response);
        const workingChanged = canonicalJson(working) !== canonicalJson(answer.working);
        const grade = autoGrade(item, {
          response: entry.response,
          working,
          manualScore: responseChanged ? null : answer.manualScore,
          workingScore: workingChanged ? null : answer.workingScore,
        });
        const keptRubric = answer.rubricItemIds.filter((id) => {
          const target = rubricTarget.get(id);
          return !(
            (target === 'answer' && responseChanged) ||
            (target === 'working' && workingChanged)
          );
        });
        await tx
          .update(answers)
          .set({
            response: entry.response,
            working,
            revision: entry.revision,
            answeredAt: questionType(item.type).isAnswered(entry.response) ? now : null,
            pendingOffline: null,
            ...grade,
            rubricItemIds: keptRubric,
            ...(responseChanged ? { manualAdjustment: 0 } : {}),
            ...(workingChanged ? { workingAdjustment: 0 } : {}),
          })
          .where(eq(answers.id, answer.id));
        itemScores[item.id] = isAutoGraded(item.type) ? grade.autoScore : grade.manualScore;
      }
      const totals = await recomputeAttempt(tx, attempt.id);
      await tx
        .update(attempts)
        .set({ submitReason: 'offline_sync', updatedAt: now })
        .where(eq(attempts.id, attempt.id));
      await appendLedger(tx, {
        organizationId: attempt.organizationId,
        examId: attempt.examId,
        attemptId: attempt.id,
        action: 'offline_answers_accepted',
        actorId: auth.user.id,
        previousScore: locked.score,
        newScore: totals.score,
        reason: note,
        metadata: { items: held.length, itemScores, pendingItems: totals.pending },
      });
      return { applied: held.length, score: totals.score, maxScore: totals.maxScore };
    });

    await this.deps.audit.record({
      organizationId: attempt.organizationId,
      actorId: auth.user.id,
      action: input.accept
        ? 'attempt.offline_journal_accepted'
        : 'attempt.offline_journal_rejected',
      entityType: 'attempt',
      entityId: attempt.id,
      summary: input.accept
        ? `Accepted ${outcome.applied} offline answer(s)`
        : 'Rejected held offline answers',
      metadata: {
        examId: attempt.examId,
        note,
        applied: outcome.applied,
        scoreBefore: attempt.score,
        scoreAfter: outcome.score,
      },
    });
    return { accepted: input.accept, ...outcome };
  }
}
