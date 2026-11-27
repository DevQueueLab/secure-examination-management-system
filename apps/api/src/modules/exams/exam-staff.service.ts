import { and, asc, eq, ilike, notExists, or, sql } from 'drizzle-orm';
import type { ExamStaffRole, Permission } from '@athena/shared';
import type { Database } from '../../db/client';
import { examStaff, memberships, roles, users } from '../../db/schema';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { likePattern } from '../questions/questions.service';
import { loadExamForStaff } from './exam-access';
import { EDITOR_ROLES } from './exam-roles';

/** The organization permission each exam role needs, so a proctor account can't be made a grader by mistake. */
const ROLE_REQUIRES: Record<Exclude<ExamStaffRole, 'owner'>, { permission: Permission; label: string }> = {
  co_examiner: { permission: 'exams.manage', label: 'manage exams' },
  grader: { permission: 'grading.grade', label: 'grade' },
  proctor: { permission: 'monitor.view', label: 'monitor exams' },
};

const STAFF_PERMISSIONS: Permission[] = ['exams.manage', 'grading.grade', 'monitor.view'];

/** Who works on an exam: the owner, co-examiners, graders and proctors. */
export class ExamStaffService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(examId: string) {
    const rows = await this.db
      .select({ userId: examStaff.userId, role: examStaff.role, addedAt: examStaff.createdAt, name: users.name, email: users.email })
      .from(examStaff)
      .innerJoin(users, eq(users.id, examStaff.userId))
      .where(eq(examStaff.examId, examId))
      .orderBy(sql`case ${examStaff.role} when 'owner' then 0 when 'co_examiner' then 1 when 'grader' then 2 else 3 end`, asc(users.name));
    return rows;
  }

  async listFor(auth: TenantAuthContext, examId: string) {
    await loadExamForStaff(this.db, auth, examId);
    return this.list(examId);
  }

  /** Organization members with a staff role who are not on this exam yet, with the exam roles they can take. */
  async eligible(auth: TenantAuthContext, examId: string, q?: string) {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const rows = await this.db
      .select({ userId: users.id, name: users.name, email: users.email, roleName: roles.name, permissions: roles.permissions })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(
        and(
          eq(memberships.organizationId, exam.organizationId),
          eq(memberships.status, 'active'),
          eq(users.status, 'active'),
          sql`${roles.permissions} && ${sql.raw(`ARRAY[${STAFF_PERMISSIONS.map((p) => `'${p}'`).join(',')}]::text[]`)}`,
          notExists(this.db.select({ one: sql`1` }).from(examStaff).where(and(eq(examStaff.examId, examId), eq(examStaff.userId, users.id)))),
          q ? or(ilike(users.name, likePattern(q)), ilike(users.email, likePattern(q))) : undefined,
        ),
      )
      .orderBy(asc(users.name))
      .limit(50);
    return rows.map(({ permissions, ...r }) => ({
      ...r,
      allowedRoles: (Object.keys(ROLE_REQUIRES) as (keyof typeof ROLE_REQUIRES)[]).filter((role) => permissions.includes(ROLE_REQUIRES[role].permission)),
    }));
  }

  async add(auth: TenantAuthContext, examId: string, input: { userId: string; role: Exclude<ExamStaffRole, 'owner'> }) {
    const exam = await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    if (exam.status === 'archived') throw new ConflictError('Archived exams are read-only.', 'EXAM_ARCHIVED');
    const [member] = await this.db
      .select({ name: users.name, roleName: roles.name, permissions: roles.permissions, status: memberships.status })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.organizationId, exam.organizationId), eq(memberships.userId, input.userId)))
      .limit(1);
    if (!member || member.status !== 'active') throw new ValidationError('This person is not an active member of your organization', { userId: 'Not an active member of your organization' });
    const need = ROLE_REQUIRES[input.role];
    if (!member.permissions.includes(need.permission)) {
      throw new ValidationError(`${member.name}'s role (${member.roleName}) can't ${need.label}`, { role: `${member.roleName}s can't ${need.label}. Choose another role or change their organization role first.` });
    }
    const [current] = await this.db.select({ role: examStaff.role }).from(examStaff).where(and(eq(examStaff.examId, examId), eq(examStaff.userId, input.userId))).limit(1);
    if (current?.role === 'owner') throw new ConflictError("The owner's role can't be changed.");
    await this.db
      .insert(examStaff)
      .values({ examId, userId: input.userId, role: input.role })
      .onConflictDoUpdate({ target: [examStaff.examId, examStaff.userId], set: { role: input.role } });
    await this.audit.record({
      organizationId: exam.organizationId,
      actorId: auth.user.id,
      action: current ? 'exam.staff_role_changed' : 'exam.staff_added',
      entityType: 'exam',
      entityId: examId,
      summary: `${current ? 'Changed' : 'Added'} ${member.name} as ${input.role.replace('_', '-')} on "${exam.title}"`,
      metadata: { userId: input.userId, role: input.role, previous: current?.role ?? null },
    });
    return this.list(examId);
  }

  async remove(auth: TenantAuthContext, examId: string, userId: string) {
    const exam = await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    const [current] = await this.db
      .select({ role: examStaff.role, name: users.name })
      .from(examStaff)
      .innerJoin(users, eq(users.id, examStaff.userId))
      .where(and(eq(examStaff.examId, examId), eq(examStaff.userId, userId)))
      .limit(1);
    if (!current) throw new NotFoundError('Staff member');
    if (current.role === 'owner') throw new AppError(409, 'CONFLICT', 'The owner cannot be removed from their exam.');
    await this.db.delete(examStaff).where(and(eq(examStaff.examId, examId), eq(examStaff.userId, userId)));
    await this.audit.record({
      organizationId: exam.organizationId,
      actorId: auth.user.id,
      action: 'exam.staff_removed',
      entityType: 'exam',
      entityId: examId,
      summary: `Removed ${current.name} (${current.role.replace('_', '-')}) from "${exam.title}"`,
      metadata: { userId, role: current.role },
    });
    return this.list(examId);
  }
}
