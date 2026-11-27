import { asc, eq, inArray, sql } from 'drizzle-orm';
import { markingSchemeSchema, type ExamSettings, type MarkingScheme } from '@athena/shared';
import type { Executor } from '../../db/client';
import { examQuestions, examSections, questions, questionVersions } from '../../db/schema';
import type { DeliverableQuestion, PaperInput, PaperSection } from '../../domain/paper';
import type { Json } from '../../domain/question-types/registry';

/** A question of the exam as the engine delivers it: the pinned version plus the exam-level overrides. */
export interface ExamPaperQuestion extends DeliverableQuestion {
  sectionId: string;
  markingOverride: Partial<MarkingScheme> | null;
}

export interface ExamPaperSection extends PaperSection<ExamPaperQuestion> {
  title: string;
  instructions: string | null;
}

/** Loads an exam's sections with their pinned question versions, ready for assemblePaper. Server side only. */
export async function loadExamPaper(db: Executor, examId: string): Promise<ExamPaperSection[]> {
  const sections = await db
    .select()
    .from(examSections)
    .where(eq(examSections.examId, examId))
    .orderBy(asc(examSections.position));
  const rows = await db
    .select({
      examQuestionId: examQuestions.id,
      sectionId: examQuestions.sectionId,
      questionId: examQuestions.questionId,
      questionVersionId: examQuestions.questionVersionId,
      marks: examQuestions.marks,
      position: examQuestions.position,
      markingOverride: examQuestions.marking,
      type: questions.type,
      difficulty: questions.difficulty,
      observedP: questions.observedP,
      observedN: questions.observedN,
      content: questionVersions.content,
      answerKey: questionVersions.answerKey,
    })
    .from(examQuestions)
    .innerJoin(questions, eq(questions.id, examQuestions.questionId))
    .innerJoin(questionVersions, eq(questionVersions.id, examQuestions.questionVersionId))
    .where(eq(examQuestions.examId, examId))
    .orderBy(asc(examQuestions.position));
  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    instructions: s.instructions,
    position: s.position,
    drawCount: s.drawCount,
    questions: rows
      .filter((q) => q.sectionId === s.id)
      .map((q) => ({ ...q, markingOverride: q.markingOverride ?? null })),
  }));
}

export const toPaperInput = (
  sections: ExamPaperSection[],
  settings: ExamSettings,
): PaperInput<ExamPaperQuestion> => ({
  sections,
  settings: {
    shuffleQuestions: settings.shuffleQuestions,
    shuffleOptions: settings.shuffleOptions,
    fairness: settings.fairness,
  },
});

/** Method marks a question awards when "show your working" is enabled in its content. */
export function workingMarksOf(content: Json): number {
  const working = content.working as { enabled?: boolean; marks?: number } | undefined;
  return working?.enabled ? Number(working.marks ?? 0) : 0;
}

/** Exam marking scheme with the per-question override applied. */
export const markingFor = (
  exam: MarkingScheme,
  override: Partial<MarkingScheme> | null,
): MarkingScheme => markingSchemeSchema.parse({ ...exam, ...(override ?? {}) });

export interface SectionShape {
  title: string;
  /** Questions a candidate receives from this section. */
  questionCount: number;
  /** Marks a candidate can earn in this section, including method marks. */
  marks: number;
}

/**
 * What each exam's paper looks like to a candidate (lobby and dashboard), without loading any content.
 * A pool contributes drawCount questions worth its average question value.
 */
export async function loadPaperShapes(
  db: Executor,
  examIds: string[],
): Promise<Map<string, SectionShape[]>> {
  const shapes = new Map<string, SectionShape[]>();
  if (examIds.length === 0) return shapes;
  const sections = await db
    .select()
    .from(examSections)
    .where(inArray(examSections.examId, examIds))
    .orderBy(asc(examSections.position));
  const rows = await db
    .select({
      sectionId: examQuestions.sectionId,
      marks: examQuestions.marks,
      workingMarks:
        sql<number>`case when (${questionVersions.content} -> 'working' ->> 'enabled')::boolean
        then coalesce((${questionVersions.content} -> 'working' ->> 'marks')::numeric, 0) else 0 end`.mapWith(
          Number,
        ),
    })
    .from(examQuestions)
    .innerJoin(questionVersions, eq(questionVersions.id, examQuestions.questionVersionId))
    .where(inArray(examQuestions.examId, examIds));
  for (const s of sections) {
    const values = rows.filter((r) => r.sectionId === s.id).map((r) => r.marks + r.workingMarks);
    const isPool = s.drawCount !== null && s.drawCount < values.length;
    const questionCount = isPool ? s.drawCount! : values.length;
    const marks = isPool
      ? (questionCount * values.reduce((a, b) => a + b, 0)) / values.length
      : values.reduce((a, b) => a + b, 0);
    const list = shapes.get(s.examId) ?? [];
    list.push({ title: s.title, questionCount, marks: Math.round(marks * 1000) / 1000 });
    shapes.set(s.examId, list);
  }
  return shapes;
}
