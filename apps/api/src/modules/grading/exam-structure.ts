import { asc, eq, inArray } from 'drizzle-orm';
import { DEFAULT_EXAM_SETTINGS, examSettingsSchema, type ExamSettings, type ExamStaffRole, type QuestionType } from '@athena/shared';
import type { Executor } from '../../db/client';
import { examQuestions, examSections, questionCategories, questions, questionVersions, type exams } from '../../db/schema';

/** Staff roles that may grade, read results and analytics. Proctors never see scores. */
export const GRADING_ROLES: readonly ExamStaffRole[] = ['owner', 'co_examiner', 'grader'];
/** Staff roles that may publish results or change rubrics' consequences for everyone. */
export const EXAMINER_ROLES: readonly ExamStaffRole[] = ['owner', 'co_examiner'];

export function settingsOf(exam: Pick<typeof exams.$inferSelect, 'settings'>): ExamSettings {
  const parsed = examSettingsSchema.safeParse(exam.settings ?? {});
  return parsed.success ? parsed.data : DEFAULT_EXAM_SETTINGS;
}

export interface ExamQuestionInfo {
  questionId: string;
  number: number;
  /** "Q4": numbering follows sections, then question order within each section. */
  label: string;
  title: string;
  type: QuestionType;
  marks: number;
  /** Method marks from the pinned version ("show your working"). */
  workingMarks: number;
  sectionId: string;
  sectionTitle: string;
  category: string | null;
  versionId: string;
  /** Pinned version content (authored order of options; candidate-safe). */
  content: Record<string, unknown>;
}

/** Every question of an exam in paper order, with its section, category and pinned version. */
export async function loadExamStructure(db: Executor, examId: string): Promise<ExamQuestionInfo[]> {
  const rows = await db
    .select({
      questionId: examQuestions.questionId,
      marks: examQuestions.marks,
      versionId: examQuestions.questionVersionId,
      sectionId: examSections.id,
      sectionTitle: examSections.title,
      title: questions.title,
      type: questions.type,
      category: questionCategories.name,
    })
    .from(examQuestions)
    .innerJoin(examSections, eq(examSections.id, examQuestions.sectionId))
    .innerJoin(questions, eq(questions.id, examQuestions.questionId))
    .leftJoin(questionCategories, eq(questionCategories.id, questions.categoryId))
    .where(eq(examQuestions.examId, examId))
    .orderBy(asc(examSections.position), asc(examQuestions.position), asc(examQuestions.createdAt));

  const versionIds = [...new Set(rows.map((r) => r.versionId))];
  const versions = versionIds.length
    ? await db.select({ id: questionVersions.id, content: questionVersions.content }).from(questionVersions).where(inArray(questionVersions.id, versionIds))
    : [];
  const contentById = new Map(versions.map((v) => [v.id, v.content]));

  return rows.map((r, i) => {
    const content = contentById.get(r.versionId) ?? {};
    const working = content.working as { enabled?: boolean; marks?: number } | undefined;
    return {
      questionId: r.questionId,
      number: i + 1,
      label: `Q${i + 1}`,
      title: r.title,
      type: r.type,
      marks: r.marks,
      workingMarks: working?.enabled ? Number(working.marks ?? 0) : 0,
      sectionId: r.sectionId,
      sectionTitle: r.sectionTitle,
      category: r.category,
      versionId: r.versionId,
      content,
    };
  });
}

/** Parts a human grades: written/code answers, and method marks on any item that awards them. */
export function humanParts(type: QuestionType, workingMarks: number): ('answer' | 'working')[] {
  const parts: ('answer' | 'working')[] = [];
  if (type === 'long_text' || type === 'code') parts.push('answer');
  if (workingMarks > 0) parts.push('working');
  return parts;
}
