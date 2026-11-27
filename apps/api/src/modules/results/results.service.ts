import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { RT, examPhase } from '@athena/shared';
import type { Container } from '../../container';
import type { Executor } from '../../db/client';
import { answers, attemptItems, attempts, disputes, examEnrollments, exams, memberships, notifications, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { histogram, mean, median, round, sampleSd } from '../../domain/analytics/stats';
import { appendLedger } from '../../domain/ledger/ledger';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import { loadExamForStaff } from '../exams/exam-access';
import { EXAMINER_ROLES, GRADING_ROLES, settingsOf } from '../grading/exam-structure';
import { supersedeReportsForExam } from '../reports/report-status';
import type { ReportsService } from '../reports/reports.service';
import { buildResultCard, percentOf } from './result-card';

type ExamRow = typeof exams.$inferSelect;

export type ChecklistLevel = 'blocker' | 'warning' | 'info' | 'ok';
export interface ChecklistItem {
  key: 'ungraded' | 'in_progress' | 'window_open' | 'offline_held' | 'disputes' | 'review_priority' | 'absent' | 'sandbox';
  label: string;
  detail: string;
  count: number;
  level: ChecklistLevel;
}

const OPEN_DISPUTES = ['open', 'under_review', 'needs_info', 'appealed'] as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Checklist text is read by people, so dates are written out in the institution's time (PKT), like the PDFs. */
const closesLabel = (d: Date) =>
  `${d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })} PKT`;

/**
 * Results review and controlled publication. Candidates see nothing (no score, no feedback, no key) until an
 * examiner publishes; publishing and unpublishing are ledgered, versioned and notified.
 */
export class ResultsService {
  constructor(
    private readonly c: Container,
    private readonly reports: ReportsService,
  ) {}

  // ---------------------------------------------------------------- staff

  /** Pre-publication checklist. Blockers stop publication unless the examiner forces it with a reason. */
  async checklist(db: Executor, exam: ExamRow): Promise<{ items: ChecklistItem[]; blockers: ChecklistItem[] }> {
    const [ungraded] = await db
      .select({
        parts: sql<number>`count(*) filter (where not ((${attemptItems.type} not in ('long_text','code') or ${answers.manualScore} is not null) and (${attemptItems.workingMarks} = 0 or ${answers.workingScore} is not null)))`.mapWith(Number),
        attempts: sql<number>`count(distinct ${attempts.id}) filter (where not ((${attemptItems.type} not in ('long_text','code') or ${answers.manualScore} is not null) and (${attemptItems.workingMarks} = 0 or ${answers.workingScore} is not null)))`.mapWith(Number),
      })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
      .where(and(eq(attempts.examId, exam.id), realAttempts, eq(attempts.status, 'submitted'), isNull(attemptItems.voidReason)));

    const [counts] = await db
      .select({
        running: sql<number>`count(*) filter (where ${attempts.isSandbox} = false and ${attempts.status} <> 'submitted')`.mapWith(Number),
        sandbox: sql<number>`count(*) filter (where ${attempts.isSandbox} = true)`.mapWith(Number),
        high: sql<number>`count(*) filter (where ${attempts.isSandbox} = false and ${attempts.status} = 'submitted' and ${attempts.reviewPriority} = 'high')`.mapWith(Number),
      })
      .from(attempts)
      .where(eq(attempts.examId, exam.id));

    const [offline] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(answers)
      .innerJoin(attempts, eq(attempts.id, answers.attemptId))
      .where(and(eq(attempts.examId, exam.id), realAttempts, isNotNull(answers.pendingOffline)));

    const [openDisputes] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(disputes)
      .where(and(eq(disputes.examId, exam.id), inArray(disputes.status, [...OPEN_DISPUTES])));

    const [absent] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(examEnrollments)
      .where(
        and(
          eq(examEnrollments.examId, exam.id),
          eq(examEnrollments.status, 'enrolled'),
          sql`not exists (select 1 from ${attempts} t where t.exam_id = ${exam.id} and t.user_id = ${examEnrollments.userId} and t.is_sandbox = false)`,
        ),
      );

    const phase = examPhase(exam);
    const items: ChecklistItem[] = [
      {
        key: 'ungraded',
        label: 'Grading complete',
        count: ungraded?.parts ?? 0,
        level: (ungraded?.parts ?? 0) > 0 ? 'blocker' : 'ok',
        detail: (ungraded?.parts ?? 0) > 0 ? `${plural(ungraded!.parts, 'answer part')} across ${plural(ungraded!.attempts, 'attempt')} still need a grader.` : 'Every answer has a score.',
      },
      {
        key: 'in_progress',
        label: 'No attempts still running',
        count: counts?.running ?? 0,
        level: (counts?.running ?? 0) > 0 ? 'blocker' : 'ok',
        detail: (counts?.running ?? 0) > 0 ? `${plural(counts!.running, 'candidate')} still writing or syncing offline answers.` : 'Every started attempt is submitted.',
      },
      {
        key: 'window_open',
        label: 'Exam window closed',
        count: phase === 'ongoing' || phase === 'scheduled' ? 1 : 0,
        level: phase === 'ongoing' || phase === 'scheduled' ? 'blocker' : 'ok',
        detail:
          phase === 'ongoing' || phase === 'scheduled'
            ? `The window is open until ${closesLabel(exam.windowClosesAt)}; candidates who have not started could still sit the exam.`
            : 'Nobody can start the exam any more.',
      },
      {
        key: 'offline_held',
        label: 'Offline answers decided',
        count: offline?.n ?? 0,
        level: (offline?.n ?? 0) > 0 ? 'blocker' : 'ok',
        detail: (offline?.n ?? 0) > 0 ? `${plural(offline!.n, 'answer')} arrived after the deadline and await your decision.` : 'No late offline answers are waiting.',
      },
      {
        key: 'disputes',
        label: 'Disputes',
        count: openDisputes?.n ?? 0,
        level: (openDisputes?.n ?? 0) > 0 ? 'warning' : 'ok',
        detail: (openDisputes?.n ?? 0) > 0 ? `${plural(openDisputes!.n, 'dispute')} still open. Scores may change after publication.` : 'No open disputes.',
      },
      {
        key: 'review_priority',
        label: 'Integrity review',
        count: counts?.high ?? 0,
        level: (counts?.high ?? 0) > 0 ? 'warning' : 'ok',
        detail: (counts?.high ?? 0) > 0 ? `${plural(counts!.high, 'attempt')} flagged high priority for integrity review.` : 'No attempts flagged high priority.',
      },
      {
        key: 'absent',
        label: 'Absent candidates',
        count: absent?.n ?? 0,
        level: 'info',
        detail: (absent?.n ?? 0) > 0 ? `${plural(absent!.n, 'enrolled candidate')} never started; they receive no result.` : 'Every enrolled candidate made an attempt.',
      },
      {
        key: 'sandbox',
        label: 'Previews excluded',
        count: counts?.sandbox ?? 0,
        level: 'info',
        detail: (counts?.sandbox ?? 0) > 0 ? `${plural(counts!.sandbox, 'examiner preview')} excluded from results and statistics.` : 'No examiner previews to exclude.',
      },
    ];
    return { items, blockers: items.filter((i) => i.level === 'blocker') };
  }

  async examResults(auth: TenantAuthContext, examId: string) {
    const exam = await loadExamForStaff(this.c.db, auth, examId, GRADING_ROLES);
    const settings = settingsOf(exam);
    const rows = await this.c.db
      .select({
        attemptId: attempts.id,
        userId: attempts.userId,
        status: attempts.status,
        submitReason: attempts.submitReason,
        startedAt: attempts.startedAt,
        submittedAt: attempts.submittedAt,
        score: attempts.score,
        maxScore: attempts.maxScore,
        gradingStatus: attempts.gradingStatus,
        reviewPriority: attempts.reviewPriority,
        name: users.name,
        email: users.email,
        rollNumber: memberships.externalId,
        cohort: memberships.cohort,
      })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.userId))
      .leftJoin(memberships, and(eq(memberships.userId, attempts.userId), eq(memberships.organizationId, exam.organizationId)))
      .where(and(eq(attempts.examId, examId), realAttempts))
      .orderBy(desc(attempts.score));

    const pending = await this.c.db
      .select({
        attemptId: attemptItems.attemptId,
        n: sql<number>`count(*) filter (where not ((${attemptItems.type} not in ('long_text','code') or ${answers.manualScore} is not null) and (${attemptItems.workingMarks} = 0 or ${answers.workingScore} is not null)))`.mapWith(Number),
      })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
      .where(and(eq(attempts.examId, examId), realAttempts, isNull(attemptItems.voidReason)))
      .groupBy(attemptItems.attemptId);
    const pendingBy = new Map(pending.map((p) => [p.attemptId, p.n]));

    const submitted = rows.filter((r) => r.status === 'submitted');
    const percents = submitted.filter((r) => r.maxScore > 0).map((r) => percentOf(r.score ?? 0, r.maxScore));
    const pass = settings.passPercent;
    const sortedPercents = [...percents].sort((a, b) => b - a);

    const out = rows.map((r) => {
      // Rank and pass use the exact share; only the displayed percent is rounded.
      const exact = r.status === 'submitted' && r.maxScore > 0 ? percentOf(r.score ?? 0, r.maxScore) : null;
      const percent = exact === null ? null : r1(exact);
      return {
        attemptId: r.attemptId,
        candidate: { id: r.userId, name: r.name, email: r.email, rollNumber: r.rollNumber, cohort: r.cohort },
        status: r.status,
        submitReason: r.submitReason,
        startedAt: r.startedAt,
        submittedAt: r.submittedAt,
        score: r.status === 'submitted' ? r.score : null,
        maxScore: r.maxScore,
        percent,
        pass: exact === null || pass === null ? null : exact >= pass - 1e-9,
        rank: exact === null ? null : 1 + sortedPercents.filter((p) => p > exact + 1e-9).length,
        gradingStatus: r.gradingStatus,
        ungradedParts: pendingBy.get(r.attemptId) ?? 0,
        reviewPriority: r.reviewPriority,
      };
    });

    const [publisher] = exam.resultsPublishedBy
      ? await this.c.db.select({ name: users.name }).from(users).where(eq(users.id, exam.resultsPublishedBy))
      : [];
    const checklist = await this.checklist(this.c.db, exam);
    return {
      exam: {
        id: exam.id,
        title: exam.title,
        code: exam.code,
        phase: examPhase(exam),
        windowClosesAt: exam.windowClosesAt,
        totalMarks: exam.totalMarks,
        passPercent: pass,
        resultsStatus: exam.resultsStatus,
        resultsVersion: exam.resultsVersion,
        resultsPublishedAt: exam.resultsPublishedAt,
        resultsPublishedBy: publisher?.name ?? null,
        showCorrectAnswers: settings.results.showCorrectAnswers,
        showFeedback: settings.results.showFeedback,
      },
      rows: out,
      distribution: {
        n: percents.length,
        mean: round(mean(percents), 1),
        median: round(median(percents), 1),
        sd: round(sampleSd(percents), 1),
        min: percents.length ? r1(Math.min(...percents)) : null,
        max: percents.length ? r1(Math.max(...percents)) : null,
        passPercent: pass,
        passed: pass === null ? null : percents.filter((p) => p >= pass - 1e-9).length,
        passRate: pass === null || !percents.length ? null : round(percents.filter((p) => p >= pass - 1e-9).length / percents.length, 3),
        histogram: histogram(percents, 10, 0, 100),
      },
      checklist: checklist.items,
      canPublish: auth.permissions.has('results.publish'),
    };
  }

  async publish(auth: TenantAuthContext, examId: string, input: { force?: boolean; reason?: string | null }) {
    await loadExamForStaff(this.c.db, auth, examId, EXAMINER_ROLES);
    const out = await this.c.db.transaction(async (tx) => {
      const [exam] = await tx.select().from(exams).where(eq(exams.id, examId)).for('update');
      if (!exam) throw new NotFoundError('Exam');
      if (exam.resultsStatus === 'published') throw new ConflictError('Results are already published');
      const { blockers } = await this.checklist(tx, exam);
      const reason = input.reason?.trim() || null;
      if (blockers.length && !input.force) {
        throw new ConflictError(`Not ready to publish: ${blockers.map((b) => b.detail).join(' ')}`, 'PUBLISH_BLOCKED');
      }
      if (blockers.length && (!reason || reason.length < 10)) {
        throw new ValidationError('Explain why you are publishing before the checklist is clear', { reason: 'Give a reason of at least 10 characters' });
      }
      const version = exam.resultsVersion + 1;
      const now = new Date();
      await tx
        .update(exams)
        .set({ resultsStatus: 'published', resultsVersion: version, resultsPublishedAt: now, resultsPublishedBy: auth.user.id })
        .where(eq(exams.id, examId));
      const recipients = await tx
        .select({ attemptId: attempts.id, userId: attempts.userId })
        .from(attempts)
        .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted')));
      await appendLedger(tx, {
        organizationId: exam.organizationId,
        examId,
        action: 'results_published',
        actorId: auth.user.id,
        reason,
        metadata: { resultsVersion: version, candidates: recipients.length, forced: blockers.length > 0, blockers: blockers.map((b) => ({ key: b.key, count: b.count })) },
      });
      const notes = recipients.length
        ? await tx
            .insert(notifications)
            .values(
              recipients.map((r) => ({
                userId: r.userId,
                organizationId: exam.organizationId,
                kind: 'results_published',
                title: `Results are out: ${exam.title}`,
                body: 'Your score and feedback are ready.',
                link: `/results/${r.attemptId}`,
              })),
            )
            .returning()
        : [];
      return { exam, version, now, notes, forced: blockers.length > 0, blockers };
    });

    for (const n of out.notes) {
      this.c.realtime.toUser(n.userId, RT.notification, { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt, readAt: null });
    }
    await this.c.audit.record({
      organizationId: out.exam.organizationId,
      actorId: auth.user.id,
      action: 'results.published',
      entityType: 'exam',
      entityId: examId,
      summary: `Published results for ${out.exam.title} (version ${out.version}) to ${plural(out.notes.length, 'candidate')}${out.forced ? ' with open checklist items' : ''}`,
      metadata: { resultsVersion: out.version, forced: out.forced, reason: input.reason ?? null, blockers: out.blockers.map((b) => b.key) },
    });
    return { resultsStatus: 'published' as const, resultsVersion: out.version, resultsPublishedAt: out.now, notified: out.notes.length, forced: out.forced };
  }

  async unpublish(auth: TenantAuthContext, examId: string, input: { reason: string }) {
    await loadExamForStaff(this.c.db, auth, examId, EXAMINER_ROLES);
    const out = await this.c.db.transaction(async (tx) => {
      const [exam] = await tx.select().from(exams).where(eq(exams.id, examId)).for('update');
      if (!exam) throw new NotFoundError('Exam');
      if (exam.resultsStatus !== 'published') throw new ConflictError('Results are not published');
      const version = exam.resultsVersion + 1;
      await tx.update(exams).set({ resultsStatus: 'unpublished', resultsVersion: version, resultsPublishedAt: null, resultsPublishedBy: null }).where(eq(exams.id, examId));
      const superseded = await supersedeReportsForExam(tx, examId);
      await appendLedger(tx, {
        organizationId: exam.organizationId,
        examId,
        action: 'results_unpublished',
        actorId: auth.user.id,
        reason: input.reason,
        metadata: { resultsVersion: version, supersededReports: superseded },
      });
      const recipients = await tx
        .select({ attemptId: attempts.id, userId: attempts.userId })
        .from(attempts)
        .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted')));
      const notes = recipients.length
        ? await tx
            .insert(notifications)
            .values(
              recipients.map((r) => ({
                userId: r.userId,
                organizationId: exam.organizationId,
                kind: 'results_unpublished',
                title: `Results withdrawn for review: ${exam.title}`,
                body: 'Your examiner is reviewing the results. Earlier reports are no longer valid.',
                link: `/results/${r.attemptId}`,
              })),
            )
            .returning()
        : [];
      return { exam, version, superseded, notes };
    });
    for (const n of out.notes) {
      this.c.realtime.toUser(n.userId, RT.notification, { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt, readAt: null });
    }
    await this.c.audit.record({
      organizationId: out.exam.organizationId,
      actorId: auth.user.id,
      action: 'results.unpublished',
      entityType: 'exam',
      entityId: examId,
      summary: `Unpublished results for ${out.exam.title}: ${input.reason}`,
      metadata: { resultsVersion: out.version, supersededReports: out.superseded },
    });
    return { resultsStatus: 'unpublished' as const, resultsVersion: out.version, supersededReports: out.superseded };
  }

  // ---------------------------------------------------------------- candidate

  async mine(auth: TenantAuthContext) {
    const rows = await this.c.db
      .select({ attempt: attempts, exam: exams })
      .from(attempts)
      .innerJoin(exams, eq(exams.id, attempts.examId))
      .where(and(eq(attempts.userId, auth.user.id), eq(attempts.organizationId, auth.organization.id), realAttempts, eq(attempts.status, 'submitted')))
      .orderBy(desc(attempts.submittedAt));
    return {
      results: rows.map(({ attempt, exam }) => {
        const published = exam.resultsStatus === 'published';
        const passPercent = settingsOf(exam).passPercent;
        const exact = published && attempt.maxScore > 0 ? percentOf(attempt.score ?? 0, attempt.maxScore) : null;
        const percent = exact === null ? null : r1(exact);
        return {
          attemptId: attempt.id,
          exam: { id: exam.id, title: exam.title, code: exam.code },
          submittedAt: attempt.submittedAt,
          published,
          publishedAt: published ? exam.resultsPublishedAt : null,
          // Nothing score-related leaves the server before publication.
          score: published ? attempt.score : null,
          maxScore: published ? attempt.maxScore : null,
          percent,
          pass: exact === null || passPercent === null ? null : exact >= passPercent - 1e-9,
        };
      }),
    };
  }

  async mineDetail(auth: TenantAuthContext, attemptId: string) {
    const [row] = await this.c.db
      .select({ attempt: attempts, exam: exams })
      .from(attempts)
      .innerJoin(exams, eq(exams.id, attempts.examId))
      .where(and(eq(attempts.id, attemptId), eq(attempts.userId, auth.user.id), eq(attempts.organizationId, auth.organization.id), realAttempts))
      .limit(1);
    if (!row) throw new NotFoundError('Result');
    const { attempt, exam } = row;
    const settings = settingsOf(exam);
    const published = exam.resultsStatus === 'published' && attempt.status === 'submitted';
    const base = {
      attemptId: attempt.id,
      exam: { id: exam.id, title: exam.title, code: exam.code },
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      published,
    };
    if (!published) {
      const [counts] = await this.c.db
        .select({ items: sql<number>`count(*)`.mapWith(Number) })
        .from(attemptItems)
        .where(eq(attemptItems.attemptId, attempt.id));
      return { ...base, itemCount: counts?.items ?? 0, result: null, verification: null, disputes: null };
    }

    const card = await buildResultCard(this.c.db, attempt, exam, { solutions: settings.results.showCorrectAnswers, feedback: settings.results.showFeedback });
    const report = await this.reports.currentReport(attempt.id, exam.resultsVersion);
    const closesAt = exam.resultsPublishedAt ? new Date(exam.resultsPublishedAt.getTime() + settings.results.disputeWindowDays * 86_400_000) : null;
    return {
      ...base,
      publishedAt: exam.resultsPublishedAt,
      showCorrectAnswers: settings.results.showCorrectAnswers,
      result: card,
      verification: report
        ? { code: report.verificationCode, url: this.reports.verifyUrl(report.verificationCode), issuedAt: report.issuedAt, qrDataUrl: await this.reports.qrDataUrl(report.verificationCode) }
        : null,
      disputes: {
        allowed: settings.results.allowDisputes && (closesAt === null || closesAt.getTime() > Date.now()),
        closesAt,
      },
    };
  }
}
