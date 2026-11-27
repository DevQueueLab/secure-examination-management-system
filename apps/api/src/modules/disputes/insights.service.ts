import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DISPUTE_CATEGORIES, DISPUTE_STATUSES, type LedgerAction } from '@athena/shared';
import type { Container } from '../../container';
import { answers, attemptItems, attempts, disputes, exams, gradeLedger, questions, remedies, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { ledgerForExam, verifyLedger } from '../../domain/ledger/ledger';
import { round3 } from '../../domain/rng';
import { NotFoundError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import { loadExamForStaff } from '../exams/exam-access';
import { GRADING_ROLES } from '../grading/exam-structure';
import { percentOf } from './dispute.policy';
import { ACTION_LABEL, candidateLabels, hasExaminerAccess, questionLabels, roleLabels, short, userNames } from './dispute.support';
import { CATEGORY_LABEL, STATUS_LABEL } from './dispute.views';

const MILESTONES: LedgerAction[] = ['results_published', 'results_unpublished'];

/** Read models over the ledger: a candidate's score history and an exam's dispute and integrity summary. */
export class DisputeInsightsService {
  constructor(private readonly c: Container) {}

  /**
   * Every change to one attempt's score, from the hash-chained ledger: who (by role), when, why, before and after.
   * Candidates see it once results are published; staff on the exam may always look.
   */
  async history(auth: TenantAuthContext, attemptId: string) {
    const db = this.c.db;
    const [row] = await db
      .select({ attempt: attempts, exam: exams })
      .from(attempts)
      .innerJoin(exams, eq(exams.id, attempts.examId))
      .where(and(eq(attempts.id, attemptId), eq(attempts.organizationId, auth.organization.id), realAttempts))
      .limit(1);
    if (!row) throw new NotFoundError('Attempt');
    const { attempt, exam } = row;
    const owner = attempt.userId === auth.user.id;
    if (!owner) {
      if (!auth.permissions.has('disputes.resolve') && !auth.permissions.has('grading.grade')) throw new NotFoundError('Attempt');
      await loadExamForStaff(db, auth, exam.id, GRADING_ROLES);
    }
    const published = exam.resultsStatus === 'published';
    const head = { exam: { id: exam.id, title: exam.title, code: exam.code }, published };
    if (owner && !published) {
      return {
        ...head,
        attempt: { id: attempt.id, submittedAt: attempt.submittedAt, score: null, maxScore: null, percent: null, gradingStatus: attempt.gradingStatus },
        entries: [],
        verification: null,
        message: 'Your score history appears here once results are published.',
      };
    }

    const rows = await db
      .select()
      .from(gradeLedger)
      .where(and(eq(gradeLedger.examId, exam.id), or(eq(gradeLedger.attemptId, attempt.id), and(isNull(gradeLedger.attemptId), inArray(gradeLedger.action, MILESTONES)))))
      .orderBy(asc(gradeLedger.seq));
    const items = await db
      .select({ id: attemptItems.id, answerId: answers.id, title: questions.title, marks: attemptItems.marks, workingMarks: attemptItems.workingMarks })
      .from(attemptItems)
      .innerJoin(questions, eq(questions.id, attemptItems.questionId))
      .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
      .where(eq(attemptItems.attemptId, attempt.id))
      .orderBy(asc(attemptItems.position));
    const byAnswer = new Map(
      items
        .map((i, idx) => ({ ...i, number: idx + 1 }))
        .filter((i) => i.answerId)
        .map((i) => [i.answerId!, i]),
    );
    const roles = await roleLabels(db, exam, rows.map((r) => r.actorId));
    const check = await verifyLedger(db);

    const entries = rows.map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const item = r.answerId ? byAnswer.get(r.answerId) : undefined;
      const part = typeof m.part === 'string' ? (m.part as 'answer' | 'working') : null;
      const prev = r.previousScore;
      const next = r.newScore;
      return {
        seq: r.seq,
        at: r.createdAt,
        action: r.action,
        label: ACTION_LABEL[r.action],
        item: item ? { number: item.number, title: item.title } : null,
        part,
        partMax: typeof m.partMax === 'number' ? m.partMax : part === 'answer' ? (item?.marks ?? null) : part === 'working' ? (item?.workingMarks ?? null) : null,
        previous: prev,
        next,
        delta: prev !== null && next !== null ? round3(next - prev) : null,
        voided: m.voided === true,
        outcome: typeof m.outcome === 'string' ? m.outcome : null,
        disputeId: typeof m.disputeId === 'string' ? m.disputeId : null,
        attemptScoreAfter: typeof m.attemptScoreAfter === 'number' ? m.attemptScoreAfter : null,
        reason: r.reason,
        actor: r.action === 'auto_grade' ? 'Automatic marking' : r.actorId ? (roles.get(r.actorId) ?? 'Exam team') : 'System',
        scope: item ? ('question' as const) : r.attemptId ? ('paper' as const) : ('exam' as const),
        hash: short(r.hash),
        prevHash: short(r.prevHash),
      };
    });

    return {
      ...head,
      attempt: {
        id: attempt.id,
        submittedAt: attempt.submittedAt,
        score: attempt.score,
        maxScore: attempt.maxScore,
        percent: percentOf(attempt.score ?? 0, attempt.maxScore),
        gradingStatus: attempt.gradingStatus,
      },
      entries,
      verification: {
        intact: check.ok,
        checked: check.checked,
        brokenAtSeq: check.brokenAtSeq,
        verifiedAt: new Date(),
        attemptEntries: entries.length,
        head: rows.length ? short(rows.at(-1)!.hash) : null,
      },
      message: null,
    };
  }

  /** Dispute health for one exam: counts, timeliness, remedies, and the ledger's integrity. */
  async summary(auth: TenantAuthContext, examId: string) {
    const db = this.c.db;
    const exam = await loadExamForStaff(db, auth, examId, GRADING_ROLES);
    const all = await db
      .select({
        status: disputes.status,
        category: disputes.category,
        outcome: disputes.outcome,
        appealOf: disputes.appealOf,
        dueAt: disputes.dueAt,
        createdAt: disputes.createdAt,
        resolvedAt: disputes.resolvedAt,
      })
      .from(disputes)
      .where(eq(disputes.examId, examId));
    const now = Date.now();
    const active = (s: string) => s === 'open' || s === 'under_review' || s === 'needs_info';
    const byStatus = Object.fromEntries(DISPUTE_STATUSES.map((s) => [s, all.filter((d) => d.status === s).length]));
    const byCategory = Object.fromEntries(DISPUTE_CATEGORIES.map((c) => [c, all.filter((d) => d.category === c).length]));
    const decided = all.filter((d) => d.outcome && d.resolvedAt);
    const hours = decided.map((d) => (d.resolvedAt!.getTime() - d.createdAt.getTime()) / 3_600_000);
    const onTime = decided.filter((d) => !d.dueAt || d.resolvedAt! <= d.dueAt).length;

    const [rem] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number), attempts: sql<number>`coalesce(sum(${remedies.affectedAttempts}), 0)`.mapWith(Number) })
      .from(remedies)
      .where(eq(remedies.examId, examId));

    // Hot spots: several candidates disputing one question usually means the question, not the grading.
    const hot = await db
      .select({
        questionId: attemptItems.questionId,
        total: sql<number>`count(*)`.mapWith(Number),
        active: sql<number>`count(*) filter (where ${disputes.status} in ('open','under_review','needs_info'))`.mapWith(Number),
        questionProblem: sql<number>`count(*) filter (where ${disputes.category} = 'ambiguous_question')`.mapWith(Number),
      })
      .from(disputes)
      .innerJoin(attemptItems, eq(attemptItems.id, disputes.attemptItemId))
      .where(eq(disputes.examId, examId))
      .groupBy(attemptItems.questionId)
      .orderBy(desc(sql`count(*)`))
      .limit(5);
    const labels = await questionLabels(db, examId);

    const check = await verifyLedger(db);
    const examLedger = await ledgerForExam(db, examId);
    const recent = examLedger.slice(-25).reverse();
    const attemptIds = [...new Set(recent.map((r) => r.attemptId).filter((x): x is string => !!x))];
    const people = attemptIds.length
      ? await db.select({ attemptId: attempts.id, name: users.name }).from(attempts).innerJoin(users, eq(users.id, attempts.userId)).where(inArray(attempts.id, attemptIds))
      : [];
    const who = await candidateLabels(db, exam, people);
    const actors = await userNames(db, recent.map((r) => r.actorId));
    const answerIds = [...new Set(recent.map((r) => r.answerId).filter((x): x is string => !!x))];
    const answerQuestion = answerIds.length
      ? await db.select({ id: answers.id, questionId: attemptItems.questionId }).from(answers).innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId)).where(inArray(answers.id, answerIds))
      : [];
    const questionOf = new Map(answerQuestion.map((a) => [a.id, a.questionId]));
    const last = examLedger.at(-1);

    return {
      exam: { id: exam.id, title: exam.title, code: exam.code, resultsStatus: exam.resultsStatus },
      canApplyRemedies: await hasExaminerAccess(db, auth, examId),
      counts: {
        total: all.length,
        active: all.filter((d) => active(d.status)).length,
        overdue: all.filter((d) => active(d.status) && d.dueAt && d.dueAt.getTime() < now).length,
        appeals: all.filter((d) => d.appealOf).length,
        byStatus,
        byCategory,
        outcomes: {
          upheld: all.filter((d) => d.outcome === 'upheld').length,
          partially_upheld: all.filter((d) => d.outcome === 'partially_upheld').length,
          rejected: all.filter((d) => d.outcome === 'rejected').length,
        },
      },
      labels: { status: STATUS_LABEL, category: CATEGORY_LABEL },
      timeliness: {
        avgResolutionHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
        onTimePercent: decided.length ? Math.round((onTime / decided.length) * 100) : null,
      },
      remedies: { count: rem?.count ?? 0, affectedAttempts: rem?.attempts ?? 0 },
      hotQuestions: hot.map((h) => ({ questionId: h.questionId, label: labels.get(h.questionId)?.label ?? 'Q', title: labels.get(h.questionId)?.title ?? 'Question', total: h.total, active: h.active, questionProblem: h.questionProblem })),
      ledger: {
        intact: check.ok,
        checked: check.checked,
        brokenAtSeq: check.brokenAtSeq,
        verifiedAt: new Date(),
        examEntries: examLedger.length,
        head: last ? { seq: last.seq, hash: short(last.hash), at: last.createdAt } : null,
      },
      recentLedger: recent.map((r) => {
        const qid = r.answerId ? questionOf.get(r.answerId) : undefined;
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          seq: r.seq,
          at: r.createdAt,
          action: r.action,
          label: ACTION_LABEL[r.action],
          candidate: r.attemptId ? (who.get(r.attemptId)?.label ?? 'Candidate') : null,
          question: qid ? (labels.get(qid)?.label ?? null) : null,
          part: typeof m.part === 'string' ? m.part : null,
          previous: r.previousScore,
          next: r.newScore,
          reason: r.reason,
          actor: r.action === 'auto_grade' ? 'Automatic marking' : r.actorId ? (actors.get(r.actorId) ?? 'Staff') : 'System',
          hash: short(r.hash),
          prevHash: short(r.prevHash),
        };
      }),
    };
  }
}
