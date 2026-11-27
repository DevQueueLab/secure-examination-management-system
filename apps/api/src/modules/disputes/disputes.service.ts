import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  DISPUTE_CATEGORIES,
  QUESTION_TYPE_META,
  isAutoGraded,
  type DisputeCategory,
  type DisputeOutcome,
  type DisputeStatus,
} from '@athena/shared';
import type { Container } from '../../container';
import type { Executor } from '../../db/client';
import { answers, attemptItems, attempts, auditLogs, disputeMessages, disputes, examStaff, exams, gradeLedger, questions, remedies, rubricItems, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { recomputeAttempt } from '../../domain/grading/attempt-score';
import { appendLedger } from '../../domain/ledger/ledger';
import { round3 } from '../../domain/rng';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import { loadExamForStaff } from '../exams/exam-access';
import { GRADING_ROLES, humanParts, settingsOf } from '../grading/exam-structure';
import { resolvePartScore } from '../grading/rubric-score';
import { notify } from '../notifications/notify';
import { supersedeReportsForAttempts } from '../reports/report-status';
import {
  ACTIVE_STATUSES,
  MAX_DISPUTES_PER_ATTEMPT,
  appealWindow,
  conflictOfInterest,
  disputeWindow,
  dueAtFor,
  isActiveStatus,
  isOverdue,
  needsItem,
} from './dispute.policy';
import { candidateLabels, examinerIds, hasExaminerAccess, questionLabels, reviewersFor, roleLabels, short, userNames } from './dispute.support';
import { CATEGORY_LABEL, OUTCOME_LABEL, REMEDY_LABEL, STATUS_LABEL, candidateEvidence, staffEvidence, type Visibility } from './dispute.views';
import { freezeEvidence, graderIdsOf, partsOf, sealEvidence, verifyEvidenceSeal, type FrozenEvidence } from './evidence';

type DisputeRow = typeof disputes.$inferSelect;
type ExamRow = typeof exams.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;

export interface RaiseInput {
  attemptId: string;
  attemptItemId?: string | null;
  category: DisputeCategory;
  description: string;
}

export interface RegradeInput {
  part: 'answer' | 'working';
  /** Explicit part score, validated against the part's maximum. */
  score?: number;
  /** Rubric items for the part; omitted keeps the ones already applied. */
  rubricItemIds?: string[];
  adjustment?: number;
}

export interface ResolveInput {
  outcome: DisputeOutcome;
  note: string;
  regrade?: RegradeInput | null;
}

export interface InboxFilters {
  examId?: string;
  status?: DisputeStatus | 'active' | 'all';
  category?: DisputeCategory;
  assignedToMe?: boolean;
  overdue?: boolean;
}

const visibilityOf = (exam: ExamRow): Visibility => {
  const s = settingsOf(exam);
  return { published: exam.resultsStatus === 'published', showCorrectAnswers: s.results.showCorrectAnswers, showFeedback: s.results.showFeedback };
};

const evidenceOf = (d: Pick<DisputeRow, 'evidence'>) => d.evidence as unknown as FrozenEvidence;

/**
 * Trust & dispute resolution. A candidate's dispute freezes the evidence, gets a deadline and goes to someone who
 * did not grade the answer; every decision carries a written reason and lands on the hash-chained ledger.
 */
export class DisputesService {
  constructor(private readonly c: Container) {}

  // ------------------------------------------------------------------ shared

  private windowFor(exam: ExamRow, attempt: AttemptRow, category: DisputeCategory, now = new Date()) {
    const s = settingsOf(exam);
    return disputeWindow({
      category,
      allowDisputes: s.results.allowDisputes,
      windowDays: s.results.disputeWindowDays,
      resultsPublished: exam.resultsStatus === 'published',
      resultsPublishedAt: exam.resultsPublishedAt,
      attemptStatus: attempt.status,
      submittedAt: attempt.submittedAt,
      now,
    });
  }

  private async ownAttempt(db: Executor, auth: TenantAuthContext, attemptId: string) {
    const [row] = await db
      .select({ attempt: attempts, exam: exams })
      .from(attempts)
      .innerJoin(exams, eq(exams.id, attempts.examId))
      .where(and(eq(attempts.id, attemptId), eq(attempts.organizationId, auth.organization.id), eq(attempts.userId, auth.user.id), realAttempts))
      .limit(1);
    if (!row) throw new NotFoundError('Attempt');
    return row;
  }

  /** The dispute, scoped to the tenant. Candidates only ever see their own (others are "not found"). */
  private async loadDispute(db: Executor, auth: TenantAuthContext, id: string, lock = false): Promise<DisputeRow> {
    const query = db.select().from(disputes).where(and(eq(disputes.id, id), eq(disputes.organizationId, auth.organization.id)));
    const [d] = lock ? await query.for('update') : await query;
    if (!d) throw new NotFoundError('Dispute');
    return d;
  }

  /** Staff access: the disputes.resolve permission plus grading access to the exam. */
  private async staffExam(db: Executor, auth: TenantAuthContext, d: DisputeRow): Promise<ExamRow> {
    if (!auth.permissions.has('disputes.resolve')) throw new NotFoundError('Dispute');
    return loadExamForStaff(db, auth, d.examId, GRADING_ROLES);
  }

  /** Everyone who may not decide this dispute, with the original decision-maker for appeals. */
  private async conflictParties(db: Executor, d: DisputeRow) {
    const original = d.appealOf ? (await db.select().from(disputes).where(eq(disputes.id, d.appealOf)))[0] : undefined;
    const [answer] = d.answerId ? await db.select({ gradedBy: answers.gradedBy }).from(answers).where(eq(answers.id, d.answerId)) : [];
    const graderIds = [...new Set([...graderIdsOf(d.evidence), ...(original ? graderIdsOf(original.evidence) : []), answer?.gradedBy].filter((x): x is string => !!x))];
    return { graderIds, originalResolverId: original?.resolvedBy ?? null, original };
  }

  private disputeLink = (id: string, forCandidate: boolean) => (forCandidate ? `/my-disputes/${id}` : `/disputes/${id}`);

  // ------------------------------------------------------------------ candidate

  /** Everything the raise flow needs: which categories are open now, the paper's questions and the limits. */
  async context(auth: TenantAuthContext, attemptId: string) {
    const { attempt, exam } = await this.ownAttempt(this.c.db, auth, attemptId);
    const settings = settingsOf(exam);
    const published = exam.resultsStatus === 'published';
    const now = new Date();
    const windows = Object.fromEntries(
      DISPUTE_CATEGORIES.map((cat) => {
        const w = this.windowFor(exam, attempt, cat, now);
        return [cat, w.ok ? { allowed: true, closesAt: w.closesAt, message: null } : { allowed: false, closesAt: w.closesAt, message: w.message }];
      }),
    ) as Record<DisputeCategory, { allowed: boolean; closesAt: Date | null; message: string | null }>;

    const rows = await this.c.db
      .select({ item: attemptItems, answer: answers, title: questions.title })
      .from(attemptItems)
      .innerJoin(questions, eq(questions.id, attemptItems.questionId))
      .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
      .where(eq(attemptItems.attemptId, attempt.id))
      .orderBy(asc(attemptItems.position));
    const mine = await this.c.db
      .select({ id: disputes.id, status: disputes.status, attemptItemId: disputes.attemptItemId, appealOf: disputes.appealOf })
      .from(disputes)
      .where(eq(disputes.attemptId, attempt.id));
    const attemptLevel = mine.find((d) => d.attemptItemId === null && isActiveStatus(d.status));

    return {
      attempt: {
        id: attempt.id,
        status: attempt.status,
        submittedAt: attempt.submittedAt,
        score: published ? attempt.score : null,
        maxScore: published ? attempt.maxScore : null,
      },
      exam: { id: exam.id, title: exam.title, code: exam.code, published, allowDisputes: settings.results.allowDisputes, windowDays: settings.results.disputeWindowDays },
      windows,
      limits: { used: mine.filter((d) => !d.appealOf).length, max: MAX_DISPUTES_PER_ATTEMPT },
      attemptLevelOpen: attemptLevel ? { id: attemptLevel.id, status: attemptLevel.status } : null,
      items: rows.map((r, i) => {
        const open = mine.find((d) => d.attemptItemId === r.item.id && isActiveStatus(d.status));
        const voided = r.item.voidReason !== null;
        return {
          id: r.item.id,
          number: i + 1,
          title: r.title,
          type: r.item.type,
          typeLabel: QUESTION_TYPE_META[r.item.type].label,
          stem: typeof r.item.content.stem === 'string' ? r.item.content.stem : '',
          max: voided ? 0 : round3(r.item.marks + r.item.workingMarks),
          score: published && !voided ? (r.answer?.score ?? null) : null,
          voided,
          voidReason: r.item.voidReason,
          openDispute: open ? { id: open.id, status: open.status } : null,
        };
      }),
    };
  }

  /** What will be frozen if the candidate submits now, rendered exactly as they will see it afterwards. */
  async preview(auth: TenantAuthContext, attemptId: string, itemId: string | null, category: DisputeCategory) {
    const { attempt, exam } = await this.ownAttempt(this.c.db, auth, attemptId);
    let item: typeof attemptItems.$inferSelect | null = null;
    let answer: typeof answers.$inferSelect | null = null;
    if (itemId) {
      const [found] = await this.c.db.select().from(attemptItems).where(and(eq(attemptItems.id, itemId), eq(attemptItems.attemptId, attempt.id)));
      if (!found) throw new NotFoundError('Question');
      item = found;
      const [a] = await this.c.db.select().from(answers).where(eq(answers.attemptItemId, found.id));
      answer = a ?? null;
    }
    const evidence = await freezeEvidence(this.c.db, { disputeId: 'preview', category, exam, attempt, item, answer });
    return { evidence: candidateEvidence(evidence, visibilityOf(exam), true) };
  }

  async raise(auth: TenantAuthContext, input: RaiseInput) {
    const out = await this.c.db.transaction(async (tx) => {
      // Locking the attempt serialises raises for it, so the one-open-per-question and 5-per-attempt rules hold under races.
      const [attempt] = await tx
        .select()
        .from(attempts)
        .where(and(eq(attempts.id, input.attemptId), eq(attempts.organizationId, auth.organization.id), eq(attempts.userId, auth.user.id), realAttempts))
        .for('update');
      if (!attempt) throw new NotFoundError('Attempt');
      const [exam] = await tx.select().from(exams).where(eq(exams.id, attempt.examId));
      if (!exam) throw new NotFoundError('Attempt');

      const window = this.windowFor(exam, attempt, input.category);
      if (!window.ok) throw new ConflictError(window.message, window.code);

      let item: typeof attemptItems.$inferSelect | null = null;
      let answer: typeof answers.$inferSelect | null = null;
      if (input.attemptItemId) {
        const [found] = await tx.select().from(attemptItems).where(and(eq(attemptItems.id, input.attemptItemId), eq(attemptItems.attemptId, attempt.id)));
        if (!found) throw new ValidationError('That question is not on your paper', { attemptItemId: 'Choose a question from your paper' });
        if (found.voidReason) {
          throw new ValidationError('This question was dropped for everyone', { attemptItemId: 'This question no longer counts toward anyone’s score' });
        }
        item = found;
        const [a] = await tx.select().from(answers).where(eq(answers.attemptItemId, found.id));
        answer = a ?? null;
      } else if (needsItem(input.category)) {
        throw new ValidationError('Choose the question this is about', { attemptItemId: 'Grading and question disputes are about one question' });
      }

      const existing = await tx
        .select({ id: disputes.id, status: disputes.status, attemptItemId: disputes.attemptItemId, appealOf: disputes.appealOf })
        .from(disputes)
        .where(eq(disputes.attemptId, attempt.id));
      const clash = existing.find((d) => isActiveStatus(d.status) && (d.attemptItemId ?? null) === (item?.id ?? null));
      if (clash) {
        throw new ConflictError(
          item
            ? 'You already have an open dispute about this question. Add to that conversation instead.'
            : 'You already have an open dispute about this attempt. Add to that conversation instead.',
          'DISPUTE_ALREADY_OPEN',
        );
      }
      if (existing.filter((d) => !d.appealOf).length >= MAX_DISPUTES_PER_ATTEMPT) {
        throw new ConflictError(`You can raise up to ${MAX_DISPUTES_PER_ATTEMPT} disputes per exam attempt.`, 'DISPUTE_LIMIT');
      }

      const id = randomUUID();
      const now = new Date();
      const evidence = await freezeEvidence(tx, { disputeId: id, category: input.category, exam, attempt, item, answer, now });
      const [row] = await tx
        .insert(disputes)
        .values({
          id,
          organizationId: exam.organizationId,
          examId: exam.id,
          attemptId: attempt.id,
          attemptItemId: item?.id ?? null,
          answerId: answer?.id ?? null,
          raisedBy: auth.user.id,
          category: input.category,
          description: input.description,
          evidence: evidence as unknown as Record<string, unknown>,
          status: 'open',
          dueAt: dueAtFor(now, false),
          createdAt: now,
        })
        .returning();

      const label = item ? `Question ${evidence.item?.number}` : 'the attempt';
      for (const userId of await examinerIds(tx, exam.id)) {
        await notify(
          tx,
          {
            userId,
            organizationId: exam.organizationId,
            kind: 'dispute.raised',
            title: `New dispute: ${exam.title}`,
            body: `${CATEGORY_LABEL[input.category]} about ${label}. Decide by ${row!.dueAt!.toISOString().slice(0, 10)}.`,
            link: this.disputeLink(id, false),
          },
          this.c.realtime,
        );
      }
      return { row: row!, exam };
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'dispute.raised',
      entityType: 'dispute',
      entityId: out.row.id,
      summary: `Raised a ${CATEGORY_LABEL[out.row.category].toLowerCase()} dispute on ${out.exam.title}`,
      metadata: { examId: out.exam.id, attemptId: out.row.attemptId, attemptItemId: out.row.attemptItemId },
    });
    return this.get(auth, out.row.id);
  }

  /** The candidate's disputes and the attempts they can still raise one on. */
  async mine(auth: TenantAuthContext) {
    const rows = await this.c.db
      .select({
        id: disputes.id,
        examId: disputes.examId,
        attemptId: disputes.attemptId,
        category: disputes.category,
        status: disputes.status,
        outcome: disputes.outcome,
        appealOf: disputes.appealOf,
        dueAt: disputes.dueAt,
        createdAt: disputes.createdAt,
        updatedAt: disputes.updatedAt,
        resolvedAt: disputes.resolvedAt,
        scoreBefore: disputes.scoreBefore,
        scoreAfter: disputes.scoreAfter,
        description: disputes.description,
        itemNumber: sql<number | null>`(${disputes.evidence}->'item'->>'number')::int`,
        itemTitle: sql<string | null>`${disputes.evidence}->'item'->>'title'`,
        examTitle: exams.title,
        examCode: exams.code,
        resultsStatus: exams.resultsStatus,
        maxScore: attempts.maxScore,
      })
      .from(disputes)
      .innerJoin(exams, eq(exams.id, disputes.examId))
      .innerJoin(attempts, eq(attempts.id, disputes.attemptId))
      .where(and(eq(disputes.organizationId, auth.organization.id), eq(disputes.raisedBy, auth.user.id)))
      .orderBy(desc(disputes.createdAt));
    const now = new Date();

    const own = await this.c.db
      .select({ attempt: attempts, exam: exams })
      .from(attempts)
      .innerJoin(exams, eq(exams.id, attempts.examId))
      .where(and(eq(attempts.organizationId, auth.organization.id), eq(attempts.userId, auth.user.id), realAttempts, eq(attempts.status, 'submitted')))
      .orderBy(desc(attempts.submittedAt));

    return {
      items: rows.map((r) => {
        const published = r.resultsStatus === 'published';
        return {
          id: r.id,
          exam: { id: r.examId, title: r.examTitle, code: r.examCode },
          attemptId: r.attemptId,
          item: r.itemNumber ? { number: r.itemNumber, title: r.itemTitle } : null,
          category: r.category,
          categoryLabel: CATEGORY_LABEL[r.category],
          status: r.status,
          statusLabel: r.status === 'closed' && !r.outcome ? 'Withdrawn' : STATUS_LABEL[r.status],
          outcome: r.outcome,
          outcomeLabel: r.outcome ? OUTCOME_LABEL[r.outcome] : null,
          withdrawn: r.status === 'closed' && !r.outcome,
          isAppeal: !!r.appealOf,
          dueAt: r.dueAt,
          overdue: isOverdue(r.status, r.dueAt, now),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          resolvedAt: r.resolvedAt,
          scoreBefore: published ? r.scoreBefore : null,
          scoreAfter: published ? r.scoreAfter : null,
          maxScore: published ? r.maxScore : null,
          excerpt: r.description.slice(0, 160),
        };
      }),
      attempts: own.map(({ attempt, exam }) => {
        const windows = DISPUTE_CATEGORIES.map((cat) => this.windowFor(exam, attempt, cat, now));
        const closes = windows.flatMap((w) => (w.ok ? [w.closesAt.getTime()] : []));
        const closed = windows.flatMap((w) => (w.ok ? [] : [w]));
        const reason = closed.find((w) => w.code !== 'NOT_PUBLISHED') ?? closed[0];
        return {
          attemptId: attempt.id,
          exam: { id: exam.id, title: exam.title, code: exam.code },
          submittedAt: attempt.submittedAt,
          published: exam.resultsStatus === 'published',
          canRaise: closes.length > 0,
          closesAt: closes.length ? new Date(Math.max(...closes)) : null,
          message: closes.length ? null : (reason?.message ?? null),
        };
      }),
    };
  }

  async get(auth: TenantAuthContext, id: string) {
    const d = await this.loadDispute(this.c.db, auth, id);
    if (d.raisedBy === auth.user.id) return this.candidateView(d);
    await this.staffExam(this.c.db, auth, d);
    return this.staffView(auth, d);
  }

  private base(d: DisputeRow, now = new Date()) {
    return {
      id: d.id,
      examId: d.examId,
      attemptId: d.attemptId,
      attemptItemId: d.attemptItemId,
      category: d.category,
      categoryLabel: CATEGORY_LABEL[d.category],
      status: d.status,
      statusLabel: d.status === 'closed' && !d.outcome ? 'Withdrawn' : STATUS_LABEL[d.status],
      outcome: d.outcome,
      outcomeLabel: d.outcome ? OUTCOME_LABEL[d.outcome] : null,
      withdrawn: d.status === 'closed' && !d.outcome,
      description: d.description,
      isAppeal: !!d.appealOf,
      appealOf: d.appealOf,
      dueAt: d.dueAt,
      overdue: isOverdue(d.status, d.dueAt, now),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      resolvedAt: d.resolvedAt,
    };
  }

  /** The decision as recorded on the ledger (single source of truth for before/after). */
  private async decision(db: Executor, d: DisputeRow) {
    if (!d.outcome) return null;
    const [entry] = await db
      .select()
      .from(gradeLedger)
      .where(and(eq(gradeLedger.attemptId, d.attemptId), eq(gradeLedger.action, 'dispute_resolution'), sql`${gradeLedger.metadata}->>'disputeId' = ${d.id}`))
      .orderBy(desc(gradeLedger.seq))
      .limit(1);
    if (entry) {
      const m = entry.metadata as Record<string, unknown>;
      return {
        byRemedy: null,
        ledger: { seq: entry.seq, hash: short(entry.hash), at: entry.createdAt },
        part: (m.part as 'answer' | 'working' | null) ?? null,
        partBefore: m.part ? entry.previousScore : null,
        partAfter: m.part ? entry.newScore : null,
        partMax: (m.partMax as number | null) ?? null,
        itemBefore: (m.itemScoreBefore as number | null) ?? null,
        itemAfter: (m.itemScoreAfter as number | null) ?? null,
      };
    }
    const [remedyEntry] = await db
      .select()
      .from(gradeLedger)
      .where(and(eq(gradeLedger.attemptId, d.attemptId), eq(gradeLedger.action, 'remedy'), sql`${gradeLedger.metadata}->'disputeIds' @> ${JSON.stringify([d.id])}::jsonb`))
      .orderBy(desc(gradeLedger.seq))
      .limit(1);
    if (!remedyEntry) {
      // Fixed by a remedy that did not change this attempt (the candidate already had the marks).
      const [remedy] = await db
        .select()
        .from(remedies)
        .where(and(eq(remedies.examId, d.examId), sql`${remedies.payload}->'disputeIds' @> ${JSON.stringify([d.id])}::jsonb`))
        .limit(1);
      if (!remedy) return null;
      return {
        byRemedy: { id: remedy.id, type: remedy.type, label: REMEDY_LABEL[remedy.type], summary: (remedy.payload as { summary?: string }).summary ?? null },
        ledger: null,
        part: null,
        partBefore: null,
        partAfter: null,
        partMax: null,
        itemBefore: null,
        itemAfter: null,
      };
    }
    const m = remedyEntry.metadata as Record<string, unknown>;
    const [remedy] = m.remedyId ? await db.select().from(remedies).where(eq(remedies.id, String(m.remedyId))) : [];
    return {
      byRemedy: remedy
        ? { id: remedy.id, type: remedy.type, label: REMEDY_LABEL[remedy.type], summary: (remedy.payload as { summary?: string }).summary ?? null }
        : null,
      ledger: { seq: remedyEntry.seq, hash: short(remedyEntry.hash), at: remedyEntry.createdAt },
      part: (m.part as 'answer' | 'working' | null) ?? null,
      partBefore: remedyEntry.previousScore,
      partAfter: remedyEntry.newScore,
      partMax: (m.partMax as number | null) ?? null,
      itemBefore: (m.itemScoreBefore as number | null) ?? null,
      itemAfter: (m.itemScoreAfter as number | null) ?? null,
    };
  }

  /** Progress for the stepper, from the audit trail. */
  private async steps(db: Executor, d: DisputeRow) {
    const events = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata, at: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'dispute'), eq(auditLogs.entityId, d.id)))
      .orderBy(asc(auditLogs.createdAt));
    const reviewStart = events.find(
      (e) => e.action === 'dispute.assigned' || (e.action === 'dispute.status' && (e.metadata as { to?: string }).to) || e.action === 'dispute.staff_message',
    );
    const decided = d.outcome !== null;
    const withdrawn = d.status === 'closed' && !decided;
    const reviewing = d.status !== 'open' || !!reviewStart;
    return [
      { key: 'submitted', label: d.appealOf ? 'Appeal submitted' : 'Submitted', at: d.createdAt, state: 'done' as const },
      {
        key: 'review',
        label: d.status === 'needs_info' ? 'Waiting for your reply' : 'Under review',
        at: reviewStart?.at ?? null,
        state: decided || withdrawn ? ('done' as const) : reviewing ? ('current' as const) : ('upcoming' as const),
      },
      {
        key: 'resolved',
        label: withdrawn ? 'Withdrawn' : 'Resolved',
        at: withdrawn ? d.updatedAt : d.resolvedAt,
        state: decided || withdrawn ? ('done' as const) : ('upcoming' as const),
      },
    ];
  }

  private async candidateView(d: DisputeRow) {
    const db = this.c.db;
    const [exam] = await db.select().from(exams).where(eq(exams.id, d.examId));
    const [attempt] = await db.select({ maxScore: attempts.maxScore, score: attempts.score }).from(attempts).where(eq(attempts.id, d.attemptId));
    const vis = visibilityOf(exam!);
    const msgs = await db
      .select({ id: disputeMessages.id, body: disputeMessages.body, authorId: disputeMessages.authorId, createdAt: disputeMessages.createdAt })
      .from(disputeMessages)
      .where(and(eq(disputeMessages.disputeId, d.id), eq(disputeMessages.internal, 0)))
      .orderBy(asc(disputeMessages.createdAt));
    const roles = await roleLabels(db, exam!, [...msgs.map((m) => m.authorId), d.resolvedBy]);
    const [appealRow] = await db.select({ id: disputes.id, status: disputes.status }).from(disputes).where(eq(disputes.appealOf, d.id)).limit(1);
    const [original] = d.appealOf
      ? await db
          .select({ id: disputes.id, outcome: disputes.outcome, resolutionNote: disputes.resolutionNote, resolvedAt: disputes.resolvedAt })
          .from(disputes)
          .where(eq(disputes.id, d.appealOf))
      : [];
    const appeal = appealWindow({ status: d.status, appealOf: d.appealOf, resolvedAt: d.resolvedAt, hasAppeal: !!appealRow }, new Date());
    const decision = await this.decision(db, d);

    return {
      role: 'candidate' as const,
      dispute: this.base(d),
      exam: { id: exam!.id, title: exam!.title, code: exam!.code, published: vis.published },
      evidence: candidateEvidence(evidenceOf(d), vis, verifyEvidenceSeal(d.id, d.evidence)),
      messages: msgs.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        internal: false,
        mine: m.authorId === d.raisedBy,
        author: m.authorId === d.raisedBy ? 'You' : (roles.get(m.authorId) ?? 'Exam team'),
      })),
      resolution: d.outcome
        ? {
            outcome: d.outcome,
            outcomeLabel: OUTCOME_LABEL[d.outcome],
            note: d.resolutionNote,
            resolvedAt: d.resolvedAt,
            resolverRole: d.resolvedBy ? (roles.get(d.resolvedBy) ?? 'Exam team') : null,
            scoreBefore: vis.published ? d.scoreBefore : null,
            scoreAfter: vis.published ? d.scoreAfter : null,
            maxScore: vis.published ? (attempt?.maxScore ?? null) : null,
            change: vis.published && decision ? { ...decision } : decision ? { ...decision, partBefore: null, partAfter: null, itemBefore: null, itemAfter: null } : null,
          }
        : null,
      appeal: {
        allowed: appeal.ok,
        closesAt: appeal.closesAt,
        message: appeal.ok ? null : appeal.message,
        appealId: appealRow?.id ?? null,
        appealStatus: appealRow?.status ?? null,
      },
      original: original
        ? { id: original.id, outcome: original.outcome, outcomeLabel: original.outcome ? OUTCOME_LABEL[original.outcome] : null, note: original.resolutionNote, resolvedAt: original.resolvedAt }
        : null,
      steps: await this.steps(db, d),
      can: { message: isActiveStatus(d.status), withdraw: isActiveStatus(d.status), appeal: appeal.ok },
    };
  }

  private async staffView(auth: TenantAuthContext, d: DisputeRow) {
    const db = this.c.db;
    const [exam] = await db.select().from(exams).where(eq(exams.id, d.examId));
    const [attempt] = await db.select().from(attempts).where(eq(attempts.id, d.attemptId));
    const [raiser] = await db.select({ name: users.name }).from(users).where(eq(users.id, d.raisedBy));
    const evidence = evidenceOf(d);
    const parties = await this.conflictParties(db, d);
    const conflict = conflictOfInterest(auth.user.id, parties);

    const msgs = await db
      .select({ id: disputeMessages.id, body: disputeMessages.body, authorId: disputeMessages.authorId, internal: disputeMessages.internal, createdAt: disputeMessages.createdAt })
      .from(disputeMessages)
      .where(eq(disputeMessages.disputeId, d.id))
      .orderBy(asc(disputeMessages.createdAt));
    const names = await userNames(db, [...msgs.map((m) => m.authorId), d.assignedTo, d.resolvedBy, ...parties.graderIds, parties.originalResolverId]);
    const identity = (await candidateLabels(db, exam!, [{ attemptId: d.attemptId, name: raiser?.name ?? 'Candidate' }])).get(d.attemptId)!;
    const labels = await questionLabels(db, d.examId);

    // Live state, for the regrade editor and its running total.
    const [item] = d.attemptItemId ? await db.select().from(attemptItems).where(eq(attemptItems.id, d.attemptItemId)) : [];
    const [answer] = item ? await db.select().from(answers).where(eq(answers.attemptItemId, item.id)) : [];
    const rubric = item
      ? await db
          .select({ id: rubricItems.id, label: rubricItems.label, description: rubricItems.description, points: rubricItems.points, target: rubricItems.target })
          .from(rubricItems)
          .where(and(eq(rubricItems.examId, d.examId), eq(rubricItems.questionId, item.questionId)))
          .orderBy(asc(rubricItems.target), asc(rubricItems.position), asc(rubricItems.createdAt))
      : [];
    const related = item
      ? await db
          .select({ id: disputes.id, status: disputes.status })
          .from(disputes)
          .innerJoin(attemptItems, eq(attemptItems.id, disputes.attemptItemId))
          .where(and(eq(disputes.examId, d.examId), eq(attemptItems.questionId, item.questionId), sql`${disputes.id} <> ${d.id}`))
      : [];
    const [appealRow] = await db.select({ id: disputes.id, status: disputes.status }).from(disputes).where(eq(disputes.appealOf, d.id)).limit(1);
    const reviewers = await reviewersFor(db, exam!);
    const decision = await this.decision(db, d);
    const qLabel = item ? labels.get(item.questionId) : undefined;
    const parts = item ? partsOf(item, answer) : null;

    return {
      role: 'staff' as const,
      dispute: this.base(d),
      exam: { id: exam!.id, title: exam!.title, code: exam!.code, published: exam!.resultsStatus === 'published' },
      candidate: { label: identity.label, anonymous: identity.anonymous, attemptId: d.attemptId },
      question: item
        ? { questionId: item.questionId, label: qLabel?.label ?? `Q${item.position + 1}`, title: qLabel?.title ?? evidence.item?.title ?? 'Question', paperNumber: evidence.item?.number ?? null }
        : null,
      evidence: staffEvidence(
        evidence,
        verifyEvidenceSeal(d.id, d.evidence),
        graderIdsOf(d.evidence).map((g) => ({ id: g, name: names.get(g) ?? 'Unknown' })),
      ),
      messages: msgs.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        internal: m.internal === 1,
        mine: m.authorId === auth.user.id,
        fromCandidate: m.authorId === d.raisedBy,
        author: m.authorId === d.raisedBy ? identity.label : (names.get(m.authorId) ?? 'Staff'),
      })),
      assignee: d.assignedTo ? { id: d.assignedTo, name: names.get(d.assignedTo) ?? 'Staff' } : null,
      reviewers: reviewers.map((r) => ({ ...r, conflict: conflictOfInterest(r.id, parties) })),
      conflict: conflict ? { reason: conflict, graders: parties.graderIds.map((g) => names.get(g) ?? 'Unknown') } : null,
      original: parties.original
        ? {
            id: parties.original.id,
            outcome: parties.original.outcome,
            outcomeLabel: parties.original.outcome ? OUTCOME_LABEL[parties.original.outcome] : null,
            note: parties.original.resolutionNote,
            resolvedAt: parties.original.resolvedAt,
            resolvedBy: parties.originalResolverId ? (names.get(parties.originalResolverId) ?? 'Staff') : null,
          }
        : null,
      appeal: appealRow ? { id: appealRow.id, status: appealRow.status } : null,
      resolution: d.outcome
        ? {
            outcome: d.outcome,
            outcomeLabel: OUTCOME_LABEL[d.outcome],
            note: d.resolutionNote,
            resolvedAt: d.resolvedAt,
            resolvedBy: d.resolvedBy ? (names.get(d.resolvedBy) ?? 'Staff') : null,
            scoreBefore: d.scoreBefore,
            scoreAfter: d.scoreAfter,
            maxScore: attempt?.maxScore ?? null,
            change: decision,
          }
        : null,
      live: {
        attempt: { score: attempt?.score ?? null, maxScore: attempt?.maxScore ?? 0, gradingStatus: attempt?.gradingStatus ?? 'pending' },
        item: item
          ? {
              type: item.type,
              autoGraded: isAutoGraded(item.type),
              voided: item.voidReason !== null,
              score: answer?.score ?? null,
              max: round3(item.marks + item.workingMarks),
              humanParts: humanParts(item.type, item.workingMarks),
              parts: {
                answer: { ...parts!.answer, adjustment: isAutoGraded(item.type) ? 0 : (answer?.manualAdjustment ?? 0), rubricItemIds: (answer?.rubricItemIds ?? []).filter((rid) => rubric.find((r) => r.id === rid)?.target === 'answer') },
                working: parts!.working
                  ? { ...parts!.working, adjustment: answer?.workingAdjustment ?? 0, rubricItemIds: (answer?.rubricItemIds ?? []).filter((rid) => rubric.find((r) => r.id === rid)?.target === 'working') }
                  : null,
              },
            }
          : null,
        rubric,
      },
      signals: {
        sameQuestionActive: related.filter((r) => isActiveStatus(r.status)).length,
        sameQuestionTotal: related.length,
      },
      steps: await this.steps(db, d),
      can: {
        resolve: isActiveStatus(d.status) && !conflict,
        assign: isActiveStatus(d.status),
        setStatus: isActiveStatus(d.status) && !conflict,
        message: true,
        applyRemedy: !!item && (await hasExaminerAccess(db, auth, d.examId)),
      },
    };
  }

  async addMessage(auth: TenantAuthContext, id: string, input: { body: string; internal?: boolean }) {
    const d = await this.loadDispute(this.c.db, auth, id);
    const fromCandidate = d.raisedBy === auth.user.id;
    if (fromCandidate) {
      if (input.internal) throw new ForbiddenError('Only staff can write notes to staff');
      if (!isActiveStatus(d.status)) {
        throw new ConflictError(d.outcome && !d.appealOf ? 'This dispute has a decision. If you disagree, appeal it instead.' : 'This dispute is closed.', 'DISPUTE_CLOSED');
      }
    } else {
      await this.staffExam(this.c.db, auth, d);
    }
    const internal = !fromCandidate && !!input.internal;
    const out = await this.c.db.transaction(async (tx) => {
      const locked = await this.loadDispute(tx, auth, id, true);
      const [msg] = await tx.insert(disputeMessages).values({ disputeId: id, authorId: auth.user.id, body: input.body, internal: internal ? 1 : 0 }).returning();
      const [exam] = await tx.select().from(exams).where(eq(exams.id, locked.examId));
      let statusChanged = false;
      if (fromCandidate) {
        // Answering a request for information hands the dispute back to the reviewer.
        if (locked.status === 'needs_info') {
          await tx.update(disputes).set({ status: 'under_review' }).where(eq(disputes.id, id));
          statusChanged = true;
        }
        const recipients = locked.assignedTo ? [locked.assignedTo] : await examinerIds(tx, locked.examId);
        for (const userId of recipients) {
          await notify(
            tx,
            { userId, organizationId: exam!.organizationId, kind: 'dispute.reply', title: `Candidate replied: ${exam!.title}`, body: input.body.slice(0, 160), link: this.disputeLink(id, false) },
            this.c.realtime,
          );
        }
      } else if (!internal) {
        await notify(
          tx,
          { userId: locked.raisedBy, organizationId: exam!.organizationId, kind: 'dispute.message', title: `New message about your dispute: ${exam!.title}`, body: input.body.slice(0, 160), link: this.disputeLink(id, true) },
          this.c.realtime,
        );
      }
      return { msg: msg!, statusChanged };
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: fromCandidate ? 'dispute.candidate_message' : internal ? 'dispute.internal_note' : 'dispute.staff_message',
      entityType: 'dispute',
      entityId: id,
      summary: fromCandidate ? 'Candidate added a message' : internal ? 'Added a note for staff' : 'Replied to the candidate',
      metadata: out.statusChanged ? { from: 'needs_info', to: 'under_review' } : {},
    });
    return { message: { id: out.msg.id, body: out.msg.body, createdAt: out.msg.createdAt, internal, mine: true } };
  }

  async withdraw(auth: TenantAuthContext, id: string) {
    const out = await this.c.db.transaction(async (tx) => {
      const d = await this.loadDispute(tx, auth, id, true);
      if (d.raisedBy !== auth.user.id) throw new NotFoundError('Dispute');
      if (!isActiveStatus(d.status)) throw new ConflictError('Only an open dispute can be withdrawn', 'DISPUTE_CLOSED');
      await tx.update(disputes).set({ status: 'closed' }).where(eq(disputes.id, id));
      await tx.insert(disputeMessages).values({ disputeId: id, authorId: auth.user.id, body: 'I withdrew this dispute.', internal: 0 });
      // Withdrawing an appeal leaves the original decision standing, and final.
      if (d.appealOf) await tx.update(disputes).set({ status: 'closed' }).where(eq(disputes.id, d.appealOf));
      return d;
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'dispute.withdrawn',
      entityType: 'dispute',
      entityId: id,
      summary: 'Candidate withdrew a dispute',
      metadata: { examId: out.examId },
    });
    return this.get(auth, id);
  }

  async appeal(auth: TenantAuthContext, id: string, input: { reason: string }) {
    const out = await this.c.db.transaction(async (tx) => {
      const d = await this.loadDispute(tx, auth, id, true);
      if (d.raisedBy !== auth.user.id) throw new NotFoundError('Dispute');
      const [existing] = await tx.select({ id: disputes.id }).from(disputes).where(eq(disputes.appealOf, d.id)).limit(1);
      const window = appealWindow({ status: d.status, appealOf: d.appealOf, resolvedAt: d.resolvedAt, hasAppeal: !!existing }, new Date());
      if (!window.ok) throw new ConflictError(window.message, 'APPEAL_NOT_ALLOWED');

      const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, d.attemptId)).for('update');
      const [exam] = await tx.select().from(exams).where(eq(exams.id, d.examId));
      const [item] = d.attemptItemId ? await tx.select().from(attemptItems).where(eq(attemptItems.id, d.attemptItemId)) : [];
      const [answer] = item ? await tx.select().from(answers).where(eq(answers.attemptItemId, item.id)) : [];
      const appealId = randomUUID();
      const now = new Date();
      // The appeal freezes the state after the first decision, and records the decision it challenges.
      const evidence = await freezeEvidence(tx, {
        disputeId: appealId,
        category: d.category,
        exam: exam!,
        attempt: attempt!,
        item: item ?? null,
        answer: answer ?? null,
        now,
        appealOf: { disputeId: d.id, outcome: d.outcome, note: d.resolutionNote, resolvedAt: d.resolvedAt?.toISOString() ?? null, scoreBefore: d.scoreBefore, scoreAfter: d.scoreAfter },
      });
      // Keep the original grader on the appeal's conflict list, then re-seal.
      const { seal: _old, ...unsealed } = evidence;
      unsealed.grading = { ...unsealed.grading, graderIds: [...new Set([...unsealed.grading.graderIds, ...graderIdsOf(d.evidence)])] };
      const sealed = { ...unsealed, seal: sealEvidence(appealId, unsealed) };

      const [row] = await tx
        .insert(disputes)
        .values({
          id: appealId,
          organizationId: d.organizationId,
          examId: d.examId,
          attemptId: d.attemptId,
          attemptItemId: d.attemptItemId,
          answerId: d.answerId,
          raisedBy: auth.user.id,
          category: d.category,
          description: input.reason,
          evidence: sealed as unknown as Record<string, unknown>,
          status: 'open',
          appealOf: d.id,
          dueAt: dueAtFor(now, true),
          createdAt: now,
        })
        .returning();
      await tx.update(disputes).set({ status: 'appealed' }).where(eq(disputes.id, d.id));
      for (const userId of (await examinerIds(tx, d.examId)).filter((u) => u !== d.resolvedBy)) {
        await notify(
          tx,
          {
            userId,
            organizationId: d.organizationId,
            kind: 'dispute.appealed',
            title: `Appeal: ${exam!.title}`,
            body: `A candidate appealed a decision. Someone other than the original reviewer must decide it by ${row!.dueAt!.toISOString().slice(0, 10)}.`,
            link: this.disputeLink(appealId, false),
          },
          this.c.realtime,
        );
      }
      return { row: row!, exam: exam! };
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'dispute.appealed',
      entityType: 'dispute',
      entityId: out.row.id,
      summary: `Appealed a dispute decision on ${out.exam.title}`,
      metadata: { appealOf: id, examId: out.exam.id },
    });
    return this.get(auth, out.row.id);
  }

  // ------------------------------------------------------------------ staff

  async inbox(auth: TenantAuthContext, f: InboxFilters) {
    const db = this.c.db;
    const viewAll = auth.permissions.has('exams.view_all');
    const orig = alias(disputes, 'orig');
    const assignee = alias(users, 'assignee');
    const access = viewAll
      ? undefined
      : inArray(
          disputes.examId,
          db
            .select({ id: examStaff.examId })
            .from(examStaff)
            .where(and(eq(examStaff.userId, auth.user.id), inArray(examStaff.role, [...GRADING_ROLES]))),
        );
    const conds = [eq(disputes.organizationId, auth.organization.id), access];
    if (f.examId) conds.push(eq(disputes.examId, f.examId));
    if (f.status === 'active') conds.push(inArray(disputes.status, [...ACTIVE_STATUSES]));
    else if (f.status && f.status !== 'all') conds.push(eq(disputes.status, f.status));
    if (f.category) conds.push(eq(disputes.category, f.category));
    if (f.assignedToMe) conds.push(eq(disputes.assignedTo, auth.user.id));
    if (f.overdue) conds.push(and(inArray(disputes.status, [...ACTIVE_STATUSES]), sql`${disputes.dueAt} < now()`));

    const rows = await db
      .select({
        d: {
          id: disputes.id,
          examId: disputes.examId,
          attemptId: disputes.attemptId,
          category: disputes.category,
          status: disputes.status,
          outcome: disputes.outcome,
          appealOf: disputes.appealOf,
          assignedTo: disputes.assignedTo,
          dueAt: disputes.dueAt,
          createdAt: disputes.createdAt,
          updatedAt: disputes.updatedAt,
          resolvedAt: disputes.resolvedAt,
          description: disputes.description,
        },
        exam: exams,
        questionId: attemptItems.questionId,
        paperNumber: sql<number | null>`(${disputes.evidence}->'item'->>'number')::int`,
        evidenceTitle: sql<string | null>`${disputes.evidence}->'item'->>'title'`,
        graderIds: sql<unknown>`${disputes.evidence}->'grading'->'graderIds'`,
        raiserName: users.name,
        assigneeName: assignee.name,
        currentGrader: answers.gradedBy,
        originalResolver: orig.resolvedBy,
      })
      .from(disputes)
      .innerJoin(exams, eq(exams.id, disputes.examId))
      .innerJoin(users, eq(users.id, disputes.raisedBy))
      .leftJoin(attemptItems, eq(attemptItems.id, disputes.attemptItemId))
      .leftJoin(answers, eq(answers.id, disputes.answerId))
      .leftJoin(assignee, eq(assignee.id, disputes.assignedTo))
      .leftJoin(orig, eq(orig.id, disputes.appealOf))
      .where(and(...conds))
      .orderBy(sql`case when ${disputes.status} in ('open','under_review','needs_info') then 0 else 1 end`, asc(disputes.dueAt), desc(disputes.createdAt))
      .limit(500);

    const examById = new Map(rows.map((r) => [r.exam.id, r.exam]));
    const labelsByExam = new Map<string, Awaited<ReturnType<typeof questionLabels>>>();
    const peopleByExam = new Map<string, Awaited<ReturnType<typeof candidateLabels>>>();
    for (const exam of examById.values()) {
      labelsByExam.set(exam.id, await questionLabels(db, exam.id));
      peopleByExam.set(exam.id, await candidateLabels(db, exam, rows.filter((r) => r.exam.id === exam.id).map((r) => ({ attemptId: r.d.attemptId, name: r.raiserName }))));
    }
    const now = new Date();
    const items = rows.map((r) => {
      const graders = [...(Array.isArray(r.graderIds) ? (r.graderIds as string[]) : []), r.currentGrader].filter((x): x is string => !!x);
      const conflict = conflictOfInterest(auth.user.id, { graderIds: graders, originalResolverId: r.originalResolver });
      const q = r.questionId ? labelsByExam.get(r.exam.id)?.get(r.questionId) : undefined;
      return {
        id: r.d.id,
        exam: { id: r.exam.id, title: r.exam.title, code: r.exam.code },
        candidate: peopleByExam.get(r.exam.id)?.get(r.d.attemptId) ?? { label: 'Candidate', anonymous: true },
        question: r.questionId ? { questionId: r.questionId, label: q?.label ?? (r.paperNumber ? `#${r.paperNumber}` : 'Q'), title: q?.title ?? r.evidenceTitle ?? 'Question' } : null,
        category: r.d.category,
        categoryLabel: CATEGORY_LABEL[r.d.category],
        status: r.d.status,
        statusLabel: r.d.status === 'closed' && !r.d.outcome ? 'Withdrawn' : STATUS_LABEL[r.d.status],
        outcome: r.d.outcome,
        outcomeLabel: r.d.outcome ? OUTCOME_LABEL[r.d.outcome] : null,
        isAppeal: !!r.d.appealOf,
        assignee: r.d.assignedTo ? { id: r.d.assignedTo, name: r.assigneeName ?? 'Staff', isMe: r.d.assignedTo === auth.user.id } : null,
        dueAt: r.d.dueAt,
        overdue: isOverdue(r.d.status, r.d.dueAt, now),
        createdAt: r.d.createdAt,
        resolvedAt: r.d.resolvedAt,
        conflict: !!conflict,
        excerpt: r.d.description.slice(0, 140),
      };
    });

    // Filter options: every accessible exam that has disputes.
    const examRows = await db
      .select({ id: exams.id, title: exams.title, code: exams.code, total: sql<number>`count(*)`.mapWith(Number) })
      .from(disputes)
      .innerJoin(exams, eq(exams.id, disputes.examId))
      .where(and(eq(disputes.organizationId, auth.organization.id), access))
      .groupBy(exams.id, exams.title, exams.code)
      .orderBy(asc(exams.title));
    const [counts] = await db
      .select({
        active: sql<number>`count(*) filter (where ${disputes.status} in ('open','under_review','needs_info'))`.mapWith(Number),
        overdue: sql<number>`count(*) filter (where ${disputes.status} in ('open','under_review','needs_info') and ${disputes.dueAt} < now())`.mapWith(Number),
        mine: sql<number>`count(*) filter (where ${disputes.status} in ('open','under_review','needs_info') and ${disputes.assignedTo} = ${auth.user.id})`.mapWith(Number),
        unassigned: sql<number>`count(*) filter (where ${disputes.status} in ('open','under_review','needs_info') and ${disputes.assignedTo} is null)`.mapWith(Number),
      })
      .from(disputes)
      .where(and(eq(disputes.organizationId, auth.organization.id), access));
    return { items, exams: examRows, counts: counts ?? { active: 0, overdue: 0, mine: 0, unassigned: 0 } };
  }

  async assign(auth: TenantAuthContext, id: string, input: { assigneeId: string | null }) {
    const out = await this.c.db.transaction(async (tx) => {
      const d = await this.loadDispute(tx, auth, id, true);
      const exam = await this.staffExam(tx, auth, d);
      if (!isActiveStatus(d.status)) throw new ConflictError('Only an open dispute can be reassigned', 'DISPUTE_CLOSED');
      let assigneeName: string | null = null;
      if (input.assigneeId) {
        const reviewers = await reviewersFor(tx, exam);
        const reviewer = reviewers.find((r) => r.id === input.assigneeId);
        if (!reviewer) throw new ValidationError('They cannot review disputes on this exam', { assigneeId: 'Choose someone who reviews disputes on this exam' });
        const parties = await this.conflictParties(tx, d);
        const conflict = conflictOfInterest(input.assigneeId, parties);
        if (conflict) {
          const reason = parties.graderIds.includes(input.assigneeId)
            ? `${reviewer.name} graded this answer, so they cannot decide this dispute.`
            : `${reviewer.name} decided the original dispute, so they cannot decide the appeal.`;
          throw new ValidationError(reason, { assigneeId: reason });
        }
        assigneeName = reviewer.name;
      }
      await tx.update(disputes).set({ assignedTo: input.assigneeId }).where(eq(disputes.id, id));
      if (input.assigneeId && input.assigneeId !== auth.user.id) {
        await notify(
          tx,
          {
            userId: input.assigneeId,
            organizationId: exam.organizationId,
            kind: 'dispute.assigned',
            title: `Dispute assigned to you: ${exam.title}`,
            body: d.dueAt ? `Decide by ${d.dueAt.toISOString().slice(0, 10)}.` : null,
            link: this.disputeLink(id, false),
          },
          this.c.realtime,
        );
      }
      return { exam, assigneeName };
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'dispute.assigned',
      entityType: 'dispute',
      entityId: id,
      summary: out.assigneeName ? `Assigned a dispute to ${out.assigneeName}` : 'Unassigned a dispute',
      metadata: { examId: out.exam.id, assigneeId: input.assigneeId },
    });
    return this.get(auth, id);
  }

  async setStatus(auth: TenantAuthContext, id: string, input: { status: 'under_review' | 'needs_info'; message?: string }) {
    const out = await this.c.db.transaction(async (tx) => {
      const d = await this.loadDispute(tx, auth, id, true);
      const exam = await this.staffExam(tx, auth, d);
      if (!isActiveStatus(d.status)) throw new ConflictError('This dispute already has a decision', 'DISPUTE_CLOSED');
      // Whoever marked the answer (or decided the original) can add notes but doesn't steer the review.
      const conflict = conflictOfInterest(auth.user.id, await this.conflictParties(tx, d));
      if (conflict) throw new AppError(403, 'CONFLICT_OF_INTEREST', conflict);
      const set: Partial<DisputeRow> = { status: input.status };
      // Starting the review claims an unassigned dispute.
      if (input.status === 'under_review' && !d.assignedTo) set.assignedTo = auth.user.id;
      await tx.update(disputes).set(set).where(eq(disputes.id, id));
      if (input.message) await tx.insert(disputeMessages).values({ disputeId: id, authorId: auth.user.id, body: input.message, internal: 0 });
      if (input.status === 'needs_info' || input.message) {
        await notify(
          tx,
          {
            userId: d.raisedBy,
            organizationId: exam.organizationId,
            kind: input.status === 'needs_info' ? 'dispute.needs_info' : 'dispute.under_review',
            title: input.status === 'needs_info' ? `Your examiner needs more information: ${exam.title}` : `Your dispute is under review: ${exam.title}`,
            body: input.message ? input.message.slice(0, 160) : null,
            link: this.disputeLink(id, true),
          },
          this.c.realtime,
        );
      }
      return { from: d.status, exam };
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'dispute.status',
      entityType: 'dispute',
      entityId: id,
      summary: `Moved a dispute from ${STATUS_LABEL[out.from]} to ${STATUS_LABEL[input.status]}`,
      metadata: { examId: out.exam.id, from: out.from, to: input.status },
    });
    return this.get(auth, id);
  }

  /**
   * Decides a dispute in one transaction: optional regrade of a human-graded part, a dispute_resolution ledger
   * row (even when the score stands, so every decision is tamper-evident), the attempt total, superseded reports
   * and the candidate's notification.
   */
  async resolve(auth: TenantAuthContext, id: string, input: ResolveInput) {
    if (input.outcome === 'rejected' && input.regrade) {
      throw new ValidationError('A dispute that is not upheld keeps the score as it is', {
        regrade: 'Remove the re-mark, or choose Upheld or Partially upheld',
      });
    }
    const out = await this.c.db.transaction(async (tx) => {
      const d = await this.loadDispute(tx, auth, id, true);
      const exam = await this.staffExam(tx, auth, d);
      if (!isActiveStatus(d.status)) throw new ConflictError(`This dispute is already ${STATUS_LABEL[d.status].toLowerCase()}`, 'DISPUTE_CLOSED');
      const parties = await this.conflictParties(tx, d);
      const conflict = conflictOfInterest(auth.user.id, parties);
      if (conflict) throw new AppError(403, 'CONFLICT_OF_INTEREST', conflict);

      const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, d.attemptId)).for('update');
      if (!attempt) throw new NotFoundError('Attempt');
      const [item] = d.attemptItemId ? await tx.select().from(attemptItems).where(eq(attemptItems.id, d.attemptItemId)) : [];
      let [answer] = item ? await tx.select().from(answers).where(eq(answers.attemptItemId, item.id)).for('update') : [];
      const scoreBefore = attempt.score;
      const itemBefore = answer?.score ?? null;

      let change: { answerId: string; part: 'answer' | 'working'; previous: number | null; next: number; max: number; rubricItemIds: string[]; adjustment: number } | null = null;
      if (input.regrade) {
        const r = input.regrade;
        if (!item) {
          throw new ValidationError('This dispute is about the whole attempt, so there is no question to re-mark', { regrade: 'Re-marking needs a question' });
        }
        if (item.voidReason) throw new ValidationError('This question was dropped for everyone', { regrade: 'A dropped question carries no marks' });
        if (!humanParts(item.type, item.workingMarks).includes(r.part)) {
          const message =
            r.part === 'answer'
              ? 'This answer is marked automatically. If the key is wrong, apply a remedy so every candidate is re-marked the same way.'
              : 'This question does not award marks for working';
          throw new ValidationError(message, { 'regrade.part': message });
        }
        if (!answer) {
          [answer] = await tx.insert(answers).values({ attemptId: attempt.id, attemptItemId: item.id }).onConflictDoNothing().returning();
          if (!answer) [answer] = await tx.select().from(answers).where(eq(answers.attemptItemId, item.id)).for('update');
        }
        const rubric = await tx.select().from(rubricItems).where(and(eq(rubricItems.examId, d.examId), eq(rubricItems.questionId, item.questionId)));
        const byId = new Map(rubric.map((x) => [x.id, x]));
        const currentPartIds = answer!.rubricItemIds.filter((rid) => byId.get(rid)?.target === r.part);
        const selected = r.rubricItemIds !== undefined ? [...new Set(r.rubricItemIds)] : currentPartIds;
        for (const rid of selected) {
          const ri = byId.get(rid);
          if (!ri) throw new ValidationError('Unknown rubric item', { 'regrade.rubricItemIds': 'One of the rubric items no longer exists. Reload and try again.' });
          if (ri.target !== r.part) throw new ValidationError('That rubric item grades the other part', { 'regrade.rubricItemIds': `“${ri.label}” grades the ${ri.target}` });
        }
        const max = r.part === 'answer' ? item.marks : item.workingMarks;
        const resolved = resolvePartScore({ points: selected.map((rid) => byId.get(rid)!.points), max, adjustment: r.adjustment, score: r.score });
        if (!resolved.ok) throw new ValidationError(resolved.message, { [`regrade.${resolved.field}`]: resolved.message });
        const previous = r.part === 'answer' ? answer!.manualScore : answer!.workingScore;
        const otherIds = answer!.rubricItemIds.filter((rid) => byId.get(rid)?.target !== r.part);
        // gradedBy is deliberately left alone: it names the original grader, who stays excluded from any appeal.
        await tx
          .update(answers)
          .set({
            rubricItemIds: [...otherIds, ...selected],
            ...(r.part === 'answer'
              ? { manualScore: resolved.score, manualAdjustment: resolved.adjustment }
              : { workingScore: resolved.score, workingAdjustment: resolved.adjustment }),
          })
          .where(eq(answers.id, answer!.id));
        change = { answerId: answer!.id, part: r.part, previous, next: resolved.score, max, rubricItemIds: selected, adjustment: resolved.adjustment };
      }

      const totals = await recomputeAttempt(tx, attempt.id);
      const [freshAnswer] = answer ? await tx.select({ score: answers.score }).from(answers).where(eq(answers.id, answer.id)) : [];
      const itemAfter = freshAnswer?.score ?? itemBefore;
      const scoreChanged = change !== null && change.previous !== change.next;

      await appendLedger(tx, {
        organizationId: exam.organizationId,
        examId: exam.id,
        attemptId: attempt.id,
        answerId: answer?.id ?? null,
        action: 'dispute_resolution',
        actorId: auth.user.id,
        previousScore: change ? change.previous : null,
        newScore: change ? change.next : null,
        reason: input.note,
        metadata: {
          disputeId: d.id,
          appealOf: d.appealOf,
          outcome: input.outcome,
          category: d.category,
          part: change?.part ?? null,
          partMax: change?.max ?? null,
          rubricItemIds: change?.rubricItemIds ?? null,
          adjustment: change?.adjustment ?? null,
          itemScoreBefore: itemBefore,
          itemScoreAfter: itemAfter,
          attemptScoreBefore: scoreBefore,
          attemptScoreAfter: totals.score,
          maxScore: totals.maxScore,
          scoreChanged,
        },
      });

      const superseded = exam.resultsStatus === 'published' && (scoreChanged || totals.score !== scoreBefore) ? await supersedeReportsForAttempts(tx, [attempt.id]) : 0;
      const now = new Date();
      await tx
        .update(disputes)
        .set({
          status: 'resolved',
          outcome: input.outcome,
          resolutionNote: input.note,
          scoreBefore,
          scoreAfter: totals.score,
          resolvedBy: auth.user.id,
          resolvedAt: now,
          assignedTo: d.assignedTo ?? auth.user.id,
        })
        .where(eq(disputes.id, d.id));
      // An appeal decision is final: the original no longer waits on anything.
      if (d.appealOf) await tx.update(disputes).set({ status: 'closed' }).where(eq(disputes.id, d.appealOf));

      const published = exam.resultsStatus === 'published';
      await notify(
        tx,
        {
          userId: d.raisedBy,
          organizationId: exam.organizationId,
          kind: 'dispute.resolved',
          title: `${d.appealOf ? 'Appeal decided' : 'Decision on your dispute'}: ${OUTCOME_LABEL[input.outcome]}`,
          body: `${exam.title}. ${published && scoreChanged ? `Your score changed from ${scoreBefore ?? '—'} to ${totals.score}. ` : ''}${input.note.slice(0, 140)}`,
          link: this.disputeLink(d.id, true),
        },
        this.c.realtime,
      );
      return { d, exam, scoreBefore, scoreAfter: totals.score, superseded, change };
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'dispute.resolved',
      entityType: 'dispute',
      entityId: id,
      summary: `${OUTCOME_LABEL[input.outcome]}: ${out.exam.title}${out.change ? ` (${out.change.part} changed from ${out.change.previous ?? 'unmarked'} to ${out.change.next})` : ''}`,
      metadata: { examId: out.exam.id, outcome: input.outcome, scoreBefore: out.scoreBefore, scoreAfter: out.scoreAfter, supersededReports: out.superseded },
    });
    const view = await this.get(auth, id);
    return { ...view, supersededReports: out.superseded };
  }
}
