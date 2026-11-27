import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { ExamStaffRole, LedgerAction } from '@athena/shared';
import type { Executor } from '../../db/client';
import { attempts, examStaff, exams, memberships, roles, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import type { TenantAuthContext } from '../../types/auth';
import { EXAMINER_ROLES, GRADING_ROLES, loadExamStructure, settingsOf } from '../grading/exam-structure';
import { pseudonym } from '../grading/response-format';
import { roleLabel } from './dispute.views';

type ExamRow = typeof exams.$inferSelect;

export const ACTION_LABEL: Record<LedgerAction, string> = {
  auto_grade: 'Marked automatically',
  manual_grade: 'Graded',
  rubric_change: 'Rubric updated',
  remedy: 'Question remedy',
  dispute_resolution: 'Dispute decision',
  offline_answers_accepted: 'Offline answers accepted',
  results_published: 'Results published',
  results_unpublished: 'Results withdrawn',
};

export const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 12) : null);

/** Candidate-facing role labels for staff ids (never names). */
export async function roleLabels(db: Executor, exam: Pick<ExamRow, 'id' | 'organizationId'>, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const staff = await db
    .select({ userId: examStaff.userId, role: examStaff.role })
    .from(examStaff)
    .where(and(eq(examStaff.examId, exam.id), inArray(examStaff.userId, unique)));
  const org = await db
    .select({ userId: memberships.userId, roleName: roles.name, roleKey: roles.key })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.organizationId, exam.organizationId), inArray(memberships.userId, unique)));
  for (const id of unique) {
    const s = staff.find((x) => x.userId === id);
    const o = org.find((x) => x.userId === id);
    out.set(id, roleLabel(s?.role, o?.roleKey === 'candidate' ? 'Candidate' : o?.roleName));
  }
  return out;
}

export async function userNames(db: Executor, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * How staff see a candidate: blind (the same pseudonym graders see) when the exam grades anonymously,
 * otherwise by name. Decisions about a dispute are made on the evidence, not the person.
 */
export async function candidateLabels(db: Executor, exam: ExamRow, rows: readonly { attemptId: string; name: string }[]) {
  const anonymous = settingsOf(exam).grading.anonymous;
  const out = new Map<string, { label: string; anonymous: boolean }>();
  if (!anonymous) {
    for (const r of rows) out.set(r.attemptId, { label: r.name, anonymous: false });
    return out;
  }
  const order = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(and(eq(attempts.examId, exam.id), realAttempts))
    .orderBy(asc(attempts.startedAt), asc(attempts.id));
  const index = new Map(order.map((r, i) => [r.id, i]));
  for (const r of rows) out.set(r.attemptId, { label: pseudonym(index.get(r.attemptId) ?? 0), anonymous: true });
  return out;
}

/** Staff question labels ("Q4: Free-fall impact speed") follow the exam's paper order, as in grading. */
export async function questionLabels(db: Executor, examId: string): Promise<Map<string, { label: string; title: string; number: number }>> {
  const structure = await loadExamStructure(db, examId);
  return new Map(structure.map((q) => [q.questionId, { label: q.label, title: q.title, number: q.number }]));
}

/** Owners and co-examiners: who is told about new disputes and appeals. */
export async function examinerIds(db: Executor, examId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: examStaff.userId })
    .from(examStaff)
    .where(and(eq(examStaff.examId, examId), inArray(examStaff.role, [...EXAMINER_ROLES])));
  return rows.map((r) => r.userId);
}

/** People who may review disputes on this exam: grading staff on it, or org-wide reviewers, holding disputes.resolve. */
export async function reviewersFor(db: Executor, exam: Pick<ExamRow, 'id' | 'organizationId'>) {
  const rows = await db
    .select({ id: users.id, name: users.name, examRole: examStaff.role, orgRole: roles.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(examStaff, and(eq(examStaff.examId, exam.id), eq(examStaff.userId, users.id)))
    .where(
      and(
        eq(memberships.organizationId, exam.organizationId),
        eq(memberships.status, 'active'),
        eq(users.status, 'active'),
        sql`'disputes.resolve' = any(${roles.permissions})`,
        or(inArray(examStaff.role, [...GRADING_ROLES]), sql`'exams.view_all' = any(${roles.permissions})`),
      ),
    )
    .orderBy(asc(users.name));
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.examRole ? roleLabel(r.examRole as ExamStaffRole, null) : r.orgRole }));
}

/** May this user change scores for everyone on the exam (remedies)? Owners, co-examiners and org-wide admins. */
export async function hasExaminerAccess(db: Executor, auth: TenantAuthContext, examId: string): Promise<boolean> {
  if (auth.permissions.has('exams.view_all')) return true;
  const [row] = await db
    .select({ role: examStaff.role })
    .from(examStaff)
    .where(and(eq(examStaff.examId, examId), eq(examStaff.userId, auth.user.id)))
    .limit(1);
  return !!row && (EXAMINER_ROLES as readonly string[]).includes(row.role);
}
