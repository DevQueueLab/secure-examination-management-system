import { and, asc, eq, inArray } from 'drizzle-orm';
import { QUESTION_TYPE_META, isAutoGraded, type QuestionType } from '@athena/shared';
import type { Executor } from '../../db/client';
import { answers, attemptItems, attempts, examSections, exams, memberships, organizations, questionCategories, questions, rubricItems, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { percentileRank } from '../../domain/analytics/stats';
import { round3 } from '../../domain/rng';
import { settingsOf } from '../grading/exam-structure';
import { formatCorrectAnswer, formatResponse, isAnswered } from '../grading/response-format';

type AttemptRow = typeof attempts.$inferSelect;
type ExamRow = typeof exams.$inferSelect;

export interface ResultItem {
  itemId: string;
  number: number;
  sectionId: string | null;
  title: string;
  type: QuestionType;
  typeLabel: string;
  stem: string;
  /** Candidate-safe content as delivered (options in the order this candidate saw them). */
  content: Record<string, unknown>;
  response: ReturnType<typeof formatResponse>;
  answered: boolean;
  score: number | null;
  max: number;
  parts: { answer: { score: number | null; max: number; auto: boolean }; working: { score: number | null; max: number } | null };
  outcome: 'correct' | 'partial' | 'incorrect' | 'unanswered' | 'pending' | 'voided';
  /** Set when a remedy dropped the question for everyone; it then counts toward neither score nor maximum. */
  voidReason: string | null;
  category: string | null;
  feedback: string | null;
  rubric: { label: string; points: number; target: 'answer' | 'working'; description: string | null }[];
  /** Only when results are published AND the exam shows correct answers. */
  correctAnswer: string | null;
  explanation: string | null;
}

export interface ResultCard {
  attemptId: string;
  examId: string;
  organization: { id: string; name: string };
  exam: { title: string; code: string | null; passPercent: number | null; resultsVersion: number; publishedAt: Date | null };
  candidate: { name: string; rollNumber: string | null; cohort: string | null };
  submittedAt: Date | null;
  submitReason: string | null;
  score: number;
  maxScore: number;
  percent: number;
  pass: boolean | null;
  gradingStatus: string;
  cohort: { size: number; percentile: number | null; rank: number | null; meanPercent: number | null };
  sections: { id: string; title: string; score: number; max: number; percent: number }[];
  topics: { category: string; score: number; max: number; percent: number; items: number }[];
  strengths: string[];
  weaknesses: string[];
  items: ResultItem[];
}

export const percentOf = (score: number | null, max: number) => (max > 0 && score !== null ? round3((score / max) * 100) : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Builds a candidate's full result. No authorization here: callers decide who may see it and pass the
 * visibility switches (solutions and feedback follow the exam's result settings).
 */
export async function buildResultCard(
  db: Executor,
  attempt: AttemptRow,
  exam: ExamRow,
  visibility: { solutions: boolean; feedback: boolean },
): Promise<ResultCard> {
  const settings = settingsOf(exam);
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, exam.organizationId));
  const [person] = await db
    .select({ name: users.name, rollNumber: memberships.externalId, cohort: memberships.cohort })
    .from(users)
    .leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, exam.organizationId)))
    .where(eq(users.id, attempt.userId));

  const rows = await db
    .select({
      item: attemptItems,
      answer: answers,
      title: questions.title,
      category: questionCategories.name,
    })
    .from(attemptItems)
    .innerJoin(questions, eq(questions.id, attemptItems.questionId))
    .leftJoin(questionCategories, eq(questionCategories.id, questions.categoryId))
    .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
    .where(eq(attemptItems.attemptId, attempt.id))
    .orderBy(asc(attemptItems.position));

  const sectionIds = [...new Set(rows.map((r) => r.item.sectionId).filter((x): x is string => !!x))];
  const sectionRows = sectionIds.length
    ? await db.select({ id: examSections.id, title: examSections.title, position: examSections.position }).from(examSections).where(inArray(examSections.id, sectionIds))
    : [];
  const rubricIds = [...new Set(rows.flatMap((r) => r.answer?.rubricItemIds ?? []))];
  const rubric = rubricIds.length ? await db.select().from(rubricItems).where(inArray(rubricItems.id, rubricIds)) : [];
  const rubricBy = new Map(rubric.map((r) => [r.id, r]));

  const items: ResultItem[] = rows.map((r, i) => {
    const a = r.answer;
    const auto = isAutoGraded(r.item.type);
    const voided = r.item.voidReason;
    const max = voided ? 0 : round3(r.item.marks + r.item.workingMarks);
    const answered = isAnswered(r.item.type, a?.response);
    const score = voided ? null : (a?.score ?? null);
    const outcome: ResultItem['outcome'] = voided
      ? 'voided'
      : score === null
        ? answered
          ? 'pending'
          : 'unanswered'
        : !answered && score === 0
          ? 'unanswered'
          : score >= max - 1e-9
            ? 'correct'
            : score > 0
              ? 'partial'
              : 'incorrect';
    const content = r.item.content;
    return {
      itemId: r.item.id,
      number: i + 1,
      sectionId: r.item.sectionId,
      title: r.title,
      type: r.item.type,
      typeLabel: QUESTION_TYPE_META[r.item.type].label,
      stem: typeof content.stem === 'string' ? content.stem : '',
      content,
      response: formatResponse(r.item.type, content, a?.response),
      answered,
      score,
      max,
      parts: {
        answer: { score: auto ? (a?.autoScore ?? 0) : (a?.manualScore ?? null), max: r.item.marks, auto },
        working: r.item.workingMarks > 0 ? { score: a?.workingScore ?? null, max: r.item.workingMarks } : null,
      },
      outcome,
      voidReason: voided,
      category: r.category,
      feedback: visibility.feedback ? (a?.feedback ?? null) : null,
      rubric: visibility.feedback
        ? (a?.rubricItemIds ?? [])
            .map((id) => rubricBy.get(id))
            .filter((x): x is NonNullable<typeof x> => !!x)
            .map((x) => ({ label: x.label, points: x.points, target: x.target, description: x.description }))
        : [],
      correctAnswer: visibility.solutions ? formatCorrectAnswer(r.item.type, content, r.item.answerKey) : null,
      explanation: visibility.solutions && typeof content.explanation === 'string' ? content.explanation : null,
    };
  });

  const aggregate = <K extends string>(keyOf: (it: ResultItem) => K | null) => {
    const map = new Map<K, { score: number; max: number; items: number }>();
    for (const it of items) {
      const k = keyOf(it);
      if (k === null || it.voidReason) continue;
      const cur = map.get(k) ?? { score: 0, max: 0, items: 0 };
      cur.score += it.score ?? 0;
      cur.max += it.max;
      cur.items++;
      map.set(k, cur);
    }
    return map;
  };
  const bySection = aggregate((it) => it.sectionId);
  const sections = sectionRows
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const v = bySection.get(s.id) ?? { score: 0, max: 0, items: 0 };
      return { id: s.id, title: s.title, score: round3(v.score), max: round3(v.max), percent: r1(percentOf(v.score, v.max)) };
    });
  const topics = [...aggregate((it) => it.category ?? 'General').entries()]
    .map(([category, v]) => ({ category, score: round3(v.score), max: round3(v.max), percent: r1(percentOf(v.score, v.max)), items: v.items }))
    .sort((a, b) => b.percent - a.percent);
  const strengths = topics.filter((t) => t.percent >= 70).map((t) => t.category);
  const weaknesses = topics.filter((t) => t.percent < 50).sort((a, b) => a.percent - b.percent).map((t) => t.category);

  const score = attempt.score ?? 0;
  const percent = r1(percentOf(score, attempt.maxScore));
  const cohortRows = await db
    .select({ id: attempts.id, score: attempts.score, maxScore: attempts.maxScore })
    .from(attempts)
    .where(and(eq(attempts.examId, exam.id), realAttempts, eq(attempts.status, 'submitted')));
  const cohort = cohortRows.filter((c) => c.maxScore > 0).map((c) => percentOf(c.score ?? 0, c.maxScore));
  const mine = percentOf(score, attempt.maxScore);
  const rank = cohort.length ? 1 + cohort.filter((p) => p > mine + 1e-9).length : null;

  return {
    attemptId: attempt.id,
    examId: exam.id,
    organization: { id: org?.id ?? exam.organizationId, name: org?.name ?? '' },
    exam: { title: exam.title, code: exam.code, passPercent: settings.passPercent, resultsVersion: exam.resultsVersion, publishedAt: exam.resultsPublishedAt },
    candidate: { name: person?.name ?? 'Candidate', rollNumber: person?.rollNumber ?? null, cohort: person?.cohort ?? null },
    submittedAt: attempt.submittedAt,
    submitReason: attempt.submitReason,
    score,
    maxScore: attempt.maxScore,
    percent,
    pass: settings.passPercent === null ? null : mine >= settings.passPercent - 1e-9,
    gradingStatus: attempt.gradingStatus,
    cohort: {
      size: cohort.length,
      percentile: cohort.length > 1 ? Math.round(percentileRank(mine, cohort)!) : null,
      rank,
      meanPercent: cohort.length ? r1(cohort.reduce((s, x) => s + x, 0) / cohort.length) : null,
    },
    sections,
    topics,
    strengths,
    weaknesses,
    items,
  };
}
