import { and, eq } from 'drizzle-orm';
import type { ExamStaffRole } from '@athena/shared';
import type { Executor } from '../../db/client';
import { exams, examStaff } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import type { AuthContext } from '../../types/auth';

type ExamRow = typeof exams.$inferSelect;

/**
 * Exam-level authorization shared by every module.
 * - The exam must belong to the caller's active organization (otherwise it is reported as not found,
 *   so tenants cannot probe each other's ids).
 * - Callers holding `exams.view_all` (org admins) see every exam; everyone else must be on the exam's staff,
 *   optionally with one of the given staff roles.
 */
export async function loadExamForStaff(
  db: Executor,
  auth: AuthContext,
  examId: string,
  staffRoles?: readonly ExamStaffRole[],
): Promise<ExamRow> {
  if (!auth.organization) throw new NotFoundError('Exam');
  const [exam] = await db
    .select()
    .from(exams)
    .where(and(eq(exams.id, examId), eq(exams.organizationId, auth.organization.id)))
    .limit(1);
  if (!exam) throw new NotFoundError('Exam');
  if (auth.permissions.has('exams.view_all')) return exam;
  const [staff] = await db
    .select({ role: examStaff.role })
    .from(examStaff)
    .where(and(eq(examStaff.examId, examId), eq(examStaff.userId, auth.user.id)))
    .limit(1);
  if (!staff || (staffRoles && !staffRoles.includes(staff.role))) throw new NotFoundError('Exam');
  return exam;
}

export async function canAccessExam(db: Executor, auth: AuthContext, examId: string): Promise<boolean> {
  try {
    await loadExamForStaff(db, auth, examId);
    return true;
  } catch {
    return false;
  }
}
