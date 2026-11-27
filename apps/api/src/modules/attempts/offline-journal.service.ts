import { and, asc, count, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  answerProvenanceSchema,
  isAutoGraded,
  RT,
  type AnswerChange,
  type AnswerProvenance,
  type OfflineJournal,
  type QuestionType,
} from '@athena/shared';
import type { Database, Executor } from '../../db/client';
import {
  answers,
  attemptEvents,
  attemptItems,
  attempts,
  exams,
  rubricItems,
  users,
} from '../../db/schema';
import { combineItem, recomputeAttempt } from '../../domain/grading/attempt-score';
import { appendLedger } from '../../domain/ledger/ledger';
import { questionType, type Json } from '../../domain/question-types/registry';
import { round3 } from '../../domain/rng';
import { ConflictError, NotFoundError } from '../../lib/errors';
import type { Realtime } from '../../realtime/realtime';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { loadExamForStaff } from '../exams/exam-access';
import { formatResponse, type FormattedResponse } from '../grading/response-format';
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
import { inParallel } from './parallel-reads';

/** What is held on an answer until an examiner decides. */
interface HeldEntry {
  response: Json | null;
  working?: { text: string; scratchPages: string[] } | null;
  /** Authorship record of a written answer or working, applied with it on acceptance. */
  provenance?: AnswerProvenance;
  revision: number;
  changedAt: string | null;
  sealedAt: string;
  receivedAt: string;
}

type ItemRow = typeof attemptItems.$inferSelect;
type AnswerRow = typeof answers.$inferSelect;

/** Marks for one part of a question: the answer, or the method marks for working. Null awaits a grader. */
export interface ScorePart {
  score: number | null;
  max: number;
}

/** One version of an answer, as the examiner compares them. */
export interface AnswerVersion {
  revision: number;
  /** Readable rendering (option text rather than ids), or null when blank. */
  text: string | null;
  format: FormattedResponse['format'];
  language?: string;
  /** Shown working and scratch pages, for questions that award method marks. */
  working: string | null;
  scratchPages: number;
  parts: { answer: ScorePart; working: ScorePart | null };
  /** The question's score with this version, or null while a part awaits a grader. */
  score: number | null;
}

/** A held answer beside the answer that counted at the deadline. */
export interface HeldAnswerView {
  itemId: string;
  /** Question number on the candidate's own paper. */
  number: number;
  type: QuestionType;
  stem: string;
  /** Marks available: answer plus method marks. */
  marks: number;
  /** A voided question counts toward nothing, whichever version stands. */
  voided: boolean;
  /** As submitted at the deadline. `savedAt` is when the server stored it, null if it was never answered. */
  counted: AnswerVersion & { savedAt: string | null };
  /** From the journal. `changedAt` is the device's time of the change. */
  held: AnswerVersion & { changedAt: string | null };
  /**
   * How accepting changes this question's score. min equals max when both versions are fully graded; otherwise
   * the range left open by parts a grader still has to mark, which can land anywhere from 0 to full marks.
   */
  effect: { min: number; max: number };
}

/** An attempt whose late offline answers await a decision. */
export interface HeldJournalView {
  attemptId: string;
  candidate: { id: string; name: string; email: string };
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  /** The server's last contact with the device while the attempt was open. */
  lastSeenAt: string | null;
  journal: {
    /** When the device sealed its journal, on its server-corrected clock. */
    sealedAt: string | null;
    /** The device's own record of its last successful save. */
    lastServerSync: string | null;
    /** Server time the upload arrived. */
    receivedAt: string | null;
    graceMinutes: number;
    entries: number;
    invalid: number;
  };
  maxScore: number;
  /** As recomputeAttempt totals it: graded questions only, with the number still awaiting a grader. */
  scoreNow: { score: number; pendingItems: number };
  scoreIfAccepted: { score: number; pendingItems: number };
  answers: HeldAnswerView[];
}

interface JournalEventPayload {
  sealedAt?: string;
  lastServerSync?: string | null;
  entries?: number;
  invalid?: number;
}

type Grade = Pick<AnswerRow, 'autoScore' | 'manualScore' | 'workingScore'>;

/**
 * The answer as it stands once its held version is accepted. A human grade on a part whose content changed no
 * longer applies, so that part is graded again: automatically where it can be, otherwise by a grader.
 */
function regradeHeld(item: ItemRow, answer: AnswerRow, entry: HeldEntry) {
  const working = entry.working !== undefined ? entry.working : answer.working;
  const responseChanged = canonicalJson(entry.response) !== canonicalJson(answer.response);
  const workingChanged = canonicalJson(working) !== canonicalJson(answer.working);
  const grade = autoGrade(item, {
    response: entry.response,
    working,
    manualScore: responseChanged ? null : answer.manualScore,
    workingScore: workingChanged ? null : answer.workingScore,
  });
  return { working, responseChanged, workingChanged, grade };
}

/** The parts combineItem adds up, with their maximums. */
function partsOf(item: ItemRow, grade: Grade | undefined): AnswerVersion['parts'] {
  const auto = isAutoGraded(item.type);
  return {
    answer: {
      score: auto ? (grade?.autoScore ?? 0) : (grade?.manualScore ?? null),
      max: item.marks,
    },
    working:
      item.workingMarks > 0 ? { score: grade?.workingScore ?? null, max: item.workingMarks } : null,
  };
}

/** The lowest and highest score a version can end with: an ungraded part anywhere from 0 to full marks. */
function scoreRange({ answer, working }: AnswerVersion['parts']) {
  const parts = working ? [answer, working] : [answer];
  return {
    low: parts.reduce((sum, p) => sum + (p.score ?? 0), 0),
    high: parts.reduce((sum, p) => sum + (p.score ?? p.max), 0),
  };
}

function answerVersion(
  item: ItemRow,
  response: Json | null,
  working: AnswerRow['working'],
  revision: number,
  grade: Grade | undefined,
): AnswerVersion {
  const formatted = formatResponse(item.type, item.content, response);
  const method = item.workingMarks > 0;
  return {
    revision,
    text: formatted.text,
    format: formatted.format,
    ...(formatted.language ? { language: formatted.language } : {}),
    working: (method && working?.text?.trim()) || null,
    scratchPages: method ? (working?.scratchPages?.length ?? 0) : 0,
    parts: partsOf(item, grade),
    score: combineItem(item, grade, isAutoGraded(item.type)).score,
  };
}

/** Adds one question to a running total the way recomputeAttempt does: pending questions are counted, not summed. */
function tally(
  total: { score: number; pendingItems: number },
  item: { score: number | null; pending: boolean },
) {
  if (item.pending) total.pendingItems++;
  else total.score += item.score ?? 0;
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
        const provenance =
          entry.provenance === undefined
            ? null
            : answerProvenanceSchema.safeParse(entry.provenance);
        const pending: HeldEntry = {
          response,
          ...(item.workingMarks > 0 && entry.working !== undefined
            ? { working: entry.working }
            : {}),
          ...(provenance?.success ? { provenance: provenance.data } : {}),
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

  /**
   * Attempts of an exam with offline answers awaiting a decision: each held answer beside the one that counted,
   * and the score either way, computed with the same grading the decision applies. Callers hold
   * monitor.intervene; exam access is checked here.
   */
  async listHeld(auth: TenantAuthContext, examId: string): Promise<HeldJournalView[]> {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const withHeld = await this.db
      .selectDistinct({ id: answers.attemptId })
      .from(answers)
      .innerJoin(attempts, eq(attempts.id, answers.attemptId))
      .where(
        and(
          eq(attempts.examId, exam.id),
          eq(attempts.isSandbox, false),
          isNotNull(answers.pendingOffline),
        ),
      );
    const ids = withHeld.map((r) => r.id);
    if (ids.length === 0) return [];

    const [rows, items, answerRows, events] = await inParallel(this.db, [
      () =>
        this.db
          .select({ attempt: attempts, name: users.name, email: users.email })
          .from(attempts)
          .innerJoin(users, eq(users.id, attempts.userId))
          .where(inArray(attempts.id, ids)),
      () =>
        this.db
          .select()
          .from(attemptItems)
          .where(inArray(attemptItems.attemptId, ids))
          .orderBy(asc(attemptItems.position)),
      () => this.db.select().from(answers).where(inArray(answers.attemptId, ids)),
      () =>
        this.db
          .select()
          .from(attemptEvents)
          .where(
            and(
              inArray(attemptEvents.attemptId, ids),
              eq(attemptEvents.type, 'offline_journal_received'),
            ),
          ),
    ]);
    const graceMinutes = settingsOf(exam).reconnectGraceMinutes;

    const views = rows.map(({ attempt, name, email }): HeldJournalView => {
      const event = events.find((e) => e.attemptId === attempt.id);
      const payload = (event?.payload ?? {}) as JournalEventPayload;
      const byItem = new Map(
        answerRows.filter((a) => a.attemptId === attempt.id).map((a) => [a.attemptItemId, a]),
      );
      const scoreNow = { score: 0, pendingItems: 0 };
      const scoreIfAccepted = { score: 0, pendingItems: 0 };
      let maxScore = 0;
      let number = 0;
      const held: HeldAnswerView[] = [];
      for (const item of items.filter((i) => i.attemptId === attempt.id)) {
        number++;
        const answer = byItem.get(item.id);
        const auto = isAutoGraded(item.type);
        const entry = (answer?.pendingOffline ?? null) as HeldEntry | null;
        const regraded = answer && entry ? regradeHeld(item, answer, entry) : null;
        const counted = combineItem(item, answer, auto);
        const accepted = regraded ? combineItem(item, regraded.grade, auto) : counted;
        // As recomputeAttempt: a voided question counts toward neither the score nor the maximum.
        const voided = item.voidReason !== null;
        if (!voided) {
          maxScore += item.marks + item.workingMarks;
          tally(scoreNow, counted);
          tally(scoreIfAccepted, accepted);
        }
        if (!answer || !entry || !regraded) continue;
        const before = answerVersion(
          item,
          answer.response,
          answer.working,
          answer.revision,
          answer,
        );
        const after = answerVersion(
          item,
          entry.response,
          regraded.working,
          entry.revision,
          regraded.grade,
        );
        const from = scoreRange(before.parts);
        const to = scoreRange(after.parts);
        held.push({
          itemId: item.id,
          number,
          type: item.type,
          stem: typeof item.content.stem === 'string' ? item.content.stem : '',
          marks: item.marks + item.workingMarks,
          voided,
          counted: { ...before, savedAt: answer.answeredAt?.toISOString() ?? null },
          held: { ...after, changedAt: entry.changedAt },
          effect: voided
            ? { min: 0, max: 0 }
            : { min: round3(to.low - from.high), max: round3(to.high - from.low) },
        });
      }
      return {
        attemptId: attempt.id,
        candidate: { id: attempt.userId, name, email },
        startedAt: attempt.startedAt.toISOString(),
        deadlineAt: attempt.deadlineAt.toISOString(),
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        lastSeenAt: attempt.lastSeenAt?.toISOString() ?? null,
        journal: {
          sealedAt: payload.sealedAt ?? null,
          lastServerSync: payload.lastServerSync ?? null,
          receivedAt: event?.createdAt.toISOString() ?? null,
          graceMinutes,
          entries: payload.entries ?? held.length,
          invalid: payload.invalid ?? 0,
        },
        maxScore: round3(maxScore),
        scoreNow: {
          score: round3(Math.max(0, scoreNow.score)),
          pendingItems: scoreNow.pendingItems,
        },
        scoreIfAccepted: {
          score: round3(Math.max(0, scoreIfAccepted.score)),
          pendingItems: scoreIfAccepted.pendingItems,
        },
        answers: held,
      };
    });
    // Oldest upload first: the order they arrived in.
    return views.sort((a, b) =>
      (a.journal.receivedAt ?? '').localeCompare(b.journal.receivedAt ?? ''),
    );
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
        const { working, responseChanged, workingChanged, grade } = regradeHeld(
          item,
          answer,
          entry,
        );
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
            ...(entry.provenance ? { provenance: entry.provenance } : {}),
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
