import { and, asc, count, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { QuestionType } from '@athena/shared';
import type { Executor } from '../../db/client';
import { attempts, examEnrollments, examQuestions, exams, examSections, questions, questionVersions, rubricItems } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { AppError, ConflictError, NotFoundError } from '../../lib/errors';
import { reviewErrorFields, reviewExam, type ReviewInput } from './exam-review';

export type ExamRow = typeof exams.$inferSelect;

export interface SnapshotItem {
  id: string;
  sectionId: string;
  questionId: string;
  questionVersionId: string;
  marks: number;
  position: number;
  title: string;
  type: QuestionType;
  difficulty: 'easy' | 'medium' | 'hard';
  bankStatus: 'active' | 'archived';
  leaked: boolean;
  pinnedVersion: number;
  latestVersion: number;
  observedP: number | null;
  stem: string;
  workingMarks: number;
  rubric: { answer: number; working: number };
}

export interface ExamSnapshot {
  exam: ExamRow;
  sections: (typeof examSections.$inferSelect)[];
  items: SnapshotItem[];
  enrolledCount: number;
  attempts: { total: number; inProgress: number; awaitingSync: number; submitted: number };
}

const pinned = alias(questionVersions, 'pinned');

/** Loads everything the review, the overview and the integrity guards need, in five small queries. */
export async function loadSnapshot(db: Executor, exam: ExamRow): Promise<ExamSnapshot> {
  const examId = exam.id;
  const sections = await db.select().from(examSections).where(eq(examSections.examId, examId)).orderBy(asc(examSections.position), asc(examSections.createdAt));
  const rows = await db
    .select({
      id: examQuestions.id,
      sectionId: examQuestions.sectionId,
      questionId: examQuestions.questionId,
      questionVersionId: examQuestions.questionVersionId,
      marks: examQuestions.marks,
      position: examQuestions.position,
      title: questions.title,
      type: questions.type,
      difficulty: questions.difficulty,
      bankStatus: questions.status,
      leakedAt: questions.leakedAt,
      latestVersion: questions.currentVersion,
      observedP: questions.observedP,
      pinnedVersion: pinned.version,
      stem: sql<string>`left(${pinned.content}->>'stem', 200)`,
      working: sql<{ enabled?: boolean; marks?: number } | null>`${pinned.content}->'working'`,
    })
    .from(examQuestions)
    .innerJoin(questions, eq(questions.id, examQuestions.questionId))
    .innerJoin(pinned, eq(pinned.id, examQuestions.questionVersionId))
    .where(eq(examQuestions.examId, examId))
    .orderBy(asc(examQuestions.position), asc(examQuestions.createdAt));
  const rubricRows = await db
    .select({ questionId: rubricItems.questionId, target: rubricItems.target, n: count() })
    .from(rubricItems)
    .where(eq(rubricItems.examId, examId))
    .groupBy(rubricItems.questionId, rubricItems.target);
  const rubric = new Map<string, { answer: number; working: number }>();
  for (const r of rubricRows) {
    const entry = rubric.get(r.questionId) ?? { answer: 0, working: 0 };
    entry[r.target === 'working' ? 'working' : 'answer'] += Number(r.n);
    rubric.set(r.questionId, entry);
  }
  const [enrolled] = await db
    .select({ n: count() })
    .from(examEnrollments)
    .where(and(eq(examEnrollments.examId, examId), eq(examEnrollments.status, 'enrolled')));
  const attemptRows = await db
    .select({ status: attempts.status, n: count() })
    .from(attempts)
    .where(and(eq(attempts.examId, examId), realAttempts))
    .groupBy(attempts.status);
  const byStatus = Object.fromEntries(attemptRows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;

  return {
    exam,
    sections,
    items: rows.map(({ leakedAt, working, ...r }) => ({
      ...r,
      leaked: !!leakedAt,
      workingMarks: working?.enabled ? Number(working.marks ?? 0) : 0,
      rubric: rubric.get(r.questionId) ?? { answer: 0, working: 0 },
    })),
    enrolledCount: Number(enrolled?.n ?? 0),
    attempts: {
      total: attemptRows.reduce((a, r) => a + Number(r.n), 0),
      inProgress: byStatus.in_progress ?? 0,
      awaitingSync: byStatus.awaiting_sync ?? 0,
      submitted: byStatus.submitted ?? 0,
    },
  };
}

export function reviewInput(s: ExamSnapshot): ReviewInput {
  return {
    exam: {
      status: s.exam.status,
      windowOpensAt: s.exam.windowOpensAt,
      windowClosesAt: s.exam.windowClosesAt,
      durationMinutes: s.exam.durationMinutes,
      totalMarks: s.exam.totalMarks,
    },
    sections: s.sections.map((x) => ({ id: x.id, title: x.title, position: x.position, drawCount: x.drawCount })),
    items: s.items,
    enrolledCount: s.enrolledCount,
  };
}

export async function realAttemptCount(db: Executor, examId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(attempts)
    .where(and(eq(attempts.examId, examId), realAttempts));
  return Number(row?.n ?? 0);
}

/** Re-reads the exam row under a lock so concurrent publish / edit requests serialise. */
export async function lockExam(tx: Executor, examId: string): Promise<ExamRow> {
  const [row] = await tx.select().from(exams).where(eq(exams.id, examId)).for('update');
  if (!row) throw new NotFoundError('Exam');
  return row;
}

export const startedMessage = (n: number) =>
  `${n} candidate${n === 1 ? ' has' : 's have'} already started this exam, so its questions, marks and timing are locked to keep every paper fair. ` +
  'You can still edit the title, description, instructions, access code and results policy.';

/**
 * The one guard for structural changes (sections, questions, marks, draw counts, total, timing):
 * archived exams are read-only and any real attempt locks the structure.
 */
export async function assertStructureEditable(tx: Executor, exam: ExamRow): Promise<void> {
  if (exam.status === 'archived') throw new ConflictError('Archived exams are read-only. Duplicate it to reuse its questions.', 'EXAM_ARCHIVED');
  const n = await realAttemptCount(tx, exam.id);
  if (n > 0) throw new AppError(409, 'EXAM_LOCKED', startedMessage(n));
}

/**
 * A published exam must stay publishable. Called at the end of a structural change inside its transaction;
 * throwing rolls the change back and explains what it would have broken.
 */
export async function assertStillPublishable(tx: Executor, examId: string): Promise<void> {
  const exam = await lockExam(tx, examId);
  if (exam.status !== 'published') return;
  const review = reviewExam(reviewInput(await loadSnapshot(tx, exam)));
  if (review.canPublish) return;
  throw new AppError(
    422,
    'EXAM_NOT_READY',
    `This exam is published, so every change must keep it ready: ${review.errors[0]!.message} Unpublish it to make several changes at once.`,
    reviewErrorFields(review),
  );
}
