import { and, asc, eq, inArray, max, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database, Executor } from '../../db/client';
import { examQuestions, examSections, questions, questionVersions } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { loadExamForStaff } from './exam-access';
import { EDITOR_ROLES } from './exam-roles';
import { assertStillPublishable, assertStructureEditable, lockExam, type ExamRow } from './exam-snapshot';
import type { addQuestionsSchema, examQuestionUpdateSchema, sectionCreateSchema, sectionUpdateSchema } from './exams.schemas';

type SectionCreate = z.infer<typeof sectionCreateSchema>;
type SectionUpdate = z.infer<typeof sectionUpdateSchema>;
type AddQuestions = z.infer<typeof addQuestionsSchema>;
type ExamQuestionUpdate = z.infer<typeof examQuestionUpdateSchema>;

/**
 * Sections ("fixed" or pools that draw N of M) and the questions pinned into them. Every change runs in one
 * transaction behind the same two guards: the structure is not locked by a started attempt, and a published
 * exam is still publishable afterwards.
 */
export class ExamStructureService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private async mutate<T>(auth: TenantAuthContext, examId: string, action: string, fn: (tx: Executor, exam: ExamRow) => Promise<{ result: T; summary: string; metadata?: Record<string, unknown> }>): Promise<T> {
    await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    return this.db.transaction(async (tx) => {
      const exam = await lockExam(tx, examId);
      await assertStructureEditable(tx, exam);
      const out = await fn(tx, exam);
      await assertStillPublishable(tx, examId);
      await this.audit.record({ organizationId: exam.organizationId, actorId: auth.user.id, action, entityType: 'exam', entityId: examId, summary: out.summary, metadata: out.metadata }, tx);
      return out.result;
    });
  }

  private async section(tx: Executor, examId: string, sectionId: string) {
    const [s] = await tx.select().from(examSections).where(and(eq(examSections.id, sectionId), eq(examSections.examId, examId))).limit(1);
    if (!s) throw new NotFoundError('Section');
    return s;
  }

  // ---------- sections ----------
  createSection(auth: TenantAuthContext, examId: string, input: SectionCreate) {
    return this.mutate(auth, examId, 'exam.section_created', async (tx) => {
      const [{ top }] = (await tx.select({ top: max(examSections.position) }).from(examSections).where(eq(examSections.examId, examId))) as [{ top: number | null }];
      const [s] = await tx
        .insert(examSections)
        .values({ examId, title: input.title, instructions: input.instructions ?? null, drawCount: input.drawCount ?? null, position: (top ?? -1) + 1 })
        .returning();
      return { result: s!, summary: `Added section "${input.title}"` };
    });
  }

  updateSection(auth: TenantAuthContext, examId: string, sectionId: string, input: SectionUpdate) {
    return this.mutate(auth, examId, 'exam.section_updated', async (tx) => {
      const s = await this.section(tx, examId, sectionId);
      const [row] = await tx
        .update(examSections)
        .set({
          title: input.title ?? s.title,
          instructions: input.instructions === undefined ? s.instructions : input.instructions,
          drawCount: input.drawCount === undefined ? s.drawCount : input.drawCount,
        })
        .where(eq(examSections.id, sectionId))
        .returning();
      return { result: row!, summary: `Updated section "${row!.title}"`, metadata: { drawCount: row!.drawCount } };
    });
  }

  deleteSection(auth: TenantAuthContext, examId: string, sectionId: string) {
    return this.mutate(auth, examId, 'exam.section_deleted', async (tx) => {
      const s = await this.section(tx, examId, sectionId);
      const removed = await tx.delete(examQuestions).where(eq(examQuestions.sectionId, sectionId)).returning({ id: examQuestions.id });
      await tx.delete(examSections).where(eq(examSections.id, sectionId));
      await this.renumberSections(tx, examId);
      return { result: { removedQuestions: removed.length }, summary: `Deleted section "${s.title}" and ${removed.length} question(s)` };
    });
  }

  reorderSections(auth: TenantAuthContext, examId: string, order: string[]) {
    return this.mutate(auth, examId, 'exam.sections_reordered', async (tx) => {
      const rows = await tx.select({ id: examSections.id }).from(examSections).where(eq(examSections.examId, examId));
      const ids = new Set(rows.map((r) => r.id));
      if (order.length !== ids.size || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
        throw new ValidationError('The new order must list every section of this exam once', { order: 'List every section exactly once' });
      }
      for (const [i, id] of order.entries()) await tx.update(examSections).set({ position: i }).where(eq(examSections.id, id));
      return { result: { order }, summary: 'Reordered sections' };
    });
  }

  // ---------- questions ----------
  /** Pins each bank question's current version into the section. Repeats and archived questions are skipped. */
  addQuestions(auth: TenantAuthContext, examId: string, input: AddQuestions) {
    return this.mutate(auth, examId, 'exam.questions_added', async (tx, exam) => {
      const section = await this.section(tx, examId, input.sectionId);
      const wanted = [...new Set(input.questionIds)];
      const bank = await tx
        .select({ id: questions.id, title: questions.title, status: questions.status, defaultMarks: questions.defaultMarks, versionId: questionVersions.id })
        .from(questions)
        .innerJoin(questionVersions, and(eq(questionVersions.questionId, questions.id), eq(questionVersions.version, questions.currentVersion)))
        .where(and(eq(questions.organizationId, exam.organizationId), inArray(questions.id, wanted)));
      const found = new Map(bank.map((b) => [b.id, b]));
      const missing = wanted.filter((id) => !found.has(id));
      if (missing.length) throw new ValidationError(`${missing.length} question(s) were not found in your bank`, { questionIds: 'Some questions were not found in your bank' });
      const already = new Set(
        (await tx.select({ questionId: examQuestions.questionId }).from(examQuestions).where(and(eq(examQuestions.examId, examId), inArray(examQuestions.questionId, wanted)))).map((r) => r.questionId),
      );
      const skipped: { questionId: string; title: string; reason: string }[] = [];
      const toAdd = wanted.filter((id) => {
        const b = found.get(id)!;
        if (already.has(id)) skipped.push({ questionId: id, title: b.title, reason: 'Already in this exam' });
        else if (b.status === 'archived') skipped.push({ questionId: id, title: b.title, reason: 'Archived in the bank' });
        else return true;
        return false;
      });
      const [{ top }] = (await tx.select({ top: max(examQuestions.position) }).from(examQuestions).where(eq(examQuestions.sectionId, section.id))) as [{ top: number | null }];
      const added = toAdd.length
        ? await tx
            .insert(examQuestions)
            .values(toAdd.map((id, i) => ({ examId, sectionId: section.id, questionId: id, questionVersionId: found.get(id)!.versionId, marks: found.get(id)!.defaultMarks, position: (top ?? -1) + 1 + i })))
            .onConflictDoNothing()
            .returning({ id: examQuestions.id, questionId: examQuestions.questionId })
        : [];
      return {
        result: { added, skipped },
        summary: `Added ${added.length} question(s) to "${section.title}"`,
        metadata: { sectionId: section.id, added: added.map((a) => a.questionId), skipped: skipped.length },
      };
    });
  }

  updateQuestion(auth: TenantAuthContext, examId: string, examQuestionId: string, input: ExamQuestionUpdate) {
    return this.mutate(auth, examId, 'exam.question_updated', async (tx) => {
      const [item] = await tx.select().from(examQuestions).where(and(eq(examQuestions.id, examQuestionId), eq(examQuestions.examId, examId))).limit(1);
      if (!item) throw new NotFoundError('Exam question');
      const targetSection = input.sectionId ? (await this.section(tx, examId, input.sectionId)).id : item.sectionId;
      const patch: Partial<typeof examQuestions.$inferInsert> = {};
      const changes: string[] = [];
      if (input.marks !== undefined && input.marks !== item.marks) {
        patch.marks = input.marks;
        changes.push(`marks from ${item.marks} to ${input.marks}`);
      }
      if (input.repin) {
        const [latest] = await tx
          .select({ versionId: questionVersions.id, version: questionVersions.version })
          .from(questions)
          .innerJoin(questionVersions, and(eq(questionVersions.questionId, questions.id), eq(questionVersions.version, questions.currentVersion)))
          .where(eq(questions.id, item.questionId))
          .limit(1);
        if (latest && latest.versionId !== item.questionVersionId) {
          patch.questionVersionId = latest.versionId;
          changes.push(`pinned v${latest.version}`);
        }
      }
      if (Object.keys(patch).length) await tx.update(examQuestions).set(patch).where(eq(examQuestions.id, item.id));
      if (targetSection !== item.sectionId || input.position !== undefined) {
        await this.move(tx, item.id, item.sectionId, targetSection, input.position);
        changes.push(targetSection !== item.sectionId ? 'moved section' : `position ${input.position}`);
        if (targetSection !== item.sectionId) await this.renumberItems(tx, item.sectionId);
      }
      const [row] = await tx.select().from(examQuestions).where(eq(examQuestions.id, item.id));
      return { result: row!, summary: `Updated a question: ${changes.join(', ') || 'no changes'}`, metadata: { examQuestionId, changes } };
    });
  }

  removeQuestion(auth: TenantAuthContext, examId: string, examQuestionId: string) {
    return this.mutate(auth, examId, 'exam.question_removed', async (tx) => {
      const [item] = await tx
        .select({ id: examQuestions.id, sectionId: examQuestions.sectionId, title: questions.title })
        .from(examQuestions)
        .innerJoin(questions, eq(questions.id, examQuestions.questionId))
        .where(and(eq(examQuestions.id, examQuestionId), eq(examQuestions.examId, examId)))
        .limit(1);
      if (!item) throw new NotFoundError('Exam question');
      await tx.delete(examQuestions).where(eq(examQuestions.id, item.id));
      await this.renumberItems(tx, item.sectionId);
      return { result: { removed: item.id }, summary: `Removed "${item.title}"` };
    });
  }

  /** Sets every question in a pool to the same marks (the review's one-click fix for unequal pools). */
  setSectionMarks(auth: TenantAuthContext, examId: string, sectionId: string, marks: number) {
    return this.mutate(auth, examId, 'exam.section_marks_set', async (tx) => {
      const s = await this.section(tx, examId, sectionId);
      const rows = await tx.update(examQuestions).set({ marks }).where(eq(examQuestions.sectionId, sectionId)).returning({ id: examQuestions.id });
      return { result: { updated: rows.length }, summary: `Set every question in "${s.title}" to ${marks} marks` };
    });
  }

  private async move(tx: Executor, itemId: string, fromSection: string, toSection: string, position: number | undefined) {
    const siblings = await tx
      .select({ id: examQuestions.id })
      .from(examQuestions)
      .where(eq(examQuestions.sectionId, toSection))
      .orderBy(asc(examQuestions.position), asc(examQuestions.createdAt));
    const ids = siblings.map((s) => s.id).filter((id) => id !== itemId);
    const at = Math.max(0, Math.min(position ?? ids.length, ids.length));
    ids.splice(at, 0, itemId);
    if (fromSection !== toSection) await tx.update(examQuestions).set({ sectionId: toSection }).where(eq(examQuestions.id, itemId));
    await this.writePositions(tx, ids);
  }

  private async renumberItems(tx: Executor, sectionId: string) {
    const rows = await tx.select({ id: examQuestions.id }).from(examQuestions).where(eq(examQuestions.sectionId, sectionId)).orderBy(asc(examQuestions.position), asc(examQuestions.createdAt));
    await this.writePositions(tx, rows.map((r) => r.id));
  }

  private async renumberSections(tx: Executor, examId: string) {
    const rows = await tx.select({ id: examSections.id }).from(examSections).where(eq(examSections.examId, examId)).orderBy(asc(examSections.position), asc(examSections.createdAt));
    for (const [i, r] of rows.entries()) await tx.update(examSections).set({ position: i }).where(eq(examSections.id, r.id));
  }

  /** One statement: position = index in the given list. */
  private async writePositions(tx: Executor, ids: string[]) {
    if (ids.length === 0) return;
    const cases = sql.join(
      ids.map((id, i) => sql`when ${id}::uuid then ${i}::int`),
      sql` `,
    );
    await tx
      .update(examQuestions)
      .set({ position: sql`case ${examQuestions.id} ${cases} end` })
      .where(inArray(examQuestions.id, ids));
  }
}
