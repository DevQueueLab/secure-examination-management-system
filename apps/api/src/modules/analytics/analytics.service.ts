import { and, eq } from 'drizzle-orm';
import { QUESTION_TYPE_META, examPhase, isAutoGraded } from '@athena/shared';
import type { Container } from '../../container';
import type { Executor } from '../../db/client';
import { answers, attemptItems, attempts, type exams } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import {
  analyzeItems,
  examInsights,
  rankInsights,
  summarizeExam,
  type AttemptRecord,
  type ItemDefinition,
  type ItemObservation,
} from '../../domain/analytics/item-analysis';
import { mean, round } from '../../domain/analytics/stats';
import { combineItem } from '../../domain/grading/attempt-score';
import { round3 } from '../../domain/rng';
import type { TenantAuthContext } from '../../types/auth';
import { loadExamForStaff } from '../exams/exam-access';
import { GRADING_ROLES, loadExamStructure, settingsOf } from '../grading/exam-structure';
import { isAnswered, selectedOptions } from '../grading/response-format';

type ExamRow = typeof exams.$inferSelect;

function keyedOptions(type: string, key: Record<string, unknown>): string[] | null {
  if (type === 'single_choice') return typeof key.correct === 'string' ? [key.correct] : null;
  if (type === 'multiple_choice') return Array.isArray(key.correct) ? (key.correct as unknown[]).map(String) : null;
  if (type === 'true_false') return typeof key.correct === 'boolean' ? [String(key.correct)] : null;
  return null;
}

/**
 * Examination and question analytics over real, submitted attempts. Loading lives here; every number is
 * computed by the pure functions in domain/analytics.
 */
export async function computeExamAnalytics(db: Executor, exam: ExamRow) {
  const settings = settingsOf(exam);
  const structure = await loadExamStructure(db, exam.id);
  const rows = await db
    .select({
      attemptId: attemptItems.attemptId,
      questionId: attemptItems.questionId,
      type: attemptItems.type,
      marks: attemptItems.marks,
      workingMarks: attemptItems.workingMarks,
      sectionId: attemptItems.sectionId,
      voidReason: attemptItems.voidReason,
      answerKey: attemptItems.answerKey,
      response: answers.response,
      flagged: answers.flagged,
      timeSpentMs: answers.timeSpentMs,
      autoScore: answers.autoScore,
      manualScore: answers.manualScore,
      workingScore: answers.workingScore,
      hasAnswer: answers.id,
    })
    .from(attemptItems)
    .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
    .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
    .where(and(eq(attempts.examId, exam.id), realAttempts, eq(attempts.status, 'submitted')));

  const obsByItem = new Map<string, ItemObservation[]>();
  const keyByQuestion = new Map<string, string[] | null>();
  const perAttempt = new Map<string, { score: number; max: number; pending: number; sections: Map<string, { score: number; max: number }> }>();
  for (const r of rows) {
    if (r.voidReason !== null) continue;
    const { score } = combineItem(
      r,
      r.hasAnswer ? { autoScore: r.autoScore, manualScore: r.manualScore, workingScore: r.workingScore } : undefined,
      isAutoGraded(r.type),
    );
    const max = round3(r.marks + r.workingMarks);
    const list = obsByItem.get(r.questionId) ?? [];
    list.push({
      attemptId: r.attemptId,
      score,
      max,
      answered: isAnswered(r.type, r.response),
      flagged: r.flagged ?? false,
      timeSpentMs: r.timeSpentMs ?? 0,
      selected: selectedOptions(r.type, r.response),
      sectionId: r.sectionId,
    });
    obsByItem.set(r.questionId, list);
    if (!keyByQuestion.has(r.questionId)) keyByQuestion.set(r.questionId, keyedOptions(r.type, r.answerKey));

    const att = perAttempt.get(r.attemptId) ?? { score: 0, max: 0, pending: 0, sections: new Map() };
    if (score === null) att.pending++;
    else {
      att.score += score;
      att.max += max;
      if (r.sectionId) {
        const s = att.sections.get(r.sectionId) ?? { score: 0, max: 0 };
        s.score += score;
        s.max += max;
        att.sections.set(r.sectionId, s);
      }
    }
    perAttempt.set(r.attemptId, att);
  }

  // Percent over graded parts: final once grading completes, provisional before.
  const attemptRecords: AttemptRecord[] = [...perAttempt.entries()].map(([attemptId, a]) => ({
    attemptId,
    score: round3(Math.max(0, a.score)),
    max: round3(a.max),
    complete: a.pending === 0,
  }));

  const defs: ItemDefinition[] = structure
    .filter((q) => obsByItem.has(q.questionId))
    .map((q) => ({
      questionId: q.questionId,
      label: q.label,
      number: q.number,
      title: q.title,
      type: q.type,
      category: q.category,
      options: Array.isArray(q.content.options) ? (q.content.options as { id: string; text: string }[]) : null,
      correct: keyByQuestion.get(q.questionId) ?? null,
    }));

  const items = analyzeItems(defs, obsByItem, attemptRecords);
  const summary = summarizeExam(defs, obsByItem, attemptRecords, settings.passPercent);
  const insights = rankInsights(items, examInsights(summary));

  const sectionOrder = [...new Map(structure.map((q) => [q.sectionId, q.sectionTitle])).entries()];
  const sections = sectionOrder.map(([sectionId, title]) => {
    const percents = [...perAttempt.values()]
      .map((a) => a.sections.get(sectionId))
      .filter((s): s is { score: number; max: number } => !!s && s.max > 0)
      .map((s) => (Math.max(0, s.score) / s.max) * 100);
    return { sectionId, title, attempts: percents.length, meanPercent: round(mean(percents), 1) };
  });

  const topicMap = new Map<string, { score: number; max: number; questions: Set<string>; answers: number }>();
  const categoryOf = new Map(structure.map((q) => [q.questionId, q.category ?? 'General']));
  for (const [questionId, list] of obsByItem) {
    const cat = categoryOf.get(questionId) ?? 'General';
    const t = topicMap.get(cat) ?? { score: 0, max: 0, questions: new Set<string>(), answers: 0 };
    for (const o of list) {
      if (o.score === null) continue;
      t.score += Math.max(0, o.score);
      t.max += o.max;
      t.answers++;
    }
    t.questions.add(questionId);
    topicMap.set(cat, t);
  }
  const topics = [...topicMap.entries()]
    .map(([category, t]) => ({ category, questions: t.questions.size, answers: t.answers, meanPercent: t.max > 0 ? round((t.score / t.max) * 100, 1) : null }))
    .sort((a, b) => (b.meanPercent ?? 0) - (a.meanPercent ?? 0));

  return {
    exam: {
      id: exam.id,
      title: exam.title,
      code: exam.code,
      phase: examPhase(exam),
      resultsStatus: exam.resultsStatus,
      totalMarks: exam.totalMarks,
      passPercent: settings.passPercent,
    },
    generatedAt: new Date().toISOString(),
    summary,
    sections,
    topics,
    items: items.map((i) => ({ ...i, typeLabel: QUESTION_TYPE_META[i.type].label })),
    insights,
  };
}

export type ExamAnalytics = Awaited<ReturnType<typeof computeExamAnalytics>>;

export class AnalyticsService {
  constructor(private readonly c: Container) {}

  async examAnalytics(auth: TenantAuthContext, examId: string): Promise<ExamAnalytics> {
    const exam = await loadExamForStaff(this.c.db, auth, examId, GRADING_ROLES);
    return computeExamAnalytics(this.c.db, exam);
  }
}
