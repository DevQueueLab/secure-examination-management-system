import { and, asc, count, desc, eq, gt, gte, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ERROR_CODES, RT, examPhase, type AnnouncementView, type ClarificationView } from '@athena/shared';
import type { Database } from '../../db/client';
import {
  announcementReads,
  announcements,
  answers,
  attemptEvents,
  attemptItems,
  attempts,
  clarifications,
  examEnrollments,
  memberships,
  questions,
  users,
} from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { Realtime } from '../../realtime/realtime';
import type { TenantAuthContext } from '../../types/auth';
import { refreshReviewPriority } from '../attempts/attempt.events';
import type { AuditService } from '../audit/audit.service';
import { loadExamForStaff } from '../exams/exam-access';
import { connectivitySegments, detectOutage, eventTime, initialsOf, isOnline, progressSeries, safePayload } from './analysis';
import type {
  AnnouncementInput,
  ClarificationAnswerInput,
  ClarificationInput,
  ExtendAllInput,
  ExtendInput,
  ForceSubmitInput,
  IncidentQuery,
  ReviewInput,
} from './monitoring.schemas';
import {
  INDICATOR_NOTICE,
  type AttemptTimeline,
  type BulkExtensionResult,
  type CandidateRef,
  type ExtensionResult,
  type IncidentList,
  type IndicatorSeverity,
  type LiveAttempt,
  type LiveMonitor,
  type MonitorEvent,
  type NotStartedCandidate,
  type OutageSuggestion,
  type StaffAnnouncement,
  type StaffClarification,
} from './monitoring.types';

/** The attempt engine's interventions. Monitoring never moves a deadline or finalizes an attempt itself. */
export interface AttemptControl {
  extendTime(attemptId: string, seconds: number, reason: string, actorId: string): Promise<unknown>;
  forceSubmit(attemptId: string, actorId: string, reason: string): Promise<unknown>;
}

/** Who performed a state-changing call, for the audit log. */
export interface Actor {
  auth: TenantAuthContext;
  ip?: string | null;
}

const INDICATOR_SEVERITIES: IndicatorSeverity[] = ['low', 'medium', 'high'];
const OUTAGE_LOOKBACK_MS = 20 * 60_000;
const CONNECTIVITY_TYPES = ['went_offline', 'came_online', 'offline_journal_received', 'resumed'];
const COMPENSATION_TYPES = ['time_extended', 'outage_compensated'];
/** Unanswered clarifications one candidate may have waiting at once. */
const MAX_OPEN_CLARIFICATIONS = 5;

/** Same rule as the engine's live progress pushes: it stamps answeredAt only when the response counts as an answer. */
const answered = sql`${answers.answeredAt} is not null`;
const openIndicator = sql`(${attemptEvents.reviewStatus} is null or ${attemptEvents.reviewStatus} = 'open')`;
/** The item's place on the candidate's paper (1-based), whatever base the engine stores positions in. */
const itemNumber = sql<number>`(select count(*) from ${attemptItems} as peer where peer.attempt_id = ${attemptItems.attemptId} and peer.position <= ${attemptItems.position})`.mapWith(
  Number,
);

type AttemptRow = Awaited<ReturnType<MonitoringService['attemptRows']>>[number];
type EventRow = Awaited<ReturnType<MonitoringService['eventRows']>>[number];

function rttOf(clientInfo: Record<string, unknown>): number | null {
  for (const key of ['rttMs', 'lastRttMs', 'rtt']) {
    const v = clientInfo[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
  }
  return null;
}

const str = (v: unknown) => (typeof v === 'string' && v.length <= 400 ? v : null);

function candidateRef(row: { userId: string; name: string; rollNumber: string | null }): CandidateRef {
  return { userId: row.userId, name: row.name, rollNumber: row.rollNumber, initials: initialsOf(row.name) };
}

function toMonitorEvent(row: EventRow): MonitorEvent {
  const indicator = row.severity !== 'info';
  return {
    id: row.id,
    attemptId: row.attemptId,
    candidate: candidateRef(row),
    type: row.type,
    severity: row.severity,
    createdAt: row.createdAt.toISOString(),
    clientTs: row.clientTs?.toISOString() ?? null,
    payload: safePayload(row.payload),
    review: indicator
      ? {
          status: row.reviewStatus ?? 'open',
          note: row.reviewNote,
          reviewedAt: row.reviewedAt?.toISOString() ?? null,
          reviewedBy: row.reviewerName,
        }
      : null,
  };
}

/**
 * Live examination monitoring (FR-3.6): the control room view, announcements, clarifications, interventions and
 * indicator review. Every staff read goes through loadExamForStaff and the realAttempts scope; interventions are
 * delegated to the attempt engine and audited here.
 */
export class MonitoringService {
  constructor(
    private readonly db: Database,
    private readonly realtime: Realtime,
    private readonly audit: AuditService,
    private readonly engine: AttemptControl,
  ) {}

  // ---------------------------------------------------------------- live view

  async live(auth: TenantAuthContext, examId: string): Promise<LiveMonitor> {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const now = new Date();
    const byExam = eq(attempts.examId, exam.id);
    const [roster, rows, answerStats, itemStats, eventStats, recent, signals] = await Promise.all([
      this.db
        .select({
          userId: examEnrollments.userId,
          name: users.name,
          email: users.email,
          rollNumber: memberships.externalId,
          cohort: memberships.cohort,
          timeMultiplier: examEnrollments.timeMultiplier,
          extraMinutes: examEnrollments.extraMinutes,
        })
        .from(examEnrollments)
        .innerJoin(users, eq(users.id, examEnrollments.userId))
        .leftJoin(memberships, and(eq(memberships.userId, examEnrollments.userId), eq(memberships.organizationId, exam.organizationId)))
        .where(and(eq(examEnrollments.examId, exam.id), eq(examEnrollments.status, 'enrolled')))
        .orderBy(asc(users.name)),
      this.attemptRows(byExam),
      this.answerStats(byExam),
      this.itemStats(byExam),
      this.db
        .select({
          attemptId: attemptEvents.attemptId,
          type: attemptEvents.type,
          severity: attemptEvents.severity,
          total: count(),
          open: sql<number>`count(*) filter (where ${openIndicator})`.mapWith(Number),
        })
        .from(attemptEvents)
        .innerJoin(attempts, eq(attempts.id, attemptEvents.attemptId))
        .where(and(eq(attemptEvents.examId, exam.id), realAttempts, or(ne(attemptEvents.severity, 'info'), eq(attemptEvents.type, 'device_switched'))))
        .groupBy(attemptEvents.attemptId, attemptEvents.type, attemptEvents.severity),
      this.eventRows(and(eq(attemptEvents.examId, exam.id), ne(attemptEvents.type, 'announcement_read'))!, 50),
      this.outageSignals(exam.id, now),
    ]);

    const answersBy = new Map(answerStats.map((s) => [s.attemptId, s]));
    const itemsBy = new Map(itemStats.map((s) => [s.attemptId, s.n]));
    const incidentsBy = new Map<string, LiveAttempt['incidents'] & { deviceSwitches: number }>();
    for (const s of eventStats) {
      const entry = incidentsBy.get(s.attemptId) ?? { total: 0, open: 0, byType: {}, deviceSwitches: 0 };
      if (s.type === 'device_switched') entry.deviceSwitches += s.total;
      if (s.severity !== 'info') {
        entry.total += s.total;
        entry.open += s.open;
        entry.byType[s.type] = (entry.byType[s.type] ?? 0) + s.total;
      }
      incidentsBy.set(s.attemptId, entry);
    }

    const live = rows.map((row) => {
      const stats = incidentsBy.get(row.id);
      return this.toLiveAttempt(row, now, {
        answered: answersBy.get(row.id)?.answered ?? 0,
        flagged: answersBy.get(row.id)?.flagged ?? 0,
        items: itemsBy.get(row.id) ?? 0,
        incidents: { total: stats?.total ?? 0, open: stats?.open ?? 0, byType: stats?.byType ?? {} },
        deviceSwitches: stats?.deviceSwitches ?? 0,
      });
    });
    live.sort((a, b) => a.candidate.name.localeCompare(b.candidate.name));

    const started = new Set(rows.map((r) => r.userId));
    const notStarted: NotStartedCandidate[] = roster
      .filter((r) => !started.has(r.userId))
      .map((r) => ({
        ...candidateRef(r),
        email: r.email,
        cohort: r.cohort,
        accommodation: r.timeMultiplier !== 1 || r.extraMinutes > 0 ? { timeMultiplier: r.timeMultiplier, extraMinutes: r.extraMinutes } : null,
      }));

    const inProgress = live.filter((a) => a.status === 'in_progress');
    return {
      serverNow: now.toISOString(),
      exam: {
        id: exam.id,
        title: exam.title,
        code: exam.code,
        phase: examPhase(exam, now),
        windowOpensAt: exam.windowOpensAt.toISOString(),
        windowClosesAt: exam.windowClosesAt.toISOString(),
        durationMinutes: exam.durationMinutes,
      },
      summary: {
        enrolled: roster.length,
        notStarted: notStarted.length,
        inProgress: inProgress.length,
        awaitingSync: live.filter((a) => a.status === 'awaiting_sync').length,
        submitted: live.filter((a) => a.status === 'submitted').length,
        onlineNow: inProgress.filter((a) => a.online).length,
        openIncidents: live.reduce((sum, a) => sum + a.incidents.open, 0),
      },
      attempts: live,
      notStarted,
      recentEvents: recent.map(toMonitorEvent),
      suggestion: this.suggest(rows, signals, now),
    };
  }

  async timeline(auth: TenantAuthContext, attemptId: string): Promise<AttemptTimeline> {
    const [row] = await this.attemptRows(and(eq(attempts.id, attemptId), eq(attempts.organizationId, auth.organization.id))!);
    if (!row) throw new NotFoundError('Attempt');
    await loadExamForStaff(this.db, auth, row.examId);
    const now = new Date();
    const byAttempt = eq(attempts.id, row.id);
    const [answerStats, itemStats, eventRows, answeredRows] = await Promise.all([
      this.answerStats(byAttempt),
      this.itemStats(byAttempt),
      this.eventRows(eq(attemptEvents.attemptId, row.id), 2000),
      this.db
        .select({ at: answers.answeredAt })
        .from(answers)
        .where(and(eq(answers.attemptId, row.id), answered)),
    ]);

    const events = eventRows.reverse().map(toMonitorEvent);
    const indicators = events.filter((e) => e.severity !== 'info');
    const byType: Record<string, number> = {};
    for (const e of indicators) byType[e.type] = (byType[e.type] ?? 0) + 1;

    const base = this.toLiveAttempt(row, now, {
      answered: answerStats[0]?.answered ?? 0,
      flagged: answerStats[0]?.flagged ?? 0,
      items: itemStats[0]?.n ?? 0,
      incidents: { total: indicators.length, open: indicators.filter((e) => e.review?.status === 'open').length, byType },
      deviceSwitches: events.filter((e) => e.type === 'device_switched').length,
    });
    const endAt = row.submittedAt ?? new Date(Math.min(now.getTime(), row.deadlineAt.getTime()));
    return {
      serverNow: now.toISOString(),
      notice: INDICATOR_NOTICE,
      attempt: {
        ...base,
        examId: row.examId,
        device: {
          userAgent: str(row.clientInfo.userAgent),
          platform: str(row.clientInfo.platform),
          screen: str(row.clientInfo.screen),
          timezone: str(row.clientInfo.timezone),
        },
      },
      events,
      connectivity: connectivitySegments({
        startedAt: row.startedAt,
        endAt,
        live: row.status !== 'submitted',
        lastSeenAt: row.lastSeenAt,
        now,
        events: eventRows.map((e) => ({ type: e.type, at: eventTime(e, row.startedAt) })),
      }),
      progress: progressSeries({ startedAt: row.startedAt, endAt, answeredAt: answeredRows.map((r) => r.at!).filter(Boolean) }),
    };
  }

  // ---------------------------------------------------------------- announcements

  async createAnnouncement(actor: Actor, examId: string, input: AnnouncementInput): Promise<StaffAnnouncement> {
    const { auth } = actor;
    const exam = await loadExamForStaff(this.db, auth, examId);
    let target: { userId: string; name: string; attemptId: string | null } | null = null;
    if (input.targetUserId) {
      const [t] = await this.db
        .select({ userId: users.id, name: users.name, attemptId: attempts.id })
        .from(examEnrollments)
        .innerJoin(users, eq(users.id, examEnrollments.userId))
        .leftJoin(attempts, and(eq(attempts.examId, exam.id), eq(attempts.userId, examEnrollments.userId), realAttempts))
        .where(and(eq(examEnrollments.examId, exam.id), eq(examEnrollments.userId, input.targetUserId)))
        .limit(1);
      if (!t) throw new ValidationError('That person is not a candidate in this exam', { targetUserId: 'Choose a candidate in this exam' });
      target = t;
    }

    const [row] = await this.db
      .insert(announcements)
      .values({ examId: exam.id, authorId: auth.user.id, body: input.body, priority: input.priority, targetUserId: target?.userId ?? null })
      .returning();
    const view: AnnouncementView = { id: row!.id, body: row!.body, priority: row!.priority, createdAt: row!.createdAt.toISOString(), read: false };

    // One room per message: the candidate's workspace when they have started, otherwise their user room.
    if (!target) this.realtime.toExamCandidates(exam.id, RT.announcement, view);
    else if (target.attemptId) this.realtime.toAttempt(target.attemptId, RT.announcement, view);
    else this.realtime.toUser(target.userId, RT.announcement, view);
    this.realtime.toExamStaff(exam.id, RT.announcement, view);

    await this.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'monitoring.announcement_sent',
      entityType: 'exam',
      entityId: exam.id,
      summary: target ? `Sent an announcement to ${target.name}` : 'Sent an announcement to every candidate',
      metadata: { announcementId: row!.id, priority: input.priority, targetUserId: target?.userId ?? null, length: input.body.length },
      ip: actor.ip,
    });

    const [listed] = (await this.listAnnouncements(auth, exam.id)).filter((a) => a.id === row!.id);
    return listed!;
  }

  async listAnnouncements(auth: TenantAuthContext, examId: string): Promise<StaffAnnouncement[]> {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const author = alias(users, 'author');
    const target = alias(users, 'target');
    const [rows, candidates, reads] = await Promise.all([
      this.db
        .select({
          id: announcements.id,
          body: announcements.body,
          priority: announcements.priority,
          createdAt: announcements.createdAt,
          authorId: announcements.authorId,
          authorName: author.name,
          targetUserId: announcements.targetUserId,
          targetName: target.name,
        })
        .from(announcements)
        .leftJoin(author, eq(author.id, announcements.authorId))
        .leftJoin(target, eq(target.id, announcements.targetUserId))
        .where(eq(announcements.examId, exam.id))
        .orderBy(desc(announcements.createdAt)),
      this.db
        .select({ userId: attempts.userId, submittedAt: attempts.submittedAt })
        .from(attempts)
        .where(and(eq(attempts.examId, exam.id), realAttempts)),
      this.db
        .select({ announcementId: announcementReads.announcementId, userId: announcementReads.userId })
        .from(announcementReads)
        .innerJoin(announcements, eq(announcements.id, announcementReads.announcementId))
        .where(eq(announcements.examId, exam.id)),
    ]);

    const readers = new Map<string, Set<string>>();
    for (const r of reads) readers.set(r.announcementId, (readers.get(r.announcementId) ?? new Set()).add(r.userId));

    return rows.map((a) => {
      const readBy = readers.get(a.id) ?? new Set<string>();
      // Everyone who had started and not yet submitted when it went out, or started later (they see it on start).
      const recipients = a.targetUserId
        ? [a.targetUserId]
        : candidates.filter((c) => !c.submittedAt || c.submittedAt > a.createdAt).map((c) => c.userId);
      return {
        id: a.id,
        body: a.body,
        priority: a.priority,
        createdAt: a.createdAt.toISOString(),
        author: a.authorId && a.authorName ? { id: a.authorId, name: a.authorName } : null,
        target: a.targetUserId && a.targetName ? { userId: a.targetUserId, name: a.targetName } : null,
        readCount: recipients.filter((u) => readBy.has(u)).length,
        recipientCount: recipients.length,
      };
    });
  }

  /** Candidate: records that they saw an announcement (read receipts for staff). */
  async markAnnouncementRead(auth: TenantAuthContext, attemptId: string, announcementId: string) {
    const attempt = await this.ownAttempt(auth, attemptId);
    const [a] = await this.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(
        and(
          eq(announcements.id, announcementId),
          eq(announcements.examId, attempt.examId),
          or(isNull(announcements.targetUserId), eq(announcements.targetUserId, auth.user.id)),
        ),
      )
      .limit(1);
    if (!a) throw new NotFoundError('Announcement');

    const inserted = await this.db
      .insert(announcementReads)
      .values({ announcementId: a.id, userId: auth.user.id })
      .onConflictDoNothing()
      .returning({ readAt: announcementReads.readAt });
    if (inserted.length && !attempt.isSandbox) {
      await this.db.insert(attemptEvents).values({
        attemptId: attempt.id,
        examId: attempt.examId,
        organizationId: attempt.organizationId,
        type: 'announcement_read',
        severity: 'info',
        payload: { announcementId: a.id },
      });
    }
    return { announcementId: a.id, read: true };
  }

  // ---------------------------------------------------------------- clarifications

  /** Candidate: asks the proctors a question during the exam. */
  async askClarification(auth: TenantAuthContext, attemptId: string, input: ClarificationInput): Promise<ClarificationView> {
    const attempt = await this.ownAttempt(auth, attemptId);
    if (attempt.status !== 'in_progress' || attempt.deadlineAt.getTime() <= Date.now()) {
      throw new ConflictError('This attempt has ended, so questions can no longer be sent.', ERROR_CODES.ATTEMPT_CLOSED);
    }
    let item: StaffClarification['item'] = null;
    if (input.itemId) {
      const [found] = await this.db
        .select({ id: attemptItems.id, number: itemNumber, questionTitle: questions.title })
        .from(attemptItems)
        .leftJoin(questions, eq(questions.id, attemptItems.questionId))
        .where(and(eq(attemptItems.id, input.itemId), eq(attemptItems.attemptId, attempt.id)))
        .limit(1);
      if (!found) throw new ValidationError('That question is not part of your paper', { itemId: 'Choose a question from your paper' });
      item = found;
    }
    const [waiting] = await this.db
      .select({ n: count() })
      .from(clarifications)
      .where(and(eq(clarifications.attemptId, attempt.id), isNull(clarifications.answer)));
    if ((waiting?.n ?? 0) >= MAX_OPEN_CLARIFICATIONS) {
      throw new ConflictError(`You have ${MAX_OPEN_CLARIFICATIONS} questions waiting for a reply. Wait for an answer before asking another.`);
    }

    const row = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(clarifications)
        .values({ examId: attempt.examId, attemptId: attempt.id, askedBy: auth.user.id, attemptItemId: item?.id ?? null, question: input.question })
        .returning();
      await tx.insert(attemptEvents).values({
        attemptId: attempt.id,
        examId: attempt.examId,
        organizationId: attempt.organizationId,
        type: 'clarification_asked',
        severity: 'info',
        payload: { clarificationId: c!.id, ...(item ? { question: item.number } : {}) },
      });
      return c!;
    });

    if (!attempt.isSandbox) {
      const [m] = await this.db
        .select({ rollNumber: memberships.externalId })
        .from(memberships)
        .where(and(eq(memberships.userId, auth.user.id), eq(memberships.organizationId, attempt.organizationId)))
        .limit(1);
      const staffView: StaffClarification = {
        id: row.id,
        attemptId: attempt.id,
        candidate: candidateRef({ userId: auth.user.id, name: auth.user.name, rollNumber: m?.rollNumber ?? null }),
        question: row.question,
        item,
        answer: null,
        broadcast: false,
        answeredBy: null,
        createdAt: row.createdAt.toISOString(),
        answeredAt: null,
      };
      this.realtime.toExamStaff(attempt.examId, RT.clarificationAsked, staffView);
    }

    return {
      id: row.id,
      question: row.question,
      answer: null,
      itemId: row.attemptItemId,
      broadcast: false,
      mine: true,
      createdAt: row.createdAt.toISOString(),
      answeredAt: null,
    };
  }

  async listClarifications(auth: TenantAuthContext, examId: string): Promise<StaffClarification[]> {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const rows = await this.clarificationRows(eq(clarifications.examId, exam.id));
    const waiting = rows.filter((c) => !c.answer).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const done = rows.filter((c) => c.answer).sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? ''));
    return [...waiting, ...done];
  }

  async answerClarification(actor: Actor, clarificationId: string, input: ClarificationAnswerInput): Promise<StaffClarification> {
    const { auth } = actor;
    const [c] = await this.db
      .select({ id: clarifications.id, examId: clarifications.examId, attemptId: clarifications.attemptId })
      .from(clarifications)
      .innerJoin(attempts, eq(attempts.id, clarifications.attemptId))
      .where(and(eq(clarifications.id, clarificationId), eq(attempts.organizationId, auth.organization.id), realAttempts))
      .limit(1);
    if (!c) throw new NotFoundError('Clarification');
    await loadExamForStaff(this.db, auth, c.examId);

    const [row] = await this.db
      .update(clarifications)
      .set({ answer: input.answer, answeredBy: auth.user.id, answeredAt: new Date(), broadcast: input.broadcast })
      .where(eq(clarifications.id, c.id))
      .returning();
    const view: ClarificationView = {
      id: row!.id,
      question: row!.question,
      answer: row!.answer,
      itemId: row!.attemptItemId,
      broadcast: row!.broadcast,
      mine: true,
      createdAt: row!.createdAt.toISOString(),
      answeredAt: row!.answeredAt?.toISOString() ?? null,
    };
    // Broadcast answers reach every candidate (fair to all). Papers are shuffled, so the item id and `mine`
    // only make sense to the asker: the broadcast copy drops them and the asker's workspace merges by id.
    if (row!.broadcast) this.realtime.toExamCandidates(c.examId, RT.clarificationAnswered, { ...view, mine: false, itemId: null });
    else this.realtime.toAttempt(c.attemptId, RT.clarificationAnswered, view);

    const [staffView] = await this.clarificationRows(eq(clarifications.id, c.id));
    this.realtime.toExamStaff(c.examId, RT.clarificationAnswered, staffView);
    await this.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'monitoring.clarification_answered',
      entityType: 'clarification',
      entityId: c.id,
      summary: row!.broadcast ? 'Answered a clarification for every candidate' : `Answered ${staffView!.candidate.name}'s clarification privately`,
      metadata: { examId: c.examId, attemptId: c.attemptId, broadcast: row!.broadcast },
      ip: actor.ip,
    });
    return staffView!;
  }

  // ---------------------------------------------------------------- interventions

  async extend(actor: Actor, attemptId: string, input: ExtendInput): Promise<ExtensionResult> {
    const { auth } = actor;
    const attempt = await this.staffAttempt(auth, attemptId);
    if (attempt.status === 'submitted') throw new ConflictError('This attempt is already submitted.', ERROR_CODES.ATTEMPT_CLOSED);
    // The engine moves the deadline, records the timeline event, pushes RT.timeExtended and writes the audit entry.
    await this.engine.extendTime(attempt.id, input.minutes * 60, input.reason, auth.user.id);
    return this.extensionOf(attempt.id);
  }

  /**
   * Extends everyone in progress, or only the candidates in the detected outage (recomputed here, never taken from
   * the client). Each extension goes through the engine, which records a `time_extended` event (with `seconds`),
   * pushes the new deadline and writes the `attempt.time_extended` audit entry, so nothing is recorded twice. Those
   * events also make the outage suggestion go away for the candidates they cover.
   */
  async extendAll(actor: Actor, examId: string, input: ExtendAllInput): Promise<BulkExtensionResult> {
    const { auth } = actor;
    const exam = await loadExamForStaff(this.db, auth, examId);
    const now = new Date();
    let targets = (await this.attemptRows(and(eq(attempts.examId, exam.id), eq(attempts.status, 'in_progress'), gt(attempts.deadlineAt, now))!)).map(
      (r) => r.id,
    );
    if (input.onlyAffected) {
      const suggestion = this.suggest(await this.attemptRows(eq(attempts.examId, exam.id)), await this.outageSignals(exam.id, now), now);
      if (!suggestion) throw new ConflictError('No connection outage is affecting candidates right now.');
      const affected = new Set(suggestion.attemptIds);
      targets = targets.filter((id) => affected.has(id));
    }
    if (!targets.length) throw new ConflictError('No candidates are in progress, so there is no one to extend.');

    const extended: ExtensionResult[] = [];
    const skipped: BulkExtensionResult['skipped'] = [];
    for (const id of targets) {
      try {
        await this.engine.extendTime(id, input.minutes * 60, input.reason, auth.user.id);
        extended.push(await this.extensionOf(id));
      } catch (err) {
        skipped.push({ attemptId: id, reason: err instanceof Error ? err.message : 'Could not extend' });
      }
    }
    return { extended, skipped, minutes: input.minutes };
  }

  async forceSubmit(actor: Actor, attemptId: string, input: ForceSubmitInput) {
    const { auth } = actor;
    const attempt = await this.staffAttempt(auth, attemptId);
    if (attempt.status === 'submitted') throw new ConflictError('This attempt is already submitted.', ERROR_CODES.ATTEMPT_CLOSED);
    // The engine finalizes and grades, tells the candidate, pushes RT.attemptSubmitted and writes the audit entry.
    await this.engine.forceSubmit(attempt.id, auth.user.id, input.reason);
    const [after] = await this.db
      .select({ status: attempts.status, submitReason: attempts.submitReason, submittedAt: attempts.submittedAt })
      .from(attempts)
      .where(eq(attempts.id, attempt.id))
      .limit(1);
    return { attemptId: attempt.id, status: after!.status, submitReason: after!.submitReason, submittedAt: after!.submittedAt?.toISOString() ?? null };
  }

  // ---------------------------------------------------------------- incidents

  async listIncidents(auth: TenantAuthContext, examId: string, query: IncidentQuery): Promise<IncidentList> {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const severities = query.severity?.length ? query.severity : INDICATOR_SEVERITIES;
    const status =
      query.status === 'open'
        ? openIndicator
        : query.status === 'reviewed'
          ? inArray(attemptEvents.reviewStatus, ['no_concern', 'follow_up', 'escalated'])
          : undefined;
    const [rows, totals] = await Promise.all([
      this.eventRows(and(eq(attemptEvents.examId, exam.id), inArray(attemptEvents.severity, severities), status)!, 1000),
      this.db
        .select({
          severity: attemptEvents.severity,
          open: sql<number>`count(*) filter (where ${openIndicator})`.mapWith(Number),
          total: count(),
        })
        .from(attemptEvents)
        .innerJoin(attempts, eq(attempts.id, attemptEvents.attemptId))
        .where(and(eq(attemptEvents.examId, exam.id), realAttempts, inArray(attemptEvents.severity, INDICATOR_SEVERITIES)))
        .groupBy(attemptEvents.severity),
    ]);
    const bySeverity: Record<IndicatorSeverity, number> = { low: 0, medium: 0, high: 0 };
    let open = 0;
    let reviewed = 0;
    for (const t of totals) {
      if (t.severity === 'info') continue;
      bySeverity[t.severity] = t.total;
      open += t.open;
      reviewed += t.total - t.open;
    }
    return { notice: INDICATOR_NOTICE, counts: { open, reviewed, bySeverity }, incidents: rows.map(toMonitorEvent) };
  }

  async reviewIncident(actor: Actor, eventId: string, input: ReviewInput): Promise<MonitorEvent & { notice: string }> {
    const { auth } = actor;
    const [ev] = await this.db
      .select({ id: attemptEvents.id, examId: attemptEvents.examId, attemptId: attemptEvents.attemptId, severity: attemptEvents.severity, type: attemptEvents.type })
      .from(attemptEvents)
      .innerJoin(attempts, eq(attempts.id, attemptEvents.attemptId))
      .where(and(eq(attemptEvents.id, eventId), eq(attemptEvents.organizationId, auth.organization.id), realAttempts))
      .limit(1);
    if (!ev) throw new NotFoundError('Indicator');
    await loadExamForStaff(this.db, auth, ev.examId);
    if (ev.severity === 'info') throw new ValidationError('Only integrity indicators can be reviewed, not routine events.');

    await this.db.transaction(async (tx) => {
      await tx
        .update(attemptEvents)
        .set({ reviewStatus: input.status, reviewedBy: auth.user.id, reviewedAt: new Date(), reviewNote: input.note || null })
        .where(eq(attemptEvents.id, ev.id));
      // Priority comes from indicators nobody has cleared yet, recomputed by the engine's own rule.
      await refreshReviewPriority(tx, ev.attemptId);
    });
    const [row] = await this.eventRows(eq(attemptEvents.id, ev.id), 1);
    const event = toMonitorEvent(row!);
    this.realtime.toExamStaff(ev.examId, RT.attemptIncident, { attemptId: ev.attemptId, event });
    await this.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'monitoring.incident_reviewed',
      entityType: 'attempt_event',
      entityId: ev.id,
      summary: `Reviewed a ${ev.type.replaceAll('_', ' ')} indicator for ${event.candidate.name}: ${input.status.replace('_', ' ')}`,
      metadata: { examId: ev.examId, attemptId: ev.attemptId, status: input.status, note: input.note || null },
      ip: actor.ip,
    });
    // Same framing as every incidents response: an indicator, not evidence.
    return { ...event, notice: INDICATOR_NOTICE };
  }

  // ---------------------------------------------------------------- queries

  private attemptRows(where: SQL) {
    return this.db
      .select({
        id: attempts.id,
        examId: attempts.examId,
        userId: attempts.userId,
        status: attempts.status,
        submitReason: attempts.submitReason,
        startedAt: attempts.startedAt,
        deadlineAt: attempts.deadlineAt,
        submittedAt: attempts.submittedAt,
        lastSeenAt: attempts.lastSeenAt,
        timeExtensionSeconds: attempts.timeExtensionSeconds,
        clientInfo: attempts.clientInfo,
        reviewPriority: attempts.reviewPriority,
        name: users.name,
        email: users.email,
        rollNumber: memberships.externalId,
        cohort: memberships.cohort,
      })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.userId))
      .leftJoin(memberships, and(eq(memberships.userId, attempts.userId), eq(memberships.organizationId, attempts.organizationId)))
      .where(and(where, realAttempts));
  }

  private answerStats(where: SQL) {
    return this.db
      .select({
        attemptId: answers.attemptId,
        answered: sql<number>`count(*) filter (where ${answered})`.mapWith(Number),
        flagged: sql<number>`count(*) filter (where ${answers.flagged})`.mapWith(Number),
      })
      .from(answers)
      .innerJoin(attempts, eq(attempts.id, answers.attemptId))
      .where(and(where, realAttempts))
      .groupBy(answers.attemptId);
  }

  private itemStats(where: SQL) {
    return this.db
      .select({ attemptId: attemptItems.attemptId, n: count() })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .where(and(where, realAttempts))
      .groupBy(attemptItems.attemptId);
  }

  private eventRows(where: SQL, limit: number) {
    const reviewer = alias(users, 'reviewer');
    return this.db
      .select({
        id: attemptEvents.id,
        attemptId: attemptEvents.attemptId,
        type: attemptEvents.type,
        severity: attemptEvents.severity,
        payload: attemptEvents.payload,
        clientTs: attemptEvents.clientTs,
        createdAt: attemptEvents.createdAt,
        reviewStatus: attemptEvents.reviewStatus,
        reviewedAt: attemptEvents.reviewedAt,
        reviewNote: attemptEvents.reviewNote,
        reviewerName: reviewer.name,
        userId: attempts.userId,
        name: users.name,
        rollNumber: memberships.externalId,
      })
      .from(attemptEvents)
      .innerJoin(attempts, eq(attempts.id, attemptEvents.attemptId))
      .innerJoin(users, eq(users.id, attempts.userId))
      .leftJoin(memberships, and(eq(memberships.userId, attempts.userId), eq(memberships.organizationId, attempts.organizationId)))
      .leftJoin(reviewer, eq(reviewer.id, attemptEvents.reviewedBy))
      .where(and(where, realAttempts))
      .orderBy(desc(attemptEvents.createdAt))
      .limit(limit);
  }

  private clarificationRows(where: SQL): Promise<StaffClarification[]> {
    const answerer = alias(users, 'answerer');
    return this.db
      .select({
        id: clarifications.id,
        attemptId: clarifications.attemptId,
        question: clarifications.question,
        answer: clarifications.answer,
        broadcast: clarifications.broadcast,
        createdAt: clarifications.createdAt,
        answeredAt: clarifications.answeredAt,
        answeredBy: clarifications.answeredBy,
        answererName: answerer.name,
        userId: clarifications.askedBy,
        name: users.name,
        rollNumber: memberships.externalId,
        itemId: attemptItems.id,
        itemNumber,
        questionTitle: questions.title,
      })
      .from(clarifications)
      .innerJoin(attempts, eq(attempts.id, clarifications.attemptId))
      .innerJoin(users, eq(users.id, clarifications.askedBy))
      .leftJoin(memberships, and(eq(memberships.userId, clarifications.askedBy), eq(memberships.organizationId, attempts.organizationId)))
      .leftJoin(attemptItems, eq(attemptItems.id, clarifications.attemptItemId))
      .leftJoin(questions, eq(questions.id, attemptItems.questionId))
      .leftJoin(answerer, eq(answerer.id, clarifications.answeredBy))
      .where(and(where, realAttempts))
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          attemptId: r.attemptId,
          candidate: candidateRef(r),
          question: r.question,
          item: r.itemId !== null ? { id: r.itemId, number: r.itemNumber, questionTitle: r.questionTitle } : null,
          answer: r.answer,
          broadcast: r.broadcast,
          answeredBy: r.answeredBy && r.answererName ? { id: r.answeredBy, name: r.answererName } : null,
          createdAt: r.createdAt.toISOString(),
          answeredAt: r.answeredAt?.toISOString() ?? null,
        })),
      );
  }

  private outageSignals(examId: string, now: Date) {
    return this.db
      .select({ attemptId: attemptEvents.attemptId, type: attemptEvents.type, createdAt: attemptEvents.createdAt, clientTs: attemptEvents.clientTs })
      .from(attemptEvents)
      .innerJoin(attempts, eq(attempts.id, attemptEvents.attemptId))
      .where(
        and(
          eq(attemptEvents.examId, examId),
          realAttempts,
          inArray(attemptEvents.type, [...CONNECTIVITY_TYPES, ...COMPENSATION_TYPES]),
          gte(attemptEvents.createdAt, new Date(now.getTime() - OUTAGE_LOOKBACK_MS)),
        ),
      );
  }

  private suggest(rows: AttemptRow[], signals: Awaited<ReturnType<MonitoringService['outageSignals']>>, now: Date): OutageSuggestion | null {
    const inProgress = rows.filter((r) => r.status === 'in_progress' && r.deadlineAt > now);
    const started = new Map(inProgress.map((r) => [r.id, r.startedAt]));
    const live = signals.filter((s) => started.has(s.attemptId));
    const at = (s: (typeof live)[number]) => eventTime(s, started.get(s.attemptId)!);
    return detectOutage({
      now,
      inProgress: inProgress.map((r) => ({ attemptId: r.id, lastSeenAt: r.lastSeenAt })),
      wentOffline: live.filter((s) => s.type === 'went_offline').map((s) => ({ attemptId: s.attemptId, at: at(s), receivedAt: s.createdAt })),
      cameOnline: live.filter((s) => s.type === 'came_online' || s.type === 'offline_journal_received').map((s) => ({ attemptId: s.attemptId, at: s.createdAt })),
      compensated: live.filter((s) => COMPENSATION_TYPES.includes(s.type)).map((s) => ({ attemptId: s.attemptId, at: s.createdAt })),
    });
  }

  // ---------------------------------------------------------------- helpers

  private toLiveAttempt(
    row: AttemptRow,
    now: Date,
    s: { answered: number; flagged: number; items: number; incidents: LiveAttempt['incidents']; deviceSwitches: number },
  ): LiveAttempt {
    const inProgress = row.status === 'in_progress';
    return {
      attemptId: row.id,
      candidate: candidateRef(row),
      email: row.email,
      cohort: row.cohort,
      status: row.status,
      submitReason: row.submitReason,
      answeredCount: s.answered,
      itemCount: s.items,
      flaggedCount: s.flagged,
      startedAt: row.startedAt.toISOString(),
      deadlineAt: row.deadlineAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      remainingSeconds: row.status === 'submitted' ? null : Math.max(0, Math.floor((row.deadlineAt.getTime() - now.getTime()) / 1000)),
      timeExtensionSeconds: row.timeExtensionSeconds,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      online: inProgress && isOnline(row.lastSeenAt, now),
      rttMs: inProgress ? rttOf(row.clientInfo) : null,
      reviewPriority: row.reviewPriority,
      incidents: s.incidents,
      deviceSwitches: s.deviceSwitches,
    };
  }

  /** A real attempt in the caller's tenant, on an exam they may monitor. */
  private async staffAttempt(auth: TenantAuthContext, attemptId: string) {
    const [row] = await this.db
      .select({ id: attempts.id, examId: attempts.examId, status: attempts.status, deadlineAt: attempts.deadlineAt, name: users.name })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.userId))
      .where(and(eq(attempts.id, attemptId), eq(attempts.organizationId, auth.organization.id), realAttempts))
      .limit(1);
    if (!row) throw new NotFoundError('Attempt');
    await loadExamForStaff(this.db, auth, row.examId);
    return row;
  }

  /** The caller's own attempt (candidate endpoints). Sandbox previews are allowed but never reach staff views. */
  private async ownAttempt(auth: TenantAuthContext, attemptId: string) {
    const [row] = await this.db
      .select({
        id: attempts.id,
        examId: attempts.examId,
        organizationId: attempts.organizationId,
        status: attempts.status,
        deadlineAt: attempts.deadlineAt,
        isSandbox: attempts.isSandbox,
      })
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.userId, auth.user.id), eq(attempts.organizationId, auth.organization.id)))
      .limit(1);
    if (!row) throw new NotFoundError('Attempt');
    return row;
  }

  private async extensionOf(attemptId: string): Promise<ExtensionResult> {
    const [row] = await this.db
      .select({ deadlineAt: attempts.deadlineAt, timeExtensionSeconds: attempts.timeExtensionSeconds })
      .from(attempts)
      .where(eq(attempts.id, attemptId))
      .limit(1);
    return { attemptId, deadlineAt: row!.deadlineAt.toISOString(), timeExtensionSeconds: row!.timeExtensionSeconds };
  }
}
