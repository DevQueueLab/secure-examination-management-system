import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { QUESTION_TYPE_META, isAutoGraded, type QuestionType } from '@athena/shared';
import type { Container } from '../../container';
import type { Executor } from '../../db/client';
import { answers, attemptItems, attempts, exams, examStaff, memberships, rubricItems, scratchpads, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { recomputeAttempt } from '../../domain/grading/attempt-score';
import { appendLedger } from '../../domain/ledger/ledger';
import { round3 } from '../../domain/rng';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import { loadExamForStaff } from '../exams/exam-access';
import { supersedeReportsForAttempts } from '../reports/report-status';
import { GRADING_ROLES, humanParts, loadExamStructure, settingsOf, type ExamQuestionInfo } from './exam-structure';
import { formatResponse, isAnswered, normalizeForGrouping, pseudonym, summarizeProvenance } from './response-format';
import { rescorePart, resolvePartScore } from './rubric-score';

export type Part = 'answer' | 'working';

export interface RubricInput {
  label: string;
  description?: string | null;
  points: number;
  target: Part;
  position?: number;
}

export interface GradeInput {
  part: Part;
  rubricItemIds: string[];
  adjustment?: number;
  score?: number;
  feedback?: string | null;
}

type RubricRow = typeof rubricItems.$inferSelect;
type AnswerRow = typeof answers.$inferSelect;

const MANUAL_TYPES: QuestionType[] = ['long_text', 'code'];

/** SQL predicate: the attempt item needs a human for at least one part (voided items never do). */
const needsHuman = and(isNull(attemptItems.voidReason), or(inArray(attemptItems.type, MANUAL_TYPES), gt(attemptItems.workingMarks, 0)));
/** SQL predicate: every human part of the item is graded (null-safe for missing answer rows). */
const isGradedSql = sql<boolean>`((${attemptItems.type} not in ('long_text','code') or ${answers.manualScore} is not null) and (${attemptItems.workingMarks} = 0 or ${answers.workingScore} is not null))`;

/**
 * Rubric-based grading of written answers and method marks (Gradescope-style): graders apply shared rubric
 * items; editing an item's points re-scores every answer that used it, atomically and on the ledger.
 */
export class GradingService {
  constructor(private readonly c: Container) {}

  // ---------------------------------------------------------------- rubric

  private async examQuestion(db: Executor, examId: string, questionId: string): Promise<ExamQuestionInfo> {
    const q = (await loadExamStructure(db, examId)).find((x) => x.questionId === questionId);
    if (!q) throw new NotFoundError('Question');
    return q;
  }

  private partMax(q: Pick<ExamQuestionInfo, 'marks' | 'workingMarks'>, part: Part) {
    return part === 'answer' ? q.marks : q.workingMarks;
  }

  /** A rubric item must grade a part that a human actually grades, and cannot be worth more than that part. */
  private validateRubricTarget(q: ExamQuestionInfo, target: Part, points: number) {
    const parts = humanParts(q.type, q.workingMarks);
    if (!parts.includes(target)) {
      throw new ValidationError(
        target === 'answer' ? 'The final answer is marked automatically; rubric items can only grade the working' : 'This question does not award marks for working',
        { target: target === 'answer' ? 'Answers to this question are marked automatically' : 'This question has no working marks' },
      );
    }
    const max = this.partMax(q, target);
    if (Math.abs(points) > max) {
      throw new ValidationError(`An item cannot be worth more than the part (${max} marks)`, { points: `Between −${max} and ${max}` });
    }
  }

  private async usage(db: Executor, examId: string, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const res = await db.execute<{ rid: string; n: string }>(sql`
      select rid::text as rid, count(*)::int as n
      from ${answers} a
      join ${attempts} t on t.id = a.attempt_id
      cross join lateral unnest(a.rubric_item_ids) as rid
      where t.exam_id = ${examId} and rid = any(${sql.param(ids)}::uuid[])
      group by rid`);
    return new Map(res.rows.map((r) => [r.rid, Number(r.n)]));
  }

  private rubricView(item: RubricRow, usage: number) {
    return {
      id: item.id,
      examId: item.examId,
      questionId: item.questionId,
      target: item.target,
      label: item.label,
      description: item.description,
      points: item.points,
      position: item.position,
      usage,
      updatedAt: item.updatedAt,
    };
  }

  async listRubric(auth: TenantAuthContext, examId: string, questionId: string) {
    await loadExamForStaff(this.c.db, auth, examId, GRADING_ROLES);
    const q = await this.examQuestion(this.c.db, examId, questionId);
    const items = await this.c.db
      .select()
      .from(rubricItems)
      .where(and(eq(rubricItems.examId, examId), eq(rubricItems.questionId, questionId)))
      .orderBy(asc(rubricItems.position), asc(rubricItems.createdAt));
    const usage = await this.usage(this.c.db, examId, items.map((i) => i.id));
    return {
      question: {
        questionId: q.questionId,
        label: q.label,
        title: q.title,
        type: q.type,
        parts: humanParts(q.type, q.workingMarks).map((part) => ({ part, max: this.partMax(q, part) })),
      },
      items: items.map((i) => this.rubricView(i, usage.get(i.id) ?? 0)),
    };
  }

  async createRubricItem(auth: TenantAuthContext, examId: string, questionId: string, input: RubricInput) {
    await loadExamForStaff(this.c.db, auth, examId, GRADING_ROLES);
    const q = await this.examQuestion(this.c.db, examId, questionId);
    this.validateRubricTarget(q, input.target, input.points);
    const [last] = await this.c.db
      .select({ position: sql<number>`coalesce(max(${rubricItems.position}), -1)`.mapWith(Number) })
      .from(rubricItems)
      .where(and(eq(rubricItems.examId, examId), eq(rubricItems.questionId, questionId)));
    const [item] = await this.c.db
      .insert(rubricItems)
      .values({
        examId,
        questionId,
        target: input.target,
        label: input.label,
        description: input.description ?? null,
        points: round3(input.points),
        position: input.position ?? (last?.position ?? -1) + 1,
      })
      .returning();
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'rubric.created',
      entityType: 'rubric_item',
      entityId: item!.id,
      summary: `Added rubric item “${input.label}” (${input.points > 0 ? '+' : ''}${input.points}) to ${q.label}`,
      metadata: { examId, questionId },
    });
    return this.rubricView(item!, 0);
  }

  private async lockRubricItem(tx: Executor, auth: TenantAuthContext, id: string) {
    const [item] = await tx.select().from(rubricItems).where(eq(rubricItems.id, id)).for('update');
    if (!item) throw new NotFoundError('Rubric item');
    const exam = await loadExamForStaff(tx, auth, item.examId, GRADING_ROLES);
    const q = await this.examQuestion(tx, item.examId, item.questionId);
    return { item, exam, q };
  }

  async updateRubricItem(auth: TenantAuthContext, id: string, patch: Partial<RubricInput>) {
    const result = await this.c.db.transaction(async (tx) => {
      const { item, exam, q } = await this.lockRubricItem(tx, auth, id);
      const target = patch.target ?? item.target;
      const points = patch.points !== undefined ? round3(patch.points) : item.points;
      if (patch.target !== undefined || patch.points !== undefined) this.validateRubricTarget(q, target, points);
      const used = (await this.usage(tx, item.examId, [item.id])).get(item.id) ?? 0;
      if (target !== item.target && used > 0) {
        throw new ValidationError(`Already applied to ${used} answer${used === 1 ? '' : 's'}`, {
          target: 'This item is in use. Add a new item for the other part instead.',
        });
      }
      const [updated] = await tx
        .update(rubricItems)
        .set({
          label: patch.label ?? item.label,
          description: patch.description !== undefined ? patch.description : item.description,
          points,
          target,
          position: patch.position ?? item.position,
        })
        .where(eq(rubricItems.id, id))
        .returning();
      const rescored =
        points !== item.points
          ? await this.rescoreRubricChange(tx, auth, exam, { item, oldPoints: item.points, newPoints: points })
          : { answers: 0, attempts: 0, changedScores: 0 };
      return { item: this.rubricView(updated!, used), rescored, examId: item.examId, q, before: item };
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'rubric.updated',
      entityType: 'rubric_item',
      entityId: id,
      summary:
        result.before.points !== result.item.points
          ? `Changed “${result.item.label}” on ${result.q.label} from ${result.before.points} to ${result.item.points} points; re-scored ${result.rescored.answers} answers`
          : `Edited rubric item “${result.item.label}” on ${result.q.label}`,
      metadata: { examId: result.examId, rescored: result.rescored },
    });
    return { item: result.item, rescored: result.rescored };
  }

  async deleteRubricItem(auth: TenantAuthContext, id: string) {
    const result = await this.c.db.transaction(async (tx) => {
      const { item, exam, q } = await this.lockRubricItem(tx, auth, id);
      const rescored = await this.rescoreRubricChange(tx, auth, exam, { item, oldPoints: item.points, newPoints: null });
      await tx.delete(rubricItems).where(eq(rubricItems.id, id));
      return { item, rescored, q };
    });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'rubric.deleted',
      entityType: 'rubric_item',
      entityId: id,
      summary: `Removed rubric item “${result.item.label}” from ${result.q.label}; re-scored ${result.rescored.answers} answers`,
      metadata: { examId: result.item.examId, rescored: result.rescored },
    });
    return { rescored: result.rescored };
  }

  /**
   * Retroactive, atomic re-score of every answer that applied `item` (new points, or removal when newPoints is
   * null). One `rubric_change` ledger row per affected answer, then each attempt total is recomputed.
   */
  private async rescoreRubricChange(
    tx: Executor,
    auth: TenantAuthContext,
    exam: { id: string; organizationId: string; resultsStatus: string },
    change: { item: RubricRow; oldPoints: number; newPoints: number | null },
  ) {
    const { item } = change;
    const all = await tx.select().from(rubricItems).where(and(eq(rubricItems.examId, item.examId), eq(rubricItems.questionId, item.questionId)));
    const byId = new Map(all.map((r) => [r.id, r]));
    const affected = await tx
      .select({ a: answers, marks: attemptItems.marks, workingMarks: attemptItems.workingMarks })
      .from(answers)
      .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
      .innerJoin(attempts, eq(attempts.id, answers.attemptId))
      .where(and(eq(attempts.examId, item.examId), eq(attemptItems.questionId, item.questionId), sql`${answers.rubricItemIds} @> ARRAY[${item.id}]::uuid[]`))
      .for('update', { of: answers });

    const part = item.target;
    const touchedAttempts = new Set<string>();
    const changedAttempts = new Set<string>();
    let changedScores = 0;
    for (const { a, marks, workingMarks } of affected) {
      const max = part === 'answer' ? marks : workingMarks;
      const partIds = a.rubricItemIds.filter((rid) => rid === item.id || byId.get(rid)?.target === part);
      const pointsOf = (rid: string, useNew: boolean) => (rid === item.id ? (useNew ? change.newPoints : change.oldPoints) : (byId.get(rid)?.points ?? 0));
      const oldPoints = partIds.map((rid) => pointsOf(rid, false)!);
      const newPoints = partIds.filter((rid) => !(rid === item.id && change.newPoints === null)).map((rid) => pointsOf(rid, true)!);
      const current = part === 'answer' ? a.manualScore : a.workingScore;
      const adjustment = part === 'answer' ? a.manualAdjustment : a.workingAdjustment;
      const next = rescorePart({ oldPoints, newPoints, adjustment, current, max });
      const remainingIds = change.newPoints === null ? a.rubricItemIds.filter((rid) => rid !== item.id) : a.rubricItemIds;

      const set: Partial<AnswerRow> = { rubricItemIds: remainingIds };
      if (current !== null) {
        if (part === 'answer') Object.assign(set, { manualScore: next.score, manualAdjustment: next.adjustment });
        else Object.assign(set, { workingScore: next.score, workingAdjustment: next.adjustment });
      }
      await tx.update(answers).set(set).where(eq(answers.id, a.id));
      await appendLedger(tx, {
        organizationId: exam.organizationId,
        examId: item.examId,
        attemptId: a.attemptId,
        answerId: a.id,
        action: 'rubric_change',
        actorId: auth.user.id,
        previousScore: current,
        newScore: current === null ? null : next.score,
        reason: change.newPoints === null ? `Rubric item “${item.label}” removed` : `Rubric item “${item.label}” changed from ${change.oldPoints} to ${change.newPoints} points`,
        metadata: { part, rubricItemId: item.id, oldPoints: change.oldPoints, newPoints: change.newPoints, removed: change.newPoints === null },
      });
      touchedAttempts.add(a.attemptId);
      if (current !== null && next.score !== current) {
        changedScores++;
        changedAttempts.add(a.attemptId);
      }
    }
    for (const attemptId of touchedAttempts) await recomputeAttempt(tx, attemptId);
    if (exam.resultsStatus === 'published') await supersedeReportsForAttempts(tx, [...changedAttempts]);
    return { answers: affected.length, attempts: touchedAttempts.size, changedScores };
  }

  // ---------------------------------------------------------------- queue

  /** Per question that needs a human: parts, progress and rubric size. Real, submitted attempts only. */
  async queue(auth: TenantAuthContext, examId: string) {
    const exam = await loadExamForStaff(this.c.db, auth, examId, GRADING_ROLES);
    const structure = await loadExamStructure(this.c.db, examId);
    const rows = await this.c.db
      .select({
        questionId: attemptItems.questionId,
        type: attemptItems.type,
        marks: sql<number>`max(${attemptItems.marks})`.mapWith(Number),
        workingMarks: sql<number>`max(${attemptItems.workingMarks})`.mapWith(Number),
        total: sql<number>`count(*)`.mapWith(Number),
        graded: sql<number>`count(*) filter (where ${isGradedSql})`.mapWith(Number),
        answerGraded: sql<number>`count(*) filter (where ${answers.manualScore} is not null)`.mapWith(Number),
        workingGraded: sql<number>`count(*) filter (where ${answers.workingScore} is not null)`.mapWith(Number),
        blank: sql<number>`count(*) filter (where coalesce(btrim(coalesce(${answers.response}->>'text', ${answers.response}->>'code')), '') = '')`.mapWith(Number),
      })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
      .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted'), needsHuman))
      .groupBy(attemptItems.questionId, attemptItems.type);

    const rubricCounts = await this.c.db
      .select({ questionId: rubricItems.questionId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(rubricItems)
      .where(eq(rubricItems.examId, examId))
      .groupBy(rubricItems.questionId);
    const rubricBy = new Map(rubricCounts.map((r) => [r.questionId, r.n]));
    const rowBy = new Map(rows.map((r) => [r.questionId, r]));

    // Questions that need a human even before anyone submitted, in paper order.
    const questionsOut = structure
      .filter((q) => humanParts(q.type, q.workingMarks).length > 0 || rowBy.has(q.questionId))
      .map((q) => {
        const r = rowBy.get(q.questionId);
        const workingMarks = r?.workingMarks ?? q.workingMarks;
        const parts = humanParts(q.type, workingMarks).map((part) => ({
          part,
          max: part === 'answer' ? (r?.marks ?? q.marks) : workingMarks,
          graded: part === 'answer' ? (r?.answerGraded ?? 0) : (r?.workingGraded ?? 0),
        }));
        return {
          questionId: q.questionId,
          label: q.label,
          number: q.number,
          title: q.title,
          type: q.type,
          typeLabel: QUESTION_TYPE_META[q.type].label,
          sectionTitle: q.sectionTitle,
          category: q.category,
          parts,
          total: r?.total ?? 0,
          graded: r?.graded ?? 0,
          remaining: (r?.total ?? 0) - (r?.graded ?? 0),
          blank: q.type === 'long_text' || q.type === 'code' ? (r?.blank ?? 0) : 0,
          rubricCount: rubricBy.get(q.questionId) ?? 0,
        };
      });

    const [counts] = await this.c.db
      .select({
        submitted: sql<number>`count(*) filter (where ${attempts.status} = 'submitted')`.mapWith(Number),
        inProgress: sql<number>`count(*) filter (where ${attempts.status} <> 'submitted')`.mapWith(Number),
      })
      .from(attempts)
      .where(and(eq(attempts.examId, examId), realAttempts));

    const total = questionsOut.reduce((s, q) => s + q.total, 0);
    const graded = questionsOut.reduce((s, q) => s + q.graded, 0);
    return {
      exam: { id: exam.id, title: exam.title, code: exam.code, resultsStatus: exam.resultsStatus },
      anonymous: settingsOf(exam).grading.anonymous,
      submitted: counts?.submitted ?? 0,
      inProgress: counts?.inProgress ?? 0,
      progress: { total, graded, remaining: total - graded },
      questions: questionsOut,
    };
  }

  // ---------------------------------------------------------------- answers

  /** Creates empty answer rows for submitted attempts that never touched the question, so they can be graded. */
  private async materializeAnswers(db: Executor, examId: string, questionId: string) {
    await db.execute(sql`
      insert into ${answers} (attempt_id, attempt_item_id)
      select ai.attempt_id, ai.id
      from ${attemptItems} ai
      join ${attempts} t on t.id = ai.attempt_id
      where t.exam_id = ${examId} and t.is_sandbox = false and t.status = 'submitted' and ai.question_id = ${questionId}
      on conflict (attempt_id, attempt_item_id) do nothing`);
  }

  /** Stable pseudonyms: attempt order (start time) across the exam's real attempts. */
  private async pseudonyms(db: Executor, examId: string): Promise<Map<string, string>> {
    const rows = await db
      .select({ id: attempts.id })
      .from(attempts)
      .where(and(eq(attempts.examId, examId), realAttempts))
      .orderBy(asc(attempts.startedAt), asc(attempts.id));
    return new Map(rows.map((r, i) => [r.id, pseudonym(i)]));
  }

  private partsView(item: { type: QuestionType; marks: number; workingMarks: number }, a: AnswerRow) {
    const auto = isAutoGraded(item.type);
    return {
      answer: auto
        ? { max: item.marks, score: a.autoScore, graded: a.autoScore !== null, adjustment: 0, auto: true }
        : { max: item.marks, score: a.manualScore, graded: a.manualScore !== null, adjustment: a.manualAdjustment, auto: false },
      working: item.workingMarks > 0 ? { max: item.workingMarks, score: a.workingScore, graded: a.workingScore !== null, adjustment: a.workingAdjustment, auto: false } : null,
    };
  }

  async answersForQuestion(auth: TenantAuthContext, examId: string, questionId: string) {
    const exam = await loadExamForStaff(this.c.db, auth, examId, GRADING_ROLES);
    const q = await this.examQuestion(this.c.db, examId, questionId);
    const anonymous = settingsOf(exam).grading.anonymous;
    await this.materializeAnswers(this.c.db, examId, questionId);

    const rows = await this.c.db
      .select({
        a: answers,
        item: {
          id: attemptItems.id,
          position: attemptItems.position,
          type: attemptItems.type,
          marks: attemptItems.marks,
          workingMarks: attemptItems.workingMarks,
          content: attemptItems.content,
        },
        attempt: { id: attempts.id, userId: attempts.userId, submittedAt: attempts.submittedAt, reviewPriority: attempts.reviewPriority, score: attempts.score, maxScore: attempts.maxScore },
      })
      .from(answers)
      .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
      .innerJoin(attempts, eq(attempts.id, answers.attemptId))
      .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted'), eq(attemptItems.questionId, questionId), isNull(attemptItems.voidReason)));

    const names = await this.pseudonyms(this.c.db, examId);
    const identities = new Map<string, { name: string; rollNumber: string | null }>();
    if (!anonymous && rows.length) {
      const people = await this.c.db
        .select({ id: users.id, name: users.name, rollNumber: memberships.externalId })
        .from(users)
        .leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, exam.organizationId)))
        .where(inArray(users.id, [...new Set(rows.map((r) => r.attempt.userId))]));
      for (const p of people) identities.set(p.id, { name: p.name, rollNumber: p.rollNumber });
    }
    const graderIds = [...new Set(rows.map((r) => r.a.gradedBy).filter((x): x is string => !!x))];
    const graders = graderIds.length ? await this.c.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, graderIds)) : [];
    const graderName = new Map(graders.map((g) => [g.id, g.name]));

    // Scratch pages the candidate attached to their working.
    const wanted = rows.flatMap((r) => (r.a.working?.scratchPages ?? []).map((pageKey) => ({ attemptId: r.a.attemptId, pageKey })));
    const pages = wanted.length
      ? await this.c.db
          .select({ attemptId: scratchpads.attemptId, pageKey: scratchpads.pageKey, kind: scratchpads.kind, data: scratchpads.data })
          .from(scratchpads)
          .where(and(inArray(scratchpads.attemptId, [...new Set(wanted.map((w) => w.attemptId))]), inArray(scratchpads.pageKey, [...new Set(wanted.map((w) => w.pageKey))])))
      : [];
    const pageBy = new Map(pages.map((p) => [`${p.attemptId}:${p.pageKey}`, p]));

    const rubric = await this.listRubric(auth, examId, questionId);

    const list = rows
      .map((r) => {
        const response = formatResponse(r.item.type, r.item.content, r.a.response);
        const identity = identities.get(r.attempt.userId);
        const groupKey = response.text && response.text.length <= 280 ? normalizeForGrouping(response.text) : null;
        return {
          id: r.a.id,
          attemptId: r.a.attemptId,
          attemptItemId: r.item.id,
          position: r.item.position,
          candidate: { label: names.get(r.a.attemptId) ?? 'Candidate', name: identity?.name ?? null, rollNumber: identity?.rollNumber ?? null },
          answered: isAnswered(r.item.type, r.a.response),
          response,
          working: r.a.working
            ? {
                text: r.a.working.text ?? '',
                scratchPages: (r.a.working.scratchPages ?? []).map((key) => {
                  const p = pageBy.get(`${r.a.attemptId}:${key}`);
                  return { pageKey: key, kind: p?.kind ?? null, data: p?.data ?? null };
                }),
              }
            : null,
          provenance: summarizeProvenance(r.a.provenance),
          flagged: r.a.flagged,
          timeSpentMs: r.a.timeSpentMs,
          parts: this.partsView(r.item, r.a),
          rubricItemIds: r.a.rubricItemIds,
          feedback: r.a.feedback,
          scoreStatus: r.a.scoreStatus,
          itemScore: r.a.score,
          itemMax: round3(r.item.marks + r.item.workingMarks),
          graded: humanParts(r.item.type, r.item.workingMarks).every((p) => (p === 'answer' ? r.a.manualScore !== null : r.a.workingScore !== null)),
          gradedAt: r.a.gradedAt,
          gradedBy: r.a.gradedBy ? (graderName.get(r.a.gradedBy) ?? null) : null,
          reviewPriority: r.attempt.reviewPriority,
          groupKey,
        };
      })
      .sort((x, y) => x.candidate.label.localeCompare(y.candidate.label));

    // Identical short answers, so one decision can be applied to the whole group.
    const groupsMap = new Map<string, { key: string; text: string; answerIds: string[] }>();
    for (const a of list) {
      if (!a.groupKey) continue;
      const g = groupsMap.get(a.groupKey) ?? { key: a.groupKey, text: a.response.text!, answerIds: [] };
      g.answerIds.push(a.id);
      groupsMap.set(a.groupKey, g);
    }
    const groups = [...groupsMap.values()].filter((g) => g.answerIds.length > 1).sort((a, b) => b.answerIds.length - a.answerIds.length);
    const groupOf = new Map(groups.flatMap((g) => g.answerIds.map((id) => [id, g.key] as const)));

    return {
      exam: { id: exam.id, title: exam.title, code: exam.code, resultsStatus: exam.resultsStatus },
      anonymous,
      question: {
        questionId: q.questionId,
        label: q.label,
        title: q.title,
        type: q.type,
        typeLabel: QUESTION_TYPE_META[q.type].label,
        stem: typeof q.content.stem === 'string' ? q.content.stem : '',
        workingGuidance: (q.content.working as { guidance?: string } | undefined)?.guidance ?? null,
        language: typeof q.content.language === 'string' ? q.content.language : null,
        parts: rubric.question.parts,
      },
      rubric: rubric.items,
      progress: { total: list.length, graded: list.filter((a) => a.graded).length },
      answers: list.map((a) => ({ ...a, groupKey: groupOf.get(a.id) ?? null })),
      groups: groups.map((g) => ({ key: g.key, text: g.text, count: g.answerIds.length, answerIds: g.answerIds })),
    };
  }

  // ---------------------------------------------------------------- grade

  /**
   * Grades one part of each answer in a single transaction: score, ledger row, attempt total.
   * Every answer must belong to the same exam question.
   */
  private async gradeMany(auth: TenantAuthContext, ids: string[], input: GradeInput) {
    const answerIds = [...new Set(ids)];
    return this.c.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          a: answers,
          item: {
            id: attemptItems.id,
            type: attemptItems.type,
            marks: attemptItems.marks,
            workingMarks: attemptItems.workingMarks,
            questionId: attemptItems.questionId,
            voidReason: attemptItems.voidReason,
          },
          attempt: { id: attempts.id, examId: attempts.examId, organizationId: attempts.organizationId, isSandbox: attempts.isSandbox, status: attempts.status },
        })
        .from(answers)
        .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
        .innerJoin(attempts, eq(attempts.id, answers.attemptId))
        .where(inArray(answers.id, answerIds))
        .for('update', { of: answers });
      // Other tenants' ids, sandbox previews and unknown ids are all reported as not found.
      const visible = rows.filter((r) => r.attempt.organizationId === auth.organization.id && !r.attempt.isSandbox);
      if (visible.length !== answerIds.length) throw new NotFoundError('Answer');
      const examIds = new Set(visible.map((r) => r.attempt.examId));
      const questionIds = new Set(visible.map((r) => r.item.questionId));
      if (examIds.size !== 1 || questionIds.size !== 1) throw new ValidationError('Grade answers to one question at a time', { answerIds: 'Answers belong to different questions' });
      const examId = visible[0]!.attempt.examId;
      const questionId = visible[0]!.item.questionId;
      const exam = await loadExamForStaff(tx, auth, examId, GRADING_ROLES);
      if (visible.some((r) => r.item.voidReason !== null)) {
        throw new ValidationError('This question was dropped from scoring', { answerIds: 'The question is voided for everyone' });
      }
      if (visible.some((r) => r.attempt.status !== 'submitted')) {
        throw new ValidationError('This attempt has not been submitted yet', { answerIds: 'Only submitted attempts can be graded' });
      }

      const rubric = await tx.select().from(rubricItems).where(and(eq(rubricItems.examId, examId), eq(rubricItems.questionId, questionId)));
      const rubricById = new Map(rubric.map((r) => [r.id, r]));
      const selected = [...new Set(input.rubricItemIds)];
      for (const rid of selected) {
        const r = rubricById.get(rid);
        if (!r) throw new ValidationError('Unknown rubric item', { rubricItemIds: 'One of the rubric items no longer exists. Reload and try again.' });
        if (r.target !== input.part) throw new ValidationError('That rubric item grades the other part', { rubricItemIds: `“${r.label}” grades the ${r.target}` });
      }
      const points = selected.map((rid) => rubricById.get(rid)!.points);

      const changedAttempts = new Set<string>();
      const results: { answerId: string; attemptId: string; previous: number | null; score: number }[] = [];
      for (const { a, item, attempt } of visible) {
        if (!humanParts(item.type, item.workingMarks).includes(input.part)) {
          throw new ValidationError(input.part === 'answer' ? 'The final answer is marked automatically' : 'This question has no working marks', {
            part: input.part === 'answer' ? 'Marked automatically' : 'No working marks on this question',
          });
        }
        const max = input.part === 'answer' ? item.marks : item.workingMarks;
        const resolved = resolvePartScore({ points, max, adjustment: input.adjustment, score: input.score });
        if (!resolved.ok) throw new ValidationError(resolved.message, { [resolved.field]: resolved.message });

        const previous = input.part === 'answer' ? a.manualScore : a.workingScore;
        const otherPartIds = a.rubricItemIds.filter((rid) => rubricById.get(rid)?.target !== input.part);
        const nextIds = [...otherPartIds, ...selected];
        const prevPartIds = a.rubricItemIds.filter((rid) => rubricById.get(rid)?.target === input.part);
        const rubricChanged = prevPartIds.length !== selected.length || prevPartIds.some((rid) => !selected.includes(rid));
        const scoreChanged = previous !== resolved.score;

        const set: Partial<AnswerRow> = {
          rubricItemIds: nextIds,
          scoreStatus: 'manual',
          gradedBy: auth.user.id,
          gradedAt: new Date(),
          ...(input.part === 'answer'
            ? { manualScore: resolved.score, manualAdjustment: resolved.adjustment }
            : { workingScore: resolved.score, workingAdjustment: resolved.adjustment }),
          ...(input.feedback !== undefined ? { feedback: input.feedback?.trim() ? input.feedback.trim() : null } : {}),
        };
        await tx.update(answers).set(set).where(eq(answers.id, a.id));
        if (scoreChanged || rubricChanged || previous === null) {
          await appendLedger(tx, {
            organizationId: exam.organizationId,
            examId,
            attemptId: attempt.id,
            answerId: a.id,
            action: 'manual_grade',
            actorId: auth.user.id,
            previousScore: previous,
            newScore: resolved.score,
            reason: answerIds.length > 1 ? `Group grade (${answerIds.length} identical answers)` : null,
            metadata: { part: input.part, rubricItemIds: selected, adjustment: resolved.adjustment, explicit: input.score !== undefined, clamped: resolved.clamped },
          });
        }
        if (scoreChanged) changedAttempts.add(attempt.id);
        results.push({ answerId: a.id, attemptId: attempt.id, previous, score: resolved.score });
      }

      const totals = new Map<string, Awaited<ReturnType<typeof recomputeAttempt>>>();
      for (const attemptId of new Set(visible.map((r) => r.attempt.id))) totals.set(attemptId, await recomputeAttempt(tx, attemptId));
      if (exam.resultsStatus === 'published') await supersedeReportsForAttempts(tx, [...changedAttempts]);

      const [progress] = await tx
        .select({ total: sql<number>`count(*)`.mapWith(Number), graded: sql<number>`count(*) filter (where ${isGradedSql})`.mapWith(Number) })
        .from(attemptItems)
        .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
        .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
        .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted'), eq(attemptItems.questionId, questionId), isNull(attemptItems.voidReason)));

      const fresh = await tx.select().from(answers).where(inArray(answers.id, answerIds));
      const freshBy = new Map(fresh.map((f) => [f.id, f]));
      return {
        exam,
        questionId,
        published: exam.resultsStatus === 'published',
        results,
        answers: visible.map(({ a, item }) => {
          const f = freshBy.get(a.id)!;
          return {
            id: f.id,
            attemptId: f.attemptId,
            parts: this.partsView(item, f),
            rubricItemIds: f.rubricItemIds,
            feedback: f.feedback,
            itemScore: f.score,
            graded: humanParts(item.type, item.workingMarks).every((p) => (p === 'answer' ? f.manualScore !== null : f.workingScore !== null)),
            gradedAt: f.gradedAt,
            gradedBy: auth.user.name,
          };
        }),
        attempts: [...totals.entries()].map(([id, t]) => ({ id, score: t.score, maxScore: t.maxScore, gradingStatus: t.status, pending: t.pending })),
        progress: { total: progress?.total ?? 0, graded: progress?.graded ?? 0 },
      };
    });
  }

  async grade(auth: TenantAuthContext, answerId: string, input: GradeInput) {
    const out = await this.gradeMany(auth, [answerId], input);
    const r = out.results[0]!;
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'grading.graded',
      entityType: 'answer',
      entityId: answerId,
      summary: `Graded the ${input.part}: ${r.previous ?? '—'} → ${r.score}`,
      metadata: { examId: out.exam.id, questionId: out.questionId, attemptId: r.attemptId, part: input.part },
    });
    return { answer: out.answers[0]!, attempt: out.attempts[0]!, progress: out.progress, published: out.published };
  }

  async gradeGroup(auth: TenantAuthContext, answerIds: string[], input: GradeInput) {
    const out = await this.gradeMany(auth, answerIds, input);
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'grading.group_graded',
      entityType: 'question',
      entityId: out.questionId,
      summary: `Graded ${answerIds.length} identical answers at once (${input.part})`,
      metadata: { examId: out.exam.id, answerIds, part: input.part },
    });
    return { answers: out.answers, attempts: out.attempts, progress: out.progress, published: out.published };
  }

  /** Blank written answers earn nothing; grading them one by one is busywork. */
  async zeroBlanks(auth: TenantAuthContext, examId: string, questionId: string) {
    await loadExamForStaff(this.c.db, auth, examId, GRADING_ROLES);
    await this.materializeAnswers(this.c.db, examId, questionId);
    const blanks = await this.c.db
      .select({ id: answers.id, type: attemptItems.type, response: answers.response })
      .from(answers)
      .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
      .innerJoin(attempts, eq(attempts.id, answers.attemptId))
      .where(
        and(
          eq(attempts.examId, examId),
          realAttempts,
          eq(attempts.status, 'submitted'),
          eq(attemptItems.questionId, questionId),
          inArray(attemptItems.type, MANUAL_TYPES),
          isNull(attemptItems.voidReason),
          sql`${answers.manualScore} is null`,
        ),
      );
    const ids = blanks.filter((b) => !isAnswered(b.type, b.response)).map((b) => b.id);
    if (!ids.length) return { graded: 0 };
    await this.gradeMany(auth, ids, { part: 'answer', rubricItemIds: [], score: 0, feedback: 'No response was submitted.' });
    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'grading.blanks_zeroed',
      entityType: 'question',
      entityId: questionId,
      summary: `Gave 0 to ${ids.length} blank answers`,
      metadata: { examId, count: ids.length },
    });
    return { graded: ids.length };
  }

  // ---------------------------------------------------------------- inbox

  /** Every exam the user grades, with what is left to do. */
  async inbox(auth: TenantAuthContext) {
    const viewAll = auth.permissions.has('exams.view_all');
    const res = await this.c.db.execute<{
      id: string;
      title: string;
      code: string | null;
      status: string;
      results_status: string;
      window_opens_at: Date;
      window_closes_at: Date;
      role: string | null;
      submitted: string;
      in_progress: string;
      total: string;
      graded: string;
      questions_open: string;
      last_graded_at: Date | null;
    }>(sql`
      select e.id, e.title, e.code, e.status, e.results_status, e.window_opens_at, e.window_closes_at, s.role,
        (select count(*) from ${attempts} t where t.exam_id = e.id and t.is_sandbox = false and t.status = 'submitted') as submitted,
        (select count(*) from ${attempts} t where t.exam_id = e.id and t.is_sandbox = false and t.status <> 'submitted') as in_progress,
        coalesce(w.total, 0) as total, coalesce(w.graded, 0) as graded, coalesce(w.questions_open, 0) as questions_open, w.last_graded_at
      from ${exams} e
      left join ${examStaff} s on s.exam_id = e.id and s.user_id = ${auth.user.id}
      left join lateral (
        select count(*) as total,
          count(*) filter (where (ai.type not in ('long_text','code') or a.manual_score is not null) and (ai.working_marks = 0 or a.working_score is not null)) as graded,
          count(distinct ai.question_id) filter (where not ((ai.type not in ('long_text','code') or a.manual_score is not null) and (ai.working_marks = 0 or a.working_score is not null))) as questions_open,
          max(a.graded_at) as last_graded_at
        from ${attemptItems} ai
        join ${attempts} t on t.id = ai.attempt_id
        left join ${answers} a on a.attempt_item_id = ai.id
        where t.exam_id = e.id and t.is_sandbox = false and t.status = 'submitted' and ai.void_reason is null
          and (ai.type in ('long_text','code') or ai.working_marks > 0)
      ) w on true
      where e.organization_id = ${auth.organization.id}
        and e.status <> 'draft'
        and (${viewAll} or s.role in ('owner','co_examiner','grader'))
      order by (coalesce(w.total, 0) - coalesce(w.graded, 0)) desc, e.window_closes_at desc`);
    const now = Date.now();
    return {
      exams: res.rows.map((r) => {
        const total = Number(r.total);
        const graded = Number(r.graded);
        const opens = new Date(r.window_opens_at).getTime();
        const closes = new Date(r.window_closes_at).getTime();
        return {
          examId: r.id,
          title: r.title,
          code: r.code,
          phase: r.status === 'archived' ? 'archived' : now < opens ? 'scheduled' : now < closes ? 'ongoing' : 'completed',
          resultsStatus: r.results_status,
          role: r.role,
          submitted: Number(r.submitted),
          inProgress: Number(r.in_progress),
          total,
          graded,
          remaining: total - graded,
          questionsOpen: Number(r.questions_open),
          lastGradedAt: r.last_graded_at,
          windowClosesAt: r.window_closes_at,
        };
      }),
    };
  }
}
