import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { QUESTION_TYPE_META, isAutoGraded, type QuestionType, type RemedyType } from '@athena/shared';
import type { Container } from '../../container';
import type { Executor } from '../../db/client';
import { answers, attemptItems, attempts, disputes, exams, questionVersions, remedies, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { combineItem, recomputeAttempt } from '../../domain/grading/attempt-score';
import { appendLedger } from '../../domain/ledger/ledger';
import { round3 } from '../../domain/rng';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import { loadExamForStaff } from '../exams/exam-access';
import { GRADING_ROLES, loadExamStructure, type ExamQuestionInfo } from '../grading/exam-structure';
import { formatCorrectAnswer, selectedOptions } from '../grading/response-format';
import { notify } from '../notifications/notify';
import { supersedeReportsForAttempts } from '../reports/report-status';
import { planAlternatives, supportsAlternatives, type AlternativePlan } from './alternative-key';
import { ACTIVE_STATUSES, conflictOfInterest, percentOf, summarizeImpacts } from './dispute.policy';
import { graderIdsOf } from './evidence';
import { candidateLabels, hasExaminerAccess } from './dispute.support';
import { REMEDY_LABEL } from './dispute.views';

type ItemRow = typeof attemptItems.$inferSelect;
type AnswerRow = typeof answers.$inferSelect;
type ExamRow = typeof exams.$inferSelect;

export interface RemedyInput {
  questionId: string;
  type: RemedyType;
  payload: Record<string, unknown>;
  reason: string;
  disputeId?: string | null;
  dryRun: boolean;
}

const CHOICE_TYPES: QuestionType[] = ['single_choice', 'multiple_choice', 'true_false'];

interface ItemState {
  item: ItemRow;
  answer: AnswerRow | undefined;
}

/** Mirrors recomputeAttempt, on in-memory state, so a dry run predicts exactly what a commit will store. */
function totalsOf(items: readonly ItemState[]) {
  let total = 0;
  let max = 0;
  for (const { item, answer } of items) {
    if (item.voidReason !== null) continue;
    max += item.marks + item.workingMarks;
    const { score, pending } = combineItem(item, answer, isAutoGraded(item.type));
    if (!pending) total += score!;
  }
  return { score: round3(Math.max(0, total)), max: round3(max) };
}

const itemScore = (s: ItemState) => (s.item.voidReason !== null ? null : combineItem(s.item, s.answer, isAutoGraded(s.item.type)).score);

interface PartChange {
  part: 'answer' | 'working';
  previous: number | null;
  next: number;
  max: number;
}

interface AttemptChange {
  attemptId: string;
  userId: string;
  candidate: string;
  target: ItemState;
  parts: PartChange[];
  voided: boolean;
  itemBefore: number | null;
  itemAfter: number | null;
  itemMax: number;
  before: { score: number; max: number };
  after: { score: number; max: number };
}

/**
 * Question-level remedies. When a dispute shows a question was flawed, the fix applies to every candidate who sat
 * it, in one transaction, never only to whoever complained. Re-marking remedies never lower anyone's score.
 */
export class RemediesService {
  constructor(private readonly c: Container) {}

  private async question(db: Executor, examId: string, questionId: string) {
    const q = (await loadExamStructure(db, examId)).find((x) => x.questionId === questionId);
    if (!q) throw new ValidationError('That question is not on this exam', { questionId: 'Choose a question from this exam' });
    const [version] = await db.select({ answerKey: questionVersions.answerKey }).from(questionVersions).where(eq(questionVersions.id, q.versionId));
    return { q, key: (version?.answerKey ?? {}) as Record<string, unknown> };
  }

  /** Remedies applied so far, plus each question's facts the wizard needs (key, answer spread, disputes). */
  async list(auth: TenantAuthContext, examId: string) {
    const db = this.c.db;
    const exam = await loadExamForStaff(db, auth, examId, GRADING_ROLES);
    const canApply = await hasExaminerAccess(db, auth, examId);
    const structure = await loadExamStructure(db, examId);
    const versions = structure.length
      ? await db.select({ id: questionVersions.id, answerKey: questionVersions.answerKey }).from(questionVersions).where(inArray(questionVersions.id, structure.map((q) => q.versionId)))
      : [];
    const keyBy = new Map(versions.map((v) => [v.id, v.answerKey as Record<string, unknown>]));

    const stats = await db
      .select({
        questionId: attemptItems.questionId,
        sat: sql<number>`count(*)`.mapWith(Number),
        submitted: sql<number>`count(*) filter (where ${attempts.status} = 'submitted')`.mapWith(Number),
        running: sql<number>`count(*) filter (where ${attempts.status} <> 'submitted')`.mapWith(Number),
        voided: sql<number>`count(*) filter (where ${attemptItems.voidReason} is not null)`.mapWith(Number),
        avg: sql<number | null>`avg(${answers.score}) filter (where ${attempts.status} = 'submitted' and ${attemptItems.voidReason} is null)`.mapWith((v) => (v === null ? null : round3(Number(v)))),
        full: sql<number>`count(*) filter (where ${answers.score} >= ${attemptItems.marks} + ${attemptItems.workingMarks} and ${attemptItems.voidReason} is null)`.mapWith(Number),
      })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
      .where(and(eq(attempts.examId, examId), realAttempts))
      .groupBy(attemptItems.questionId);
    const statsBy = new Map(stats.map((s) => [s.questionId, s]));

    const disputeCounts = await db
      .select({
        questionId: attemptItems.questionId,
        active: sql<number>`count(*) filter (where ${disputes.status} in ('open','under_review','needs_info'))`.mapWith(Number),
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(disputes)
      .innerJoin(attemptItems, eq(attemptItems.id, disputes.attemptItemId))
      .where(eq(disputes.examId, examId))
      .groupBy(attemptItems.questionId);
    const disputesBy = new Map(disputeCounts.map((d) => [d.questionId, d]));

    // How candidates answered each choice question: a key error usually shows as a popular "wrong" option.
    const choiceRows = await db
      .select({ questionId: attemptItems.questionId, type: attemptItems.type, response: answers.response })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
      .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted'), inArray(attemptItems.type, CHOICE_TYPES)));
    const spread = new Map<string, Map<string, number>>();
    for (const r of choiceRows) {
      const m = spread.get(r.questionId) ?? new Map<string, number>();
      for (const id of selectedOptions(r.type, r.response) ?? []) m.set(id, (m.get(id) ?? 0) + 1);
      spread.set(r.questionId, m);
    }

    const rows = await db
      .select({ r: remedies, by: users.name })
      .from(remedies)
      .leftJoin(users, eq(users.id, remedies.createdBy))
      .where(eq(remedies.examId, examId))
      .orderBy(desc(remedies.createdAt));
    const labelBy = new Map(structure.map((q) => [q.questionId, q]));

    return {
      exam: { id: exam.id, title: exam.title, code: exam.code, resultsStatus: exam.resultsStatus },
      canApply,
      questions: structure.map((q) => {
        const key = keyBy.get(q.versionId) ?? {};
        const s = statsBy.get(q.questionId);
        const options = Array.isArray(q.content.options) ? (q.content.options as { id: string; text: string }[]) : null;
        const counts = spread.get(q.questionId);
        const correctIds = q.type === 'single_choice' ? [String(key.correct)] : q.type === 'multiple_choice' ? ((key.correct as string[]) ?? []) : q.type === 'true_false' ? [String(key.correct)] : [];
        const choiceList = q.type === 'true_false' ? [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }] : (options ?? []);
        return {
          questionId: q.questionId,
          label: q.label,
          title: q.title,
          type: q.type,
          typeLabel: QUESTION_TYPE_META[q.type].label,
          marks: q.marks,
          workingMarks: q.workingMarks,
          stem: typeof q.content.stem === 'string' ? q.content.stem : '',
          unit: typeof q.content.unit === 'string' ? q.content.unit : null,
          variables: Array.isArray(q.content.variables) ? (q.content.variables as { name: string; min: number; max: number }[]).map((v) => ({ name: v.name, min: v.min, max: v.max })) : [],
          blanks: Array.isArray(q.content.blanks) ? (q.content.blanks as { id: string; label?: string }[]) : [],
          key: {
            text: safeCorrect(q, key),
            formula: typeof key.formula === 'string' && key.formula.trim() ? key.formula : null,
            tolerance: (key.tolerance as { type: string; value: number } | undefined) ?? null,
            correctIds,
          },
          choices: CHOICE_TYPES.includes(q.type) ? choiceList.map((o) => ({ id: o.id, text: o.text, correct: correctIds.includes(o.id), count: counts?.get(o.id) ?? 0 })) : null,
          sat: s?.sat ?? 0,
          submitted: s?.submitted ?? 0,
          running: s?.running ?? 0,
          dropped: (s?.voided ?? 0) > 0,
          avgScore: s?.avg ?? null,
          fullMarks: s?.full ?? 0,
          disputes: { active: disputesBy.get(q.questionId)?.active ?? 0, total: disputesBy.get(q.questionId)?.total ?? 0 },
          supportsAlternatives: supportsAlternatives(q.type),
        };
      }),
      remedies: rows.map(({ r, by }) => ({
        id: r.id,
        questionId: r.questionId,
        question: labelBy.get(r.questionId) ? { label: labelBy.get(r.questionId)!.label, title: labelBy.get(r.questionId)!.title } : null,
        type: r.type,
        typeLabel: REMEDY_LABEL[r.type],
        summary: (r.payload as { summary?: string }).summary ?? REMEDY_LABEL[r.type],
        payload: r.payload,
        reason: r.reason,
        affectedAttempts: r.affectedAttempts,
        changed: Number((r.payload as { changed?: number }).changed ?? 0),
        createdBy: by,
        createdAt: r.createdAt,
      })),
    };
  }

  /** Computes, per candidate, what the remedy would do. Pure reads: shared by the dry run and the commit. */
  private async compute(db: Executor, exam: ExamRow, input: RemedyInput, q: ExamQuestionInfo, plan: AlternativePlan | null) {
    const targets = await db
      .select({ item: attemptItems, attemptId: attempts.id, status: attempts.status, userId: attempts.userId, name: users.name })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .innerJoin(users, eq(users.id, attempts.userId))
      .where(and(eq(attempts.examId, exam.id), realAttempts, eq(attemptItems.questionId, input.questionId)));

    const running = targets.filter((t) => t.status !== 'submitted').length;
    const live = targets.filter((t) => t.status === 'submitted' && t.item.voidReason === null);
    let blocked: { code: string; message: string } | null = null;
    if (running > 0) {
      blocked = {
        code: 'REMEDY_WHILE_RUNNING',
        message: `${running} candidate${running === 1 ? ' is' : 's are'} still sitting this exam. Apply the remedy after everyone has submitted, so nobody is marked by a different key.`,
      };
    } else if (live.length === 0) {
      blocked = targets.length
        ? { code: 'REMEDY_ALREADY_DROPPED', message: 'This question has already been dropped for everyone.' }
        : { code: 'REMEDY_NO_ATTEMPTS', message: 'Nobody has sat this question yet, so there is nothing to re-mark.' };
    }

    const attemptIds = [...new Set(live.map((t) => t.attemptId))];
    const allItems = attemptIds.length ? await db.select().from(attemptItems).where(inArray(attemptItems.attemptId, attemptIds)) : [];
    const allAnswers = attemptIds.length ? await db.select().from(answers).where(inArray(answers.attemptId, attemptIds)) : [];
    const answerByItem = new Map(allAnswers.map((a) => [a.attemptItemId, a]));
    const labels = await candidateLabels(db, exam, live.map((t) => ({ attemptId: t.attemptId, name: t.name })));

    const changes: AttemptChange[] = [];
    for (const t of live) {
      const states: ItemState[] = allItems.filter((i) => i.attemptId === t.attemptId).map((i) => ({ item: i, answer: answerByItem.get(i.id) }));
      const target = states.find((s) => s.item.id === t.item.id)!;
      const before = totalsOf(states);
      const itemBefore = itemScore(target);
      const parts: PartChange[] = [];
      let next: ItemState = target;

      if (input.type === 'accept_alternatives' && plan) {
        const current = target.answer?.autoScore ?? 0;
        const alt = plan.grade({ type: t.item.type, marks: t.item.marks, answerKey: t.item.answerKey, marking: t.item.marking, variant: t.item.variant }, target.answer?.response ?? null);
        // The stored score is the floor: an alternative can only add marks.
        const best = round3(Math.max(current, alt));
        if (best > current + 1e-9) {
          parts.push({ part: 'answer', previous: target.answer?.autoScore ?? null, next: best, max: t.item.marks });
          next = { item: t.item, answer: { ...(target.answer ?? emptyAnswer(t.attemptId, t.item.id)), autoScore: best } };
        }
      } else if (input.type === 'full_marks_all') {
        const a = target.answer ?? emptyAnswer(t.attemptId, t.item.id);
        const auto = isAutoGraded(t.item.type);
        const answerNow = auto ? a.autoScore : a.manualScore;
        let patched: AnswerRow = { ...a };
        if ((answerNow ?? -1) < t.item.marks - 1e-9) {
          parts.push({ part: 'answer', previous: answerNow, next: t.item.marks, max: t.item.marks });
          patched = auto ? { ...patched, autoScore: t.item.marks } : { ...patched, manualScore: t.item.marks };
        }
        if (t.item.workingMarks > 0 && (a.workingScore ?? -1) < t.item.workingMarks - 1e-9) {
          parts.push({ part: 'working', previous: a.workingScore, next: t.item.workingMarks, max: t.item.workingMarks });
          patched = { ...patched, workingScore: t.item.workingMarks };
        }
        if (parts.length) next = { item: t.item, answer: patched };
      } else if (input.type === 'drop_question') {
        next = { item: { ...t.item, voidReason: input.reason }, answer: target.answer };
      }

      const afterStates = states.map((s) => (s.item.id === t.item.id ? next : s));
      const after = totalsOf(afterStates);
      changes.push({
        attemptId: t.attemptId,
        userId: t.userId,
        candidate: labels.get(t.attemptId)?.label ?? 'Candidate',
        target,
        parts,
        voided: input.type === 'drop_question',
        itemBefore,
        itemAfter: input.type === 'drop_question' ? null : itemScore(next),
        itemMax: round3(t.item.marks + t.item.workingMarks),
        before,
        after,
      });
    }
    // A remedy never lowers anyone's raw score. Dropping a question that some candidates earned marks on would,
    // so it is offered only when nobody scored on it; otherwise full marks for everyone is the fair equivalent.
    if (!blocked && input.type === 'drop_question') {
      const losers = changes.filter((c) => (c.itemBefore ?? 0) > 0).length;
      if (losers > 0) {
        blocked = {
          code: 'REMEDY_WOULD_LOWER',
          message: `${losers} candidate${losers === 1 ? '' : 's'} earned marks on this question, and dropping it would take them away. A remedy never lowers anyone’s score: give full marks for everyone instead.`,
        };
      }
    }
    return { changes, blocked, attemptsWithQuestion: targets.length };
  }

  /** Whether this user may not decide the dispute: they graded the answer, or decided the original of an appeal. */
  private async conflicted(ex: Executor, userId: string, d: typeof disputes.$inferSelect): Promise<boolean> {
    const [original] = d.appealOf ? await ex.select({ resolvedBy: disputes.resolvedBy, evidence: disputes.evidence }).from(disputes).where(eq(disputes.id, d.appealOf)) : [];
    const [answer] = d.answerId ? await ex.select({ gradedBy: answers.gradedBy }).from(answers).where(eq(answers.id, d.answerId)) : [];
    const graderIds = [...graderIdsOf(d.evidence), ...(original ? graderIdsOf(original.evidence) : []), answer?.gradedBy].filter((x): x is string => !!x);
    return conflictOfInterest(userId, { graderIds, originalResolverId: original?.resolvedBy ?? null }) !== null;
  }

  private report(q: ExamQuestionInfo, input: RemedyInput, plan: AlternativePlan | null, computed: Awaited<ReturnType<RemediesService['compute']>>, activeDisputes: number, withheldDisputes = 0) {
    const impacts = computed.changes.map((c) => ({ scoreBefore: c.before.score, scoreAfter: c.after.score, maxBefore: c.before.max, maxAfter: c.after.max }));
    const s = summarizeImpacts(impacts);
    const maxBefore = computed.changes[0]?.before.max ?? null;
    const maxAfter = computed.changes[0]?.after.max ?? null;
    let percentChangeNote: string | null;
    if (input.type === 'drop_question') {
      const losers = computed.changes.filter((c) => (c.itemBefore ?? 0) > 0).length;
      percentChangeNote =
        `${q.label} stops counting for everyone${maxBefore !== null ? `: the maximum falls from ${maxBefore} to ${maxAfter}` : ''}. ` +
        (losers
          ? `${losers} candidate${losers === 1 ? '' : 's'} who earned marks on it lose${losers === 1 ? 's' : ''} them, so raw scores fall for them. `
          : 'Nobody earned marks on it, so no raw score falls. ') +
        `Percentages rise for ${s.percentUp} and fall for ${s.percentDown}.`;
    } else {
      percentChangeNote = s.gains.count
        ? `The maximum stays at ${maxBefore ?? q.marks + q.workingMarks}. Nobody loses marks; percentages rise only for the ${s.gains.count} candidate${s.gains.count === 1 ? ' who gains' : 's who gain'}.`
        : `The maximum stays at ${maxBefore ?? q.marks + q.workingMarks}. No candidate's answer matches the alternative, so no score changes.`;
    }
    // Gains histogram for the preview chart.
    const buckets = new Map<number, number>();
    for (const c of computed.changes) {
      const d = round3(c.after.score - c.before.score);
      buckets.set(d, (buckets.get(d) ?? 0) + 1);
    }
    return {
      question: { questionId: q.questionId, label: q.label, title: q.title, type: q.type, typeLabel: QUESTION_TYPE_META[q.type].label },
      type: input.type,
      typeLabel: REMEDY_LABEL[input.type],
      summary: plan?.summary ?? REMEDY_LABEL[input.type],
      affectedAttempts: computed.changes.length,
      gains: s.gains,
      rawLosses: s.rawLosses,
      unchanged: s.unchanged,
      percentUp: s.percentUp,
      percentDown: s.percentDown,
      percentChangeNote,
      maxBefore,
      maxAfter,
      distribution: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([delta, count]) => ({ delta, count })),
      perCandidate: computed.changes
        .map((c) => ({
          attemptId: c.attemptId,
          candidate: c.candidate,
          itemBefore: c.itemBefore,
          itemAfter: c.itemAfter,
          itemMax: c.itemMax,
          scoreBefore: c.before.score,
          scoreAfter: c.after.score,
          maxBefore: c.before.max,
          maxAfter: c.after.max,
          percentBefore: percentOf(c.before.score, c.before.max),
          percentAfter: percentOf(c.after.score, c.after.max),
          delta: round3(c.after.score - c.before.score),
        }))
        .sort((a, b) => b.delta - a.delta || a.candidate.localeCompare(b.candidate)),
      resolvesDisputes: activeDisputes,
      /** Open disputes on the question left for another reviewer, because the applier may not decide them. */
      withheldDisputes,
      blocked: computed.blocked,
    };
  }

  async apply(auth: TenantAuthContext, examId: string, input: RemedyInput) {
    const db = this.c.db;
    const exam = await loadExamForStaff(db, auth, examId, GRADING_ROLES);
    if (!(await hasExaminerAccess(db, auth, examId))) {
      throw new ForbiddenError('Only the exam’s examiners can change marks for every candidate. Ask the exam owner to apply this remedy.');
    }
    const { q, key } = await this.question(db, examId, input.questionId);
    const plan = input.type === 'accept_alternatives' ? planAlternatives(q.type, input.payload, q.content, key) : null;

    if (input.disputeId) {
      const [d] = await db
        .select({ id: disputes.id, questionId: attemptItems.questionId })
        .from(disputes)
        .leftJoin(attemptItems, eq(attemptItems.id, disputes.attemptItemId))
        .where(and(eq(disputes.id, input.disputeId), eq(disputes.examId, examId)));
      if (!d) throw new ValidationError('That dispute is not part of this exam', { disputeId: 'Unknown dispute' });
      if (d.questionId !== input.questionId) throw new ValidationError('That dispute is about another question', { questionId: 'The remedy must fix the disputed question' });
    }

    /**
     * Open disputes on the question that the remedy answers. Those the applier may not decide (they graded the
     * answer, or decided the original of an appeal) stay open for another reviewer; the score fix still applies.
     */
    const activeOnQuestion = async (ex: Executor) => {
      const rows = await ex
        .select({ d: disputes })
        .from(disputes)
        .innerJoin(attemptItems, eq(attemptItems.id, disputes.attemptItemId))
        .where(and(eq(disputes.examId, examId), eq(attemptItems.questionId, input.questionId), inArray(disputes.status, [...ACTIVE_STATUSES])));
      const linked: typeof rows = [];
      let withheld = 0;
      for (const row of rows) {
        if (await this.conflicted(ex, auth.user.id, row.d)) withheld += 1;
        else linked.push(row);
      }
      return Object.assign(linked, { withheld });
    };

    if (input.dryRun) {
      const computed = await this.compute(db, exam, input, q, plan);
      const active = await activeOnQuestion(db);
      return { dryRun: true, remedy: null, ...this.report(q, input, plan, computed, active.length, active.withheld) };
    }

    const out = await db.transaction(async (tx) => {
      // Lock every attempt holding the question (in id order) so grading or another remedy cannot interleave.
      const holders = await tx
        .select({ id: attempts.id })
        .from(attempts)
        .innerJoin(attemptItems, eq(attemptItems.attemptId, attempts.id))
        .where(and(eq(attempts.examId, examId), realAttempts, eq(attemptItems.questionId, input.questionId)))
        .orderBy(asc(attempts.id));
      if (holders.length) {
        await tx
          .select({ id: attempts.id })
          .from(attempts)
          .where(inArray(attempts.id, holders.map((h) => h.id)))
          .orderBy(asc(attempts.id))
          .for('update');
      }
      const [freshExam] = await tx.select().from(exams).where(eq(exams.id, examId));
      const computed = await this.compute(tx, freshExam!, input, q, plan);
      if (computed.blocked) throw new ConflictError(computed.blocked.message, computed.blocked.code);

      const changed = computed.changes.filter((c) => c.parts.length > 0 || c.voided);
      const linked = await activeOnQuestion(tx);
      const [remedy] = await tx
        .insert(remedies)
        .values({
          examId,
          questionId: input.questionId,
          type: input.type,
          payload: {
            ...(plan?.payload ?? {}),
            summary: plan?.summary ?? REMEDY_LABEL[input.type],
            changed: changed.length,
            sourceDisputeId: input.disputeId ?? null,
            disputeIds: linked.map((l) => l.d.id),
          },
          reason: input.reason,
          affectedAttempts: computed.changes.length,
          createdBy: auth.user.id,
        })
        .returning();

      for (const c of changed) {
        const disputeIds = linked.filter((l) => l.d.attemptId === c.attemptId).map((l) => l.d.id);
        let answerId = c.target.answer?.id ?? null;
        if (c.parts.length && !answerId) {
          const [created] = await tx.insert(answers).values({ attemptId: c.attemptId, attemptItemId: c.target.item.id }).onConflictDoNothing().returning({ id: answers.id });
          answerId = created?.id ?? (await tx.select({ id: answers.id }).from(answers).where(eq(answers.attemptItemId, c.target.item.id)))[0]?.id ?? null;
        }
        if (c.voided) {
          await tx.update(attemptItems).set({ voidReason: input.reason }).where(eq(attemptItems.id, c.target.item.id));
        } else if (answerId) {
          const auto = isAutoGraded(c.target.item.type);
          const set: Partial<AnswerRow> = {};
          for (const p of c.parts) {
            if (p.part === 'answer') Object.assign(set, auto ? { autoScore: p.next } : { manualScore: p.next });
            else set.workingScore = p.next;
          }
          if (c.target.answer?.scoreStatus === 'ungraded' || !c.target.answer) set.scoreStatus = auto ? 'auto' : 'manual';
          await tx.update(answers).set(set).where(eq(answers.id, answerId));
        }
        const common = {
          remedyId: remedy!.id,
          type: input.type,
          questionId: input.questionId,
          itemScoreBefore: c.itemBefore,
          itemScoreAfter: c.itemAfter,
          attemptScoreBefore: c.before.score,
          attemptScoreAfter: c.after.score,
          maxBefore: c.before.max,
          maxAfter: c.after.max,
          disputeIds,
        };
        if (c.voided) {
          await appendLedger(tx, {
            organizationId: freshExam!.organizationId,
            examId,
            attemptId: c.attemptId,
            answerId,
            action: 'remedy',
            actorId: auth.user.id,
            previousScore: c.itemBefore,
            newScore: null,
            reason: input.reason,
            metadata: { ...common, part: null, partMax: c.itemMax, voided: true },
          });
        }
        for (const p of c.parts) {
          await appendLedger(tx, {
            organizationId: freshExam!.organizationId,
            examId,
            attemptId: c.attemptId,
            answerId,
            action: 'remedy',
            actorId: auth.user.id,
            previousScore: p.previous,
            newScore: p.next,
            reason: input.reason,
            metadata: { ...common, part: p.part, partMax: p.max, voided: false },
          });
        }
      }

      // Recompute every attempt that holds the question, and hold the guarantee: re-marking never lowers a score.
      for (const c of computed.changes) {
        const totals = await recomputeAttempt(tx, c.attemptId);
        if (Math.abs(totals.score - c.after.score) > 1e-6 || Math.abs(totals.maxScore - c.after.max) > 1e-6) {
          throw new ConflictError('Scores changed while the remedy was being applied. Nothing was changed; preview again.', 'REMEDY_STALE');
        }
        if (input.type !== 'drop_question' && totals.score < c.before.score - 1e-9) {
          throw new ConflictError('This remedy would lower a candidate’s score, so nothing was changed.', 'REMEDY_WOULD_LOWER');
        }
      }

      const published = freshExam!.resultsStatus === 'published';
      const moved = changed.filter((c) => c.after.score !== c.before.score || c.after.max !== c.before.max).map((c) => c.attemptId);
      const superseded = published ? await supersedeReportsForAttempts(tx, moved) : 0;

      // Disputes about this question are answered by the fix itself.
      const note = `Fixed for every candidate: ${plan?.summary ?? REMEDY_LABEL[input.type]}. ${input.reason}`.slice(0, 2000);
      const now = new Date();
      const byAttempt = new Map(computed.changes.map((c) => [c.attemptId, c]));
      for (const { d } of linked) {
        const c = byAttempt.get(d.attemptId);
        await tx
          .update(disputes)
          .set({
            status: 'resolved',
            outcome: 'upheld',
            resolutionNote: note,
            scoreBefore: c?.before.score ?? null,
            scoreAfter: c?.after.score ?? null,
            resolvedBy: auth.user.id,
            resolvedAt: now,
            assignedTo: d.assignedTo ?? auth.user.id,
          })
          .where(eq(disputes.id, d.id));
        if (d.appealOf) await tx.update(disputes).set({ status: 'closed' }).where(eq(disputes.id, d.appealOf));
      }

      const linkedUsers = new Set(linked.map((l) => l.d.raisedBy));
      for (const c of computed.changes) {
        const gained = c.after.score !== c.before.score || c.after.max !== c.before.max;
        if (!(published && gained) && !linkedUsers.has(c.userId)) continue;
        const dispute = linked.find((l) => l.d.raisedBy === c.userId);
        await notify(
          tx,
          {
            userId: c.userId,
            organizationId: freshExam!.organizationId,
            kind: 'remedy.applied',
            title: input.type === 'drop_question' ? `A question no longer counts: ${freshExam!.title}` : `A question was re-marked for everyone: ${freshExam!.title}`,
            body: !published
              ? `${plan?.summary ?? REMEDY_LABEL[input.type]}. You will see the effect when results are published.`
              : gained
                ? `${plan?.summary ?? REMEDY_LABEL[input.type]}. Your score is now ${c.after.score}/${c.after.max}, up from ${c.before.score}/${c.before.max}.`
                : `${plan?.summary ?? REMEDY_LABEL[input.type]}. You already had these marks, so your score stays ${c.after.score}/${c.after.max}.`,
            link: dispute ? `/my-disputes/${dispute.d.id}` : `/results/${c.attemptId}`,
          },
          this.c.realtime,
        );
      }
      return { remedy: remedy!, computed, linked: linked.length, withheld: linked.withheld, superseded, exam: freshExam! };
    });

    await this.c.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'remedy.applied',
      entityType: 'remedy',
      entityId: out.remedy.id,
      summary: `${REMEDY_LABEL[input.type]} on ${q.label} of ${out.exam.title}: ${out.computed.changes.length} attempts re-marked, ${out.linked} disputes resolved`,
      metadata: { examId, questionId: input.questionId, type: input.type, supersededReports: out.superseded },
    });
    return {
      dryRun: false,
      remedy: { id: out.remedy.id, createdAt: out.remedy.createdAt },
      supersededReports: out.superseded,
      ...this.report(q, input, plan, out.computed, out.linked, out.withheld),
    };
  }
}

function emptyAnswer(attemptId: string, attemptItemId: string): AnswerRow {
  return {
    id: '',
    attemptId,
    attemptItemId,
    response: null,
    working: null,
    revision: 0,
    flagged: false,
    firstViewedAt: null,
    answeredAt: null,
    timeSpentMs: 0,
    provenance: null,
    pendingOffline: null,
    autoScore: null,
    manualScore: null,
    workingScore: null,
    score: null,
    scoreStatus: 'ungraded',
    rubricItemIds: [],
    manualAdjustment: 0,
    workingAdjustment: 0,
    feedback: null,
    gradedBy: null,
    gradedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function safeCorrect(q: ExamQuestionInfo, key: Record<string, unknown>): string | null {
  try {
    return formatCorrectAnswer(q.type, q.content, key);
  } catch {
    return null;
  }
}
