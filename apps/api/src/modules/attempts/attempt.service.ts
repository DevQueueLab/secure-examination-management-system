/**
 * Attempt engine: the only code that starts, autosaves, times and finalizes exam attempts.
 *
 * Public API
 * ----------
 * Candidate calls take the caller's TenantAuthContext and only ever touch the caller's own attempts
 * (attempt.userId === auth.user.id in the active organization; anything else is "not found"):
 *   start(auth, input)              -> AttemptView        Idempotent: resumes an attempt in progress.
 *   getView(auth, attemptId)        -> AttemptView        Claims the single active device when it is free.
 *   claim(auth, attemptId, client)  -> AttemptView        Takes the attempt over from another device.
 *   sync(auth, attemptId, request)  -> SyncResponse       Autosave, heartbeat and integrity events.
 *   submit(auth, attemptId, request)-> SubmissionReceipt  Final autosave, then finalize. Idempotent.
 *   receipt(auth, attemptId)        -> SubmissionReceipt
 *   startSandbox(auth, examId) / discardSandbox(auth, attemptId)   Examiner previews (exams.manage).
 *
 * Staff interventions take ids only: the caller authorizes first (permission + loadExamForStaff):
 *   extendTime(attemptId, seconds, reason, actorId)   Moves the deadline of an attempt in progress.
 *   forceSubmit(attemptId, actorId, reason)            Finalizes now on the candidate's behalf.
 *   finalize(attemptId, reason, actorId?, note?)       Idempotent; also used by the deadline job.
 *
 * Invariants
 * - The server decides time. The deadline is fixed at start and moves only through audited extensions.
 * - Writes are accepted until deadline + DEADLINE_GRACE_MS, then the attempt is finalized ("timeout").
 * - Answers carry revisions; the database applies a write only when its revision is newer.
 * - Candidates never receive answer keys or explanations; staff pushes never contain answer text.
 * - Every score written at submission goes through recomputeAttempt and the grade ledger in one transaction.
 * - Time comes only from the injected clock, so the seed can replay past sittings and tests can freeze time.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  answerProvenanceSchema,
  examSettingsSchema,
  isAutoGraded,
  RT,
  uuidParam,
  type AttemptEventType,
  type AttemptView,
  type ExamSettings,
  type StartAttemptInput,
  type SubmissionReceipt,
  type submitAttemptSchema,
  type SubmitReason,
  type SyncRequest,
  type SyncResponse,
} from '@athena/shared';
import type { Container } from '../../container';
import type { Database, Executor } from '../../db/client';
import {
  announcementReads,
  announcements,
  answers,
  attemptEvents,
  attemptItems,
  attempts,
  examEnrollments,
  exams,
  examSections,
  questions,
  scratchpads,
  sessions,
} from '../../db/schema';
import { combineItem, recomputeAttempt } from '../../domain/grading/attempt-score';
import { appendLedger } from '../../domain/ledger/ledger';
import { assemblePaper } from '../../domain/paper';
import { questionType, type Json } from '../../domain/question-types/registry';
import { round3 } from '../../domain/rng';
import { randomCode, randomToken } from '../../lib/crypto';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { Realtime } from '../../realtime/realtime';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { loadExamForStaff } from '../exams/exam-access';
import { AttemptClosedError, ExamNotAvailableError, SessionTakenOverError } from './attempt.errors';
import {
  candidateRefOf,
  refreshReviewPriority,
  timelineEvent,
  toMonitorEvent,
} from './attempt.events';
import { autoGrade } from './attempt.grading';
import {
  accessCodeMatches,
  boundedPayload,
  CLIENT_EVENT_TYPES,
  computeDeadline,
  eventSeverity,
  isPastDeadline,
  receiptCode,
  startBlock,
  startBlockMessage,
} from './attempt.policy';
import {
  announcementsFor,
  candidateContent,
  clarificationsFor,
  scratchpadsFor,
} from './attempt.view';
import { deadlineGate } from './deadline-gate';
import { inParallel } from './parallel-reads';
import { loadExamPaper, markingFor, toPaperInput, workingMarksOf } from './exam-paper.repository';

type AttemptRow = typeof attempts.$inferSelect;
type ExamRow = typeof exams.$inferSelect;
type EventRow = typeof attemptEvents.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type SubmitRequest = z.infer<typeof submitAttemptSchema>;

export interface AttemptServiceDeps {
  /** The database, or an enclosing transaction (tests): engine transactions then become savepoints. */
  db: Executor;
  /** Who-did-what records (the seed passes a recorder stamped with its own clock). */
  audit: Pick<AuditService, 'record'>;
  realtime: Realtime;
  /** HMAC key for submission receipts (the ledger secret, never stored in the database). */
  receiptSecret: string;
  /** Server clock. */
  now?: () => Date;
  /** Resolves when lazy deadline enforcement may run (see DeadlineGate). */
  deadlinesReady?: () => Promise<void>;
}

export interface FinalizeResult {
  /** False when the attempt was already submitted (finalize is idempotent). */
  finalized: boolean;
  attemptId: string;
  submittedAt: Date | null;
  submitReason: SubmitReason | null;
  receiptCode: string | null;
}

/** Timeline event recorded for each way an attempt can end. */
const SUBMIT_EVENT: Record<SubmitReason, AttemptEventType> = {
  candidate: 'submitted',
  timeout: 'auto_submitted',
  proctor: 'force_submitted',
  offline_sync: 'submitted',
};
const SUBMIT_EVENT_TYPES = [...new Set(Object.values(SUBMIT_EVENT))];

/** Live progress pushes to the monitor are throttled per attempt. */
const PROGRESS_INTERVAL_MS = 2_000;
const MAX_EXTENSION_SECONDS = 24 * 3600;

export const settingsOf = (exam: Pick<ExamRow, 'settings'>): ExamSettings =>
  examSettingsSchema.parse(exam.settings);

/** Unique violations arrive wrapped (DrizzleQueryError -> pg DatabaseError); walk the cause chain. */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (
    let e = err as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;
    e && typeof e === 'object';
    e = e.cause as typeof e
  ) {
    if (e.code === '23505') return e.constraint === constraint;
  }
  return false;
}

export class AttemptService {
  private readonly db: Executor;
  private readonly now: () => Date;
  private readonly lastProgressPush = new Map<string, number>();

  constructor(private readonly deps: AttemptServiceDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  // ------------------------------------------------------------------------------------------ start

  async start(auth: TenantAuthContext, input: StartAttemptInput): Promise<AttemptView> {
    const { exam, enrollment } = await this.enrolledExam(auth, input.examId);
    const existing = await this.realAttemptOf(exam.id, auth.user.id);
    if (existing) return this.resume(auth, existing);

    const now = this.now();
    const settings = settingsOf(exam);
    const block = startBlock({ ...exam, lateEntryMinutes: settings.lateEntryMinutes }, now);
    if (block) throw new ExamNotAvailableError(startBlockMessage(block, input.clientInfo.timezone));
    if (settings.accessCode && !accessCodeMatches(settings.accessCode, input.accessCode)) {
      throw new ValidationError('That access code is not right. Check it with your invigilator.', {
        accessCode: 'That access code is not right',
      });
    }
    // startAttemptSchema already requires the pledge; it is recorded when the exam has an honor code.
    const deadlineAt = computeDeadline({
      startedAt: now,
      durationMinutes: exam.durationMinutes,
      timeMultiplier: enrollment.timeMultiplier,
      extraMinutes: enrollment.extraMinutes,
      windowClosesAt: exam.windowClosesAt,
    });

    let attemptId: string;
    try {
      attemptId = await this.createAttempt({
        auth,
        exam,
        settings,
        isSandbox: false,
        now,
        deadlineAt,
        clientInfo: input.clientInfo,
        pledged: !!settings.integrity.honorCode,
      });
    } catch (err) {
      // Two tabs racing to start: the partial unique index lets exactly one in, the other resumes it.
      if (!isUniqueViolation(err, 'attempts_one_real_per_candidate_uq')) throw err;
      return this.resume(auth, (await this.realAttemptOf(exam.id, auth.user.id))!);
    }

    const view = await this.getView(auth, attemptId);
    this.deps.realtime.toExamStaff(exam.id, RT.attemptStarted, {
      attemptId,
      examId: exam.id,
      candidate: await candidateRefOf(this.db, auth.user.id, exam.organizationId),
      startedAt: view.startedAt,
      deadlineAt: view.deadlineAt,
      itemCount: view.items.length,
    });
    await this.deps.audit.record({
      organizationId: exam.organizationId,
      actorId: auth.user.id,
      action: 'attempt.started',
      entityType: 'attempt',
      entityId: attemptId,
      summary: `Started ${exam.title}`,
      metadata: { examId: exam.id, deadlineAt: view.deadlineAt },
    });
    return view;
  }

  /** Re-entering from the lobby: an attempt in progress continues, a finished one cannot be restarted. */
  private async resume(auth: TenantAuthContext, attempt: AttemptRow): Promise<AttemptView> {
    const current = await this.enforceDeadline(attempt);
    if (current.status !== 'in_progress') {
      throw new AttemptClosedError(
        current.submitReason === 'timeout'
          ? 'Time is up: your attempt was submitted automatically.'
          : 'You have already submitted this exam.',
      );
    }
    const view = await this.getView(auth, current.id);
    await this.db
      .insert(attemptEvents)
      .values(timelineEvent(current, 'resumed', 'info', {}, this.now()));
    return view;
  }

  /** Assembles the paper and stores the attempt with its frozen items in one transaction. */
  private async createAttempt(a: {
    auth: TenantAuthContext;
    exam: ExamRow;
    settings: ExamSettings;
    isSandbox: boolean;
    now: Date;
    deadlineAt: Date;
    clientInfo: Record<string, unknown>;
    pledged: boolean;
  }): Promise<string> {
    const sections = await loadExamPaper(this.db, a.exam.id);
    if (!sections.some((s) => s.questions.length > 0))
      throw new ExamNotAvailableError('This exam has no questions yet');
    const seed = randomToken(18);
    const paper = assemblePaper(toPaperInput(sections, a.settings), seed);
    const items = paper.items.map((item) => ({
      examQuestionId: item.question.examQuestionId,
      sectionId: item.sectionId,
      questionId: item.question.questionId,
      questionVersionId: item.question.questionVersionId,
      position: item.position,
      type: item.question.type,
      marks: item.question.marks,
      workingMarks: workingMarksOf(item.prepared.content),
      content: item.prepared.content,
      answerKey: item.prepared.answerKey,
      marking: markingFor(a.settings.marking, item.question.markingOverride),
      variant: item.prepared.variant,
    }));
    const maxScore = round3(items.reduce((total, i) => total + i.marks + i.workingMarks, 0));

    for (let tries = 1; ; tries++) {
      try {
        return await this.transaction(async (tx) => {
          const [row] = await tx
            .insert(attempts)
            .values({
              organizationId: a.exam.organizationId,
              examId: a.exam.id,
              userId: a.auth.user.id,
              isSandbox: a.isSandbox,
              seed,
              fingerprint: randomCode(6),
              startedAt: a.now,
              deadlineAt: a.deadlineAt,
              lastSeenAt: a.now,
              activeSessionId: a.auth.sessionId,
              clientInfo: a.clientInfo,
              pledgeAcceptedAt: a.pledged ? a.now : null,
              maxScore,
              paperExpected: Math.round(paper.paperExpected * 10_000) / 10_000,
              createdAt: a.now,
              updatedAt: a.now,
            })
            .returning();
          const attempt = row!;
          const stored = await tx
            .insert(attemptItems)
            .values(items.map((i) => ({ ...i, attemptId: attempt.id })))
            .returning({ id: attemptItems.id });
          // One answer row per item from the start: grading and analytics always see the whole paper.
          await tx.insert(answers).values(
            stored.map((s) => ({
              attemptId: attempt.id,
              attemptItemId: s.id,
              createdAt: a.now,
              updatedAt: a.now,
            })),
          );
          if (!a.isSandbox) {
            await tx
              .update(questions)
              .set({ exposureCount: sql`${questions.exposureCount} + 1` })
              .where(
                inArray(
                  questions.id,
                  items.map((i) => i.questionId),
                ),
              );
          }
          await tx.insert(attemptEvents).values(
            timelineEvent(
              attempt,
              'started',
              'info',
              {
                sandbox: a.isSandbox,
                itemCount: items.length,
                deadlineAt: a.deadlineAt.toISOString(),
              },
              a.now,
            ),
          );
          return attempt.id;
        });
      } catch (err) {
        if (tries < 3 && isUniqueViolation(err, 'attempts_fingerprint_unique')) continue;
        throw err;
      }
    }
  }

  // ------------------------------------------------------------------------------------------ view & device

  async getView(auth: TenantAuthContext, attemptId: string): Promise<AttemptView> {
    let attempt = await this.enforceDeadline(await this.ownedAttempt(auth, attemptId));
    if (attempt.status === 'in_progress') attempt = await this.holdSession(auth, attempt);
    return this.buildView(auth, attempt);
  }

  /** Moves the attempt to the caller's device. The previous device is told to stop (and is refused on sync). */
  async claim(
    auth: TenantAuthContext,
    attemptId: string,
    client: { userAgent?: string } = {},
  ): Promise<AttemptView> {
    const attempt = await this.enforceDeadline(await this.ownedAttempt(auth, attemptId));
    if (attempt.status !== 'in_progress') throw new AttemptClosedError();
    if (!attempt.activeSessionId || attempt.activeSessionId === auth.sessionId)
      return this.getView(auth, attempt.id);

    const now = this.now();
    const event = await this.transaction(async (tx) => {
      await tx
        .update(attempts)
        .set({ activeSessionId: auth.sessionId, lastSeenAt: now })
        .where(eq(attempts.id, attempt.id));
      const [row] = await tx
        .insert(attemptEvents)
        .values(
          timelineEvent(
            attempt,
            'device_switched',
            'low',
            { userAgent: client.userAgent?.slice(0, 120) ?? 'unknown' },
            now,
          ),
        )
        .returning();
      await refreshReviewPriority(tx, attempt.id);
      return row!;
    });
    this.deps.realtime.toAttempt(attempt.id, RT.sessionTakenOver, { attemptId: attempt.id });
    await this.pushIncidents(attempt, [event]);
    return this.getView(auth, attempt.id);
  }

  /**
   * Single active device. The caller keeps the attempt when it already holds it, and takes it when it is free:
   * never claimed, or held by a session that has since signed out or expired. A live session elsewhere wins
   * until the candidate explicitly claims.
   */
  private async holdSession(auth: TenantAuthContext, attempt: AttemptRow): Promise<AttemptRow> {
    if (attempt.activeSessionId === auth.sessionId) return attempt;
    if (attempt.activeSessionId && (await this.isSessionAlive(attempt.activeSessionId)))
      throw new SessionTakenOverError();
    const [taken] = await this.db
      .update(attempts)
      .set({ activeSessionId: auth.sessionId })
      .where(
        and(
          eq(attempts.id, attempt.id),
          attempt.activeSessionId
            ? eq(attempts.activeSessionId, attempt.activeSessionId)
            : isNull(attempts.activeSessionId),
        ),
      )
      .returning();
    if (!taken) throw new SessionTakenOverError(); // another device took it a moment earlier
    return taken;
  }

  private async isSessionAlive(sessionId: string): Promise<boolean> {
    const [s] = await this.db
      .select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    return !!s && !s.revokedAt && s.expiresAt > this.now();
  }

  private async buildView(auth: TenantAuthContext, attempt: AttemptRow): Promise<AttemptView> {
    const [[exam], items, answerRows, pads] = await inParallel(this.db, [
      () => this.db.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1),
      () =>
        this.db
          .select({
            id: attemptItems.id,
            position: attemptItems.position,
            sectionId: attemptItems.sectionId,
            questionId: attemptItems.questionId,
            type: attemptItems.type,
            marks: attemptItems.marks,
            workingMarks: attemptItems.workingMarks,
            content: attemptItems.content,
          })
          .from(attemptItems)
          .where(eq(attemptItems.attemptId, attempt.id))
          .orderBy(asc(attemptItems.position)),
      () =>
        this.db
          .select({
            itemId: answers.attemptItemId,
            response: answers.response,
            working: answers.working,
            revision: answers.revision,
            flagged: answers.flagged,
            answeredAt: answers.answeredAt,
          })
          .from(answers)
          .where(eq(answers.attemptId, attempt.id)),
      () => scratchpadsFor(this.db, attempt.id),
    ]);
    if (!exam) throw new NotFoundError('Exam');
    const settings = settingsOf(exam);
    const sectionIds = [
      ...new Set(items.map((i) => i.sectionId).filter((id): id is string => id !== null)),
    ];
    const [sectionRows, announcementList, clarificationList] = await inParallel(this.db, [
      () =>
        sectionIds.length
          ? this.db
              .select({
                id: examSections.id,
                title: examSections.title,
                instructions: examSections.instructions,
              })
              .from(examSections)
              .where(inArray(examSections.id, sectionIds))
              .orderBy(asc(examSections.position))
          : Promise.resolve([]),
      () => announcementsFor(this.db, attempt.examId, attempt.userId),
      () => clarificationsFor(this.db, attempt.examId, attempt.id, items),
    ]);
    const fingerprint = settings.integrity.watermark ? attempt.fingerprint : null;
    return {
      id: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      examCode: exam.code,
      organizationName: auth.organization.name,
      isSandbox: attempt.isSandbox,
      status: attempt.status,
      submitReason: attempt.submitReason,
      startedAt: attempt.startedAt.toISOString(),
      deadlineAt: attempt.deadlineAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      serverNow: this.now().toISOString(),
      fingerprint: attempt.fingerprint,
      settings: {
        navigation: settings.navigation,
        allowCalculator: settings.allowCalculator,
        allowScratchpad: settings.allowScratchpad,
        integrity: {
          requireFullscreen: settings.integrity.requireFullscreen,
          detectFocusLoss: settings.integrity.detectFocusLoss,
          blockCopyPaste: settings.integrity.blockCopyPaste,
          watermark: settings.integrity.watermark,
        },
        reconnectGraceMinutes: settings.reconnectGraceMinutes,
      },
      sections: sectionRows,
      items: items.map((i) => ({
        id: i.id,
        position: i.position,
        sectionId: i.sectionId,
        type: i.type,
        marks: i.marks,
        workingMarks: i.workingMarks,
        content: candidateContent(i.content, fingerprint),
      })),
      answers: answerRows.map((a) => ({
        itemId: a.itemId,
        response: a.response,
        working: a.working,
        revision: a.revision,
        flagged: a.flagged,
        answeredAt: a.answeredAt?.toISOString() ?? null,
      })),
      announcements: announcementList,
      clarifications: clarificationList,
      scratchpads: pads,
    };
  }

  // ------------------------------------------------------------------------------------------ sync

  async sync(
    auth: TenantAuthContext,
    attemptId: string,
    request: SyncRequest,
  ): Promise<SyncResponse> {
    let attempt = await this.enforceDeadline(await this.ownedAttempt(auth, attemptId));
    if (attempt.status !== 'in_progress') return this.closedSyncResponse(attempt, request);
    attempt = await this.holdSession(auth, attempt);

    const now = this.now();
    const applied = await this.transaction((tx) =>
      this.applySync(tx, auth, attempt.id, request, now),
    );
    if (!applied) {
      // The deadline passed or the attempt was finalized while this request was in flight.
      return this.closedSyncResponse(
        await this.enforceDeadline(await this.ownedAttempt(auth, attemptId)),
        request,
      );
    }

    if (!attempt.isSandbox) {
      if (applied.progress)
        this.deps.realtime.toExamStaff(attempt.examId, RT.attemptProgress, applied.progress);
      if (applied.cameOnline)
        this.deps.realtime.toExamStaff(attempt.examId, RT.attemptConnectivity, {
          attemptId: attempt.id,
          online: true,
        });
    }
    await this.pushIncidents(attempt, applied.incidents);

    const [announcementList, clarificationList] = await inParallel(this.db, [
      () => announcementsFor(this.db, attempt.examId, attempt.userId, request.lastAnnouncementId),
      () => clarificationsFor(this.db, attempt.examId, attempt.id, applied.items),
    ]);
    return {
      serverNow: now.toISOString(),
      deadlineAt: applied.attempt.deadlineAt.toISOString(),
      status: 'in_progress',
      accepted: applied.accepted,
      rejected: applied.rejected,
      scratchpadsAccepted: applied.scratchpadsAccepted,
      announcements: announcementList,
      clarifications: clarificationList,
      timeExtensionSeconds: applied.attempt.timeExtensionSeconds,
    };
  }

  /** Applies one sync request under the attempt row lock, so it can never interleave with finalize. */
  private async applySync(
    tx: Tx,
    auth: TenantAuthContext,
    attemptId: string,
    request: SyncRequest,
    now: Date,
  ) {
    const [attempt] = await tx
      .select()
      .from(attempts)
      .where(eq(attempts.id, attemptId))
      .limit(1)
      .for('update');
    if (!attempt || attempt.status !== 'in_progress' || isPastDeadline(attempt.deadlineAt, now))
      return null;
    if (attempt.activeSessionId !== auth.sessionId) throw new SessionTakenOverError();

    const items = await tx
      .select({
        id: attemptItems.id,
        questionId: attemptItems.questionId,
        type: attemptItems.type,
        content: attemptItems.content,
        workingMarks: attemptItems.workingMarks,
      })
      .from(attemptItems)
      .where(eq(attemptItems.attemptId, attempt.id));
    const itemById = new Map(items.map((i) => [i.id, i]));

    // Answers: validated against the delivered content, applied only when the revision is newer.
    const rejected: SyncResponse['rejected'] = [];
    const touched = new Set<string>();
    for (const change of request.answers) {
      const item = itemById.get(change.itemId);
      if (!item) {
        rejected.push({
          itemId: change.itemId,
          reason: 'invalid',
          message: 'This question is not on your paper',
        });
        continue;
      }
      const handler = questionType(item.type);
      let response: Json | null;
      try {
        response =
          change.response === null ? null : handler.parseResponse(item.content, change.response);
      } catch (err) {
        rejected.push({
          itemId: item.id,
          reason: 'invalid',
          message: err instanceof AppError ? err.message : 'This answer could not be read',
        });
        continue;
      }
      // undefined keeps what is stored: working applies only to items with method marks, provenance only when well-formed.
      const working = item.workingMarks > 0 ? change.working : undefined;
      const parsedProvenance =
        change.provenance === undefined
          ? null
          : answerProvenanceSchema.safeParse(change.provenance);
      const provenance = parsedProvenance?.success ? parsedProvenance.data : undefined;
      await tx
        .insert(answers)
        .values({
          attemptId: attempt.id,
          attemptItemId: item.id,
          response,
          working: working ?? null,
          revision: change.revision,
          flagged: change.flagged ?? false,
          answeredAt: handler.isAnswered(response) ? now : null,
          timeSpentMs: change.timeSpentMs ?? 0,
          provenance: provenance ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [answers.attemptId, answers.attemptItemId],
          set: {
            response: sql`excluded.response`,
            revision: sql`excluded.revision`,
            answeredAt: sql`excluded.answered_at`,
            timeSpentMs: sql`greatest(${answers.timeSpentMs}, excluded.time_spent_ms)`,
            updatedAt: now,
            ...(change.flagged !== undefined ? { flagged: sql`excluded.flagged` } : {}),
            ...(working !== undefined ? { working: sql`excluded.working` } : {}),
            ...(provenance !== undefined ? { provenance: sql`excluded.provenance` } : {}),
          },
          setWhere: sql`${answers.revision} < excluded.revision`,
        });
      touched.add(item.id);
    }
    const accepted = touched.size
      ? await tx
          .select({ itemId: answers.attemptItemId, revision: answers.revision })
          .from(answers)
          .where(
            and(eq(answers.attemptId, attempt.id), inArray(answers.attemptItemId, [...touched])),
          )
      : [];

    const viewed = request.viewed.filter((id) => itemById.has(id));
    if (viewed.length) {
      await tx
        .update(answers)
        .set({ firstViewedAt: now })
        .where(
          and(
            eq(answers.attemptId, attempt.id),
            inArray(answers.attemptItemId, viewed),
            isNull(answers.firstViewedAt),
          ),
        );
    }

    const pages = new Set<string>();
    for (const pad of request.scratchpads) {
      await tx
        .insert(scratchpads)
        .values({
          attemptId: attempt.id,
          pageKey: pad.pageKey,
          kind: pad.kind,
          data: pad.data,
          revision: pad.revision,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [scratchpads.attemptId, scratchpads.pageKey],
          set: {
            kind: sql`excluded.kind`,
            data: sql`excluded.data`,
            revision: sql`excluded.revision`,
            updatedAt: now,
          },
          setWhere: sql`${scratchpads.revision} < excluded.revision`,
        });
      pages.add(pad.pageKey);
    }
    const scratchpadsAccepted = pages.size
      ? await tx
          .select({ pageKey: scratchpads.pageKey, revision: scratchpads.revision })
          .from(scratchpads)
          .where(
            and(eq(scratchpads.attemptId, attempt.id), inArray(scratchpads.pageKey, [...pages])),
          )
      : [];

    // Client events: only indicator and connectivity types; lifecycle events are written by the server alone.
    const clientEvents = request.events.filter((e) => CLIENT_EVENT_TYPES.has(e.type));
    const stored: EventRow[] = clientEvents.length
      ? await tx
          .insert(attemptEvents)
          .values(
            clientEvents.map((e) =>
              timelineEvent(
                attempt,
                e.type,
                eventSeverity(e.type, e.payload),
                boundedPayload(e.payload),
                now,
                e.clientTs ? new Date(e.clientTs) : null,
              ),
            ),
          )
          .returning()
      : [];
    await this.markAnnouncementsRead(tx, attempt, auth.user.id, clientEvents, now);
    const incidents = stored.filter((e) => e.severity !== 'info');
    if (incidents.length) await refreshReviewPriority(tx, attempt.id);

    await tx
      .update(attempts)
      .set({
        lastSeenAt: now,
        ...(request.rttMs !== undefined
          ? {
              clientInfo: sql`${attempts.clientInfo} || ${JSON.stringify({ rttMs: request.rttMs })}::jsonb`,
            }
          : {}),
      })
      .where(eq(attempts.id, attempt.id));

    let progress: Record<string, unknown> | null = null;
    if (!attempt.isSandbox && this.progressDue(attempt.id, now)) {
      const [counts] = await tx
        .select({
          answered: sql<number>`count(*) filter (where ${answers.answeredAt} is not null)`.mapWith(
            Number,
          ),
          flagged: sql<number>`count(*) filter (where ${answers.flagged})`.mapWith(Number),
        })
        .from(answers)
        .where(eq(answers.attemptId, attempt.id));
      progress = {
        attemptId: attempt.id,
        answeredCount: counts?.answered ?? 0,
        itemCount: items.length,
        flaggedCount: counts?.flagged ?? 0,
        lastSeenAt: now.toISOString(),
        online: true,
        rttMs: request.rttMs ?? null,
      };
    }

    return {
      attempt,
      items,
      accepted,
      rejected,
      scratchpadsAccepted,
      incidents,
      cameOnline: clientEvents.some((e) => e.type === 'came_online'),
      progress,
    };
  }

  /** `announcement_read` events record read receipts (they may arrive late from an offline client). */
  private async markAnnouncementsRead(
    tx: Tx,
    attempt: AttemptRow,
    userId: string,
    events: SyncRequest['events'],
    now: Date,
  ) {
    const ids = events
      .filter((e) => e.type === 'announcement_read')
      .map((e) => e.payload.announcementId)
      .filter((id): id is string => uuidParam.safeParse(id).success);
    if (!ids.length) return;
    const valid = await tx
      .select({ id: announcements.id })
      .from(announcements)
      .where(and(eq(announcements.examId, attempt.examId), inArray(announcements.id, ids)));
    if (valid.length) {
      await tx
        .insert(announcementReads)
        .values(valid.map((a) => ({ announcementId: a.id, userId, readAt: now })))
        .onConflictDoNothing();
    }
  }

  private async closedSyncResponse(
    attempt: AttemptRow,
    request: SyncRequest,
  ): Promise<SyncResponse> {
    const message =
      attempt.submitReason === 'timeout'
        ? 'Time is up. Changes sent after the deadline are not counted.'
        : 'This attempt has been submitted. Changes are no longer accepted.';
    const items = await this.db
      .select({ id: attemptItems.id, questionId: attemptItems.questionId })
      .from(attemptItems)
      .where(eq(attemptItems.attemptId, attempt.id));
    return {
      serverNow: this.now().toISOString(),
      deadlineAt: attempt.deadlineAt.toISOString(),
      status: attempt.status,
      accepted: [],
      rejected: request.answers.map((a) => ({
        itemId: a.itemId,
        reason: 'closed' as const,
        message,
      })),
      scratchpadsAccepted: [],
      announcements: await announcementsFor(
        this.db,
        attempt.examId,
        attempt.userId,
        request.lastAnnouncementId,
      ),
      clarifications: await clarificationsFor(this.db, attempt.examId, attempt.id, items),
      timeExtensionSeconds: attempt.timeExtensionSeconds,
    };
  }

  // ------------------------------------------------------------------------------------------ submit & finalize

  async submit(
    auth: TenantAuthContext,
    attemptId: string,
    request: SubmitRequest,
  ): Promise<SubmissionReceipt> {
    const attempt = await this.ownedAttempt(auth, attemptId);
    if (attempt.status === 'in_progress') {
      const { confirm: _confirm, ...finalChanges } = request;
      // The final autosave also enforces the active device and the deadline (a late submit becomes a timeout).
      const synced = await this.sync(auth, attemptId, finalChanges);
      if (synced.status === 'in_progress')
        await this.finalize(attemptId, 'candidate', auth.user.id);
    }
    return this.receipt(auth, attemptId);
  }

  async receipt(auth: TenantAuthContext, attemptId: string): Promise<SubmissionReceipt> {
    const attempt = await this.enforceDeadline(await this.ownedAttempt(auth, attemptId));
    if (attempt.status === 'in_progress')
      throw new ConflictError('This attempt has not been submitted yet');
    const rows = await this.db
      .select({
        itemId: attemptItems.id,
        type: attemptItems.type,
        workingMarks: attemptItems.workingMarks,
        voidReason: attemptItems.voidReason,
        response: answers.response,
        working: answers.working,
        flagged: answers.flagged,
        autoScore: answers.autoScore,
        manualScore: answers.manualScore,
        workingScore: answers.workingScore,
      })
      .from(attemptItems)
      .leftJoin(
        answers,
        and(eq(answers.attemptItemId, attemptItems.id), eq(answers.attemptId, attempt.id)),
      )
      .where(eq(attemptItems.attemptId, attempt.id));
    const [submitted] = await this.db
      .select({ payload: attemptEvents.payload })
      .from(attemptEvents)
      .where(
        and(
          eq(attemptEvents.attemptId, attempt.id),
          inArray(attemptEvents.type, SUBMIT_EVENT_TYPES),
        ),
      )
      .orderBy(asc(attemptEvents.createdAt))
      .limit(1);
    // The code issued at submission is kept on the submission event; recomputing gives the same value.
    const issued = submitted?.payload.receiptCode;
    const receipt: SubmissionReceipt = {
      attemptId: attempt.id,
      status: attempt.status,
      submitReason: attempt.submitReason,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      answeredCount: rows.filter((r) => questionType(r.type).isAnswered(r.response)).length,
      itemCount: rows.length,
      flaggedCount: rows.filter((r) => r.flagged).length,
      receiptCode:
        typeof issued === 'string'
          ? issued
          : receiptCode(this.deps.receiptSecret, attempt.id, rows),
    };
    if (attempt.isSandbox) {
      const scored = rows.filter((r) => r.voidReason === null);
      receipt.sandboxScore = {
        score: attempt.score ?? 0,
        maxScore: attempt.maxScore,
        pendingManual: scored.filter((r) => combineItem(r, r, isAutoGraded(r.type)).pending).length,
      };
    }
    return receipt;
  }

  /**
   * Ends an attempt: auto-grades every item, recomputes the total, writes the grade ledger and issues the receipt,
   * all in one transaction under the attempt row lock. Safe to call twice (the second call changes nothing).
   */
  async finalize(
    attemptId: string,
    reason: SubmitReason,
    actorId?: string | null,
    note?: string,
  ): Promise<FinalizeResult> {
    const now = this.now();
    const result = await this.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(attempts)
        .where(eq(attempts.id, attemptId))
        .limit(1)
        .for('update');
      if (!attempt) throw new NotFoundError('Attempt');
      if (attempt.status === 'submitted') return { attempt, finalized: false, code: null };
      // A deadline submit re-checks under the lock: an extension may have landed since the caller looked.
      if (reason === 'timeout' && !isPastDeadline(attempt.deadlineAt, now))
        return { attempt, finalized: false, code: null };

      const items = await tx
        .select()
        .from(attemptItems)
        .where(eq(attemptItems.attemptId, attempt.id))
        .orderBy(asc(attemptItems.position));
      const rows = await tx.select().from(answers).where(eq(answers.attemptId, attempt.id));
      const byItem = new Map(rows.map((r) => [r.attemptItemId, r]));
      const scores: Record<string, number | null> = {};
      for (const item of items) {
        const current = byItem.get(item.id);
        const grade = autoGrade(item, current);
        if (current) {
          await tx
            .update(answers)
            .set({ ...grade, updatedAt: now })
            .where(eq(answers.id, current.id));
        } else {
          await tx.insert(answers).values({
            attemptId: attempt.id,
            attemptItemId: item.id,
            ...grade,
            createdAt: now,
            updatedAt: now,
          });
        }
        scores[item.id] = isAutoGraded(item.type) ? grade.autoScore : grade.manualScore;
      }
      const totals = await recomputeAttempt(tx, attempt.id);
      const code = receiptCode(
        this.deps.receiptSecret,
        attempt.id,
        items.map((i) => ({
          itemId: i.id,
          response: byItem.get(i.id)?.response ?? null,
          working: byItem.get(i.id)?.working ?? null,
        })),
      );
      const answered = items.filter((i) =>
        questionType(i.type).isAnswered(byItem.get(i.id)?.response ?? null),
      ).length;

      await tx
        .update(attempts)
        .set({ status: 'submitted', submittedAt: now, submitReason: reason, updatedAt: now })
        .where(eq(attempts.id, attempt.id));
      await tx.insert(attemptEvents).values(
        timelineEvent(
          attempt,
          SUBMIT_EVENT[reason],
          'info',
          {
            reason,
            receiptCode: code,
            answeredCount: answered,
            itemCount: items.length,
            ...(note ? { note: note.slice(0, 500) } : {}),
          },
          now,
        ),
      );
      // Sandbox previews are not grades: they never enter the ledger, statistics or results.
      // The system grades; only a forced submission has a human actor. Who submitted is in the audit log.
      if (!attempt.isSandbox) {
        await appendLedger(tx, {
          organizationId: attempt.organizationId,
          examId: attempt.examId,
          attemptId: attempt.id,
          action: 'auto_grade',
          actorId: reason === 'proctor' ? (actorId ?? null) : null,
          previousScore: attempt.score,
          newScore: totals.score,
          reason: `Automatic grading at submission (${reason})`,
          metadata: {
            submitReason: reason,
            maxScore: totals.maxScore,
            pendingItems: totals.pending,
            itemScores: scores,
          },
        });
      }
      return { attempt, finalized: true, code };
    });

    const { attempt } = result;
    if (result.finalized) {
      this.lastProgressPush.delete(attempt.id);
      if (!attempt.isSandbox) {
        this.deps.realtime.toExamStaff(attempt.examId, RT.attemptSubmitted, {
          attemptId: attempt.id,
          submitReason: reason,
          submittedAt: now.toISOString(),
        });
      }
      if (reason === 'proctor') {
        this.deps.realtime.toAttempt(attempt.id, RT.forceSubmitted, {
          attemptId: attempt.id,
          reason: note ?? 'Your invigilator submitted your attempt.',
        });
      }
      await this.deps.audit.record({
        organizationId: attempt.organizationId,
        actorId: actorId ?? null,
        action:
          reason === 'proctor'
            ? 'attempt.force_submitted'
            : reason === 'timeout'
              ? 'attempt.auto_submitted'
              : 'attempt.submitted',
        entityType: 'attempt',
        entityId: attempt.id,
        summary:
          reason === 'timeout'
            ? 'Submitted automatically at the deadline'
            : reason === 'proctor'
              ? 'Submitted by staff'
              : 'Submitted by the candidate',
        metadata: {
          examId: attempt.examId,
          reason,
          receiptCode: result.code,
          sandbox: attempt.isSandbox,
          ...(note ? { note } : {}),
        },
      });
    }
    return {
      finalized: result.finalized,
      attemptId: attempt.id,
      submittedAt: result.finalized ? now : attempt.submittedAt,
      submitReason: result.finalized ? reason : attempt.submitReason,
      receiptCode: result.code,
    };
  }

  /** Lazy deadline enforcement: an expired attempt is finalized on first contact (the job catches the rest). */
  private async enforceDeadline(attempt: AttemptRow): Promise<AttemptRow> {
    if (attempt.status !== 'in_progress' || !isPastDeadline(attempt.deadlineAt, this.now()))
      return attempt;
    await this.deps.deadlinesReady?.();
    // Outage compensation may have moved the deadline while we waited.
    const fresh = await this.attemptById(attempt.id);
    if (fresh.status === 'in_progress' && isPastDeadline(fresh.deadlineAt, this.now())) {
      await this.finalize(fresh.id, 'timeout');
      return this.attemptById(fresh.id);
    }
    return fresh;
  }

  // ------------------------------------------------------------------------------------------ interventions

  /** Gives an attempt in progress more time. Callers authorize first (monitor.intervene + exam access). */
  async extendTime(attemptId: string, seconds: number, reason: string, actorId: string) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_EXTENSION_SECONDS) {
      throw new ValidationError('An extension must be between 1 second and 24 hours', {
        seconds: 'Choose between 1 second and 24 hours',
      });
    }
    const now = this.now();
    const updated = await this.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(attempts)
        .where(eq(attempts.id, attemptId))
        .limit(1)
        .for('update');
      if (!attempt) throw new NotFoundError('Attempt');
      if (attempt.status !== 'in_progress')
        throw new AttemptClosedError('Only an attempt in progress can be given more time');
      if (isPastDeadline(attempt.deadlineAt, now))
        throw new AttemptClosedError('Time is already up for this attempt');
      const deadlineAt = new Date(attempt.deadlineAt.getTime() + seconds * 1000);
      const timeExtensionSeconds = attempt.timeExtensionSeconds + seconds;
      await tx
        .update(attempts)
        .set({ deadlineAt, timeExtensionSeconds, updatedAt: now })
        .where(eq(attempts.id, attempt.id));
      await tx.insert(attemptEvents).values(
        timelineEvent(
          attempt,
          'time_extended',
          'info',
          {
            seconds,
            reason: reason.slice(0, 120),
            previousDeadline: attempt.deadlineAt.toISOString(),
          },
          now,
        ),
      );
      return { attempt, deadlineAt, timeExtensionSeconds };
    });
    const { attempt, deadlineAt, timeExtensionSeconds } = updated;
    const payload = { attemptId: attempt.id, deadlineAt: deadlineAt.toISOString(), reason };
    this.deps.realtime.toAttempt(attempt.id, RT.timeExtended, payload);
    if (!attempt.isSandbox)
      this.deps.realtime.toExamStaff(attempt.examId, RT.timeExtended, payload);
    await this.deps.audit.record({
      organizationId: attempt.organizationId,
      actorId,
      action: 'attempt.time_extended',
      entityType: 'attempt',
      entityId: attempt.id,
      summary: `Deadline extended by ${seconds} s`,
      metadata: {
        examId: attempt.examId,
        seconds,
        reason,
        deadlineBefore: attempt.deadlineAt.toISOString(),
        deadlineAfter: deadlineAt.toISOString(),
      },
    });
    return { attemptId: attempt.id, deadlineAt: deadlineAt.toISOString(), timeExtensionSeconds };
  }

  /** Finalizes an attempt on the candidate's behalf. Callers authorize first (monitor.intervene + exam access). */
  async forceSubmit(attemptId: string, actorId: string, reason: string): Promise<FinalizeResult> {
    const result = await this.finalize(attemptId, 'proctor', actorId, reason);
    if (!result.finalized) throw new AttemptClosedError('This attempt was already submitted');
    return result;
  }

  // ------------------------------------------------------------------------------------------ sandbox (SF-4.3)

  /** Examiner preview: the real paper and workspace, no window or enrollment checks, never counted anywhere. */
  async startSandbox(auth: TenantAuthContext, examId: string): Promise<AttemptView> {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const now = this.now();
    const deadlineAt = computeDeadline({
      startedAt: now,
      durationMinutes: exam.durationMinutes,
      windowClosesAt: null,
    });
    const attemptId = await this.createAttempt({
      auth,
      exam,
      settings: settingsOf(exam),
      isSandbox: true,
      now,
      deadlineAt,
      clientInfo: {},
      pledged: false,
    });
    await this.deps.audit.record({
      organizationId: exam.organizationId,
      actorId: auth.user.id,
      action: 'attempt.sandbox_started',
      entityType: 'attempt',
      entityId: attemptId,
      summary: `Previewed ${exam.title} as a candidate`,
      metadata: { examId: exam.id },
    });
    return this.getView(auth, attemptId);
  }

  async discardSandbox(auth: TenantAuthContext, attemptId: string): Promise<void> {
    const attempt = await this.ownedAttempt(auth, attemptId);
    if (!attempt.isSandbox) throw new NotFoundError('Sandbox attempt'); // a real attempt is never deleted here
    await this.db
      .delete(attempts)
      .where(and(eq(attempts.id, attempt.id), eq(attempts.isSandbox, true)));
    this.lastProgressPush.delete(attempt.id);
  }

  // ------------------------------------------------------------------------------------------ helpers

  /**
   * The caller's own attempt in the active organization, or 404. A real attempt needs exams.take and a sandbox
   * preview needs exams.manage, so a role change takes effect on the next request.
   */
  private async ownedAttempt(auth: TenantAuthContext, attemptId: string): Promise<AttemptRow> {
    const [row] = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.id, attemptId),
          eq(attempts.organizationId, auth.organization.id),
          eq(attempts.userId, auth.user.id),
        ),
      )
      .limit(1);
    if (!row || !auth.permissions.has(row.isSandbox ? 'exams.manage' : 'exams.take'))
      throw new NotFoundError('Attempt');
    return row;
  }

  private async attemptById(attemptId: string): Promise<AttemptRow> {
    const [row] = await this.db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
    if (!row) throw new NotFoundError('Attempt');
    return row;
  }

  private async realAttemptOf(examId: string, userId: string): Promise<AttemptRow | undefined> {
    const [row] = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.examId, examId),
          eq(attempts.userId, userId),
          eq(attempts.isSandbox, false),
        ),
      )
      .limit(1);
    return row;
  }

  /** A published exam of the active organization the caller is enrolled in. Anything else is "not found". */
  private async enrolledExam(auth: TenantAuthContext, examId: string) {
    const [row] = await this.db
      .select({ exam: exams, enrollment: examEnrollments })
      .from(exams)
      .innerJoin(
        examEnrollments,
        and(
          eq(examEnrollments.examId, exams.id),
          eq(examEnrollments.userId, auth.user.id),
          eq(examEnrollments.status, 'enrolled'),
        ),
      )
      .where(and(eq(exams.id, examId), eq(exams.organizationId, auth.organization.id)))
      .limit(1);
    if (!row || row.exam.status === 'draft') throw new NotFoundError('Exam');
    return row;
  }

  private progressDue(attemptId: string, now: Date): boolean {
    const last = this.lastProgressPush.get(attemptId) ?? 0;
    if (now.getTime() - last < PROGRESS_INTERVAL_MS) return false;
    this.lastProgressPush.set(attemptId, now.getTime());
    return true;
  }

  /** Pushes integrity indicators to the live monitor in its own event shape. Never for sandbox previews. */
  private async pushIncidents(attempt: AttemptRow, events: EventRow[]): Promise<void> {
    if (attempt.isSandbox || events.length === 0) return;
    const candidate = await candidateRefOf(this.db, attempt.userId, attempt.organizationId);
    for (const e of events)
      this.deps.realtime.toExamStaff(attempt.examId, RT.attemptIncident, {
        attemptId: attempt.id,
        event: toMonitorEvent(e, candidate),
      });
  }

  private transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    // On an enclosing transaction (tests) drizzle opens a savepoint, so the same code runs either way.
    return (this.db as Database).transaction(fn);
  }
}

const engines = new WeakMap<Container, AttemptService>();

/** The attempt engine wired to the app container: one instance shared by the routes, the jobs and other modules. */
export function attemptEngine(c: Container): AttemptService {
  let engine = engines.get(c);
  if (!engine) {
    engine = new AttemptService({
      db: c.db,
      audit: c.audit,
      realtime: c.realtime,
      receiptSecret: c.config.LEDGER_SECRET,
      deadlinesReady: () => deadlineGate.wait(),
    });
    engines.set(c, engine);
  }
  return engine;
}
