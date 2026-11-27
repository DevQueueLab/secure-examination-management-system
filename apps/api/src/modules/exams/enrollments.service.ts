import { and, asc, eq, ilike, inArray, isNotNull, ne, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client';
import { attempts, examEnrollments, importJobs, memberships, roles, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { provisionMember } from '../org/provision';
import { likePattern } from '../questions/questions.service';
import { loadExamForStaff } from './exam-access';
import { EDITOR_ROLES } from './exam-roles';
import { parseCandidates, type CandidateRowError } from './enrollment-import';
import type { accommodationSchema, EnrollmentImportRequest } from './exams.schemas';

type Accommodation = z.infer<typeof accommodationSchema>;

/** A candidate is any member whose role can take exams; staff roles never hold exams.take. */
const isCandidateRole = sql`'exams.take' = any(${roles.permissions})`;

/** Enrollment (FR-3.4): who may sit an exam, with per-candidate accommodations. */
export class EnrollmentService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(auth: TenantAuthContext, examId: string, filter: { q?: string; cohort?: string }) {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const conds: (SQL | undefined)[] = [eq(examEnrollments.examId, examId), eq(examEnrollments.status, 'enrolled')];
    if (filter.q) {
      const p = likePattern(filter.q);
      conds.push(or(ilike(users.name, p), ilike(users.email, p), ilike(memberships.externalId, p)));
    }
    if (filter.cohort) conds.push(eq(memberships.cohort, filter.cohort));
    const rows = await this.db
      .select({
        id: examEnrollments.id,
        userId: examEnrollments.userId,
        name: users.name,
        email: users.email,
        rollNumber: memberships.externalId,
        cohort: memberships.cohort,
        timeMultiplier: examEnrollments.timeMultiplier,
        extraMinutes: examEnrollments.extraMinutes,
        accommodationNote: examEnrollments.accommodationNote,
        enrolledAt: examEnrollments.createdAt,
        attemptId: attempts.id,
        attemptStatus: attempts.status,
        startedAt: attempts.startedAt,
        submittedAt: attempts.submittedAt,
        score: attempts.score,
        maxScore: attempts.maxScore,
        gradingStatus: attempts.gradingStatus,
      })
      .from(examEnrollments)
      .innerJoin(users, eq(users.id, examEnrollments.userId))
      .leftJoin(memberships, and(eq(memberships.userId, examEnrollments.userId), eq(memberships.organizationId, exam.organizationId)))
      // The real-attempt scope belongs in the join, so candidates without an attempt still appear.
      .leftJoin(attempts, and(eq(attempts.examId, examEnrollments.examId), eq(attempts.userId, examEnrollments.userId), realAttempts))
      .where(and(...conds))
      .orderBy(asc(users.name))
      .limit(5000);
    const cohorts = [...new Set(rows.map((r) => r.cohort).filter((c): c is string => !!c))].sort();
    return {
      items: rows.map(({ attemptId, attemptStatus, startedAt, submittedAt, score, maxScore, gradingStatus, ...r }) => ({
        ...r,
        hasAccommodation: r.timeMultiplier !== 1 || r.extraMinutes > 0 || !!r.accommodationNote,
        attempt: attemptId ? { id: attemptId, status: attemptStatus!, startedAt, submittedAt, score, maxScore, gradingStatus } : null,
      })),
      cohorts,
      total: rows.length,
    };
  }

  /** Candidates of the organization not yet enrolled, plus cohort counts for one-click cohort enrollment. */
  async eligible(auth: TenantAuthContext, examId: string, filter: { q?: string; cohort?: string; limit: number }) {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const notEnrolled = notExists(
      this.db
        .select({ one: sql`1` })
        .from(examEnrollments)
        .where(and(eq(examEnrollments.examId, examId), eq(examEnrollments.userId, memberships.userId), eq(examEnrollments.status, 'enrolled'))),
    );
    const base = and(eq(memberships.organizationId, exam.organizationId), eq(memberships.status, 'active'), eq(users.status, 'active'), isCandidateRole);
    const conds: (SQL | undefined)[] = [base, notEnrolled];
    if (filter.q) {
      const p = likePattern(filter.q);
      conds.push(or(ilike(users.name, p), ilike(users.email, p), ilike(memberships.externalId, p)));
    }
    if (filter.cohort) conds.push(eq(memberships.cohort, filter.cohort));
    const items = await this.db
      .select({ userId: users.id, name: users.name, email: users.email, rollNumber: memberships.externalId, cohort: memberships.cohort })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(...conds))
      .orderBy(asc(users.name))
      .limit(filter.limit);
    const cohorts = await this.db
      .select({
        cohort: memberships.cohort,
        members: sql<number>`count(*)`.mapWith(Number),
        available: sql<number>`count(*) filter (where not exists (select 1 from ${examEnrollments} where ${examEnrollments.examId} = ${examId} and ${examEnrollments.userId} = ${memberships.userId}))`.mapWith(Number),
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(base, isNotNull(memberships.cohort)))
      .groupBy(memberships.cohort)
      .orderBy(asc(memberships.cohort));
    return { items, cohorts: cohorts.map((c) => ({ cohort: c.cohort!, members: c.members, available: c.available })) };
  }

  async enroll(auth: TenantAuthContext, examId: string, input: { userIds?: string[]; cohort?: string }) {
    const exam = await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    if (exam.status === 'archived') throw new ConflictError('Archived exams are read-only.', 'EXAM_ARCHIVED');
    const ids = [...new Set(input.userIds ?? [])];
    const who: SQL[] = [];
    if (ids.length) who.push(inArray(memberships.userId, ids));
    if (input.cohort) who.push(eq(memberships.cohort, input.cohort));
    const candidates = await this.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.organizationId, exam.organizationId), eq(memberships.status, 'active'), eq(users.status, 'active'), isCandidateRole, or(...who)));
    const found = new Set(candidates.map((c) => c.userId));
    const notCandidates = ids.filter((id) => !found.has(id));
    if (notCandidates.length) {
      throw new ValidationError(`${notCandidates.length} of the selected people are not active candidates in your organization`, { userIds: 'Only active candidates can be enrolled' });
    }
    if (found.size === 0) throw new ValidationError('No candidates match', { cohort: 'No active candidates in this cohort' });
    const inserted = await this.db
      .insert(examEnrollments)
      .values([...found].map((userId) => ({ examId, userId, enrolledBy: auth.user.id })))
      .onConflictDoNothing()
      .returning({ id: examEnrollments.id });
    await this.audit.record({
      organizationId: exam.organizationId,
      actorId: auth.user.id,
      action: 'exam.candidates_enrolled',
      entityType: 'exam',
      entityId: examId,
      summary: `Enrolled ${inserted.length} candidate(s) in "${exam.title}"${input.cohort ? ` from ${input.cohort}` : ''}`,
      metadata: { enrolled: inserted.length, cohort: input.cohort ?? null },
    });
    return { enrolled: inserted.length, alreadyEnrolled: found.size - inserted.length };
  }

  async updateAccommodation(auth: TenantAuthContext, examId: string, enrollmentId: string, input: Accommodation) {
    const exam = await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    if (exam.status === 'archived') throw new ConflictError('Archived exams are read-only.', 'EXAM_ARCHIVED');
    const [row] = await this.db
      .select({ id: examEnrollments.id, userId: examEnrollments.userId, name: users.name, timeMultiplier: examEnrollments.timeMultiplier, extraMinutes: examEnrollments.extraMinutes, note: examEnrollments.accommodationNote })
      .from(examEnrollments)
      .innerJoin(users, eq(users.id, examEnrollments.userId))
      .where(and(eq(examEnrollments.id, enrollmentId), eq(examEnrollments.examId, examId)))
      .limit(1);
    if (!row) throw new NotFoundError('Enrollment');
    const next = {
      timeMultiplier: input.timeMultiplier ?? row.timeMultiplier,
      extraMinutes: input.extraMinutes ?? row.extraMinutes,
      accommodationNote: input.accommodationNote === undefined ? row.note : input.accommodationNote,
    };
    await this.db.update(examEnrollments).set(next).where(eq(examEnrollments.id, enrollmentId));
    const [active] = await this.db
      .select({ id: attempts.id })
      .from(attempts)
      .where(and(eq(attempts.examId, examId), eq(attempts.userId, row.userId), realAttempts, inArray(attempts.status, ['in_progress', 'awaiting_sync'])))
      .limit(1);
    await this.audit.record({
      organizationId: exam.organizationId,
      actorId: auth.user.id,
      action: 'exam.accommodation_updated',
      entityType: 'exam',
      entityId: examId,
      summary: `Set accommodation for ${row.name}: ${next.timeMultiplier}× time, +${next.extraMinutes} min`,
      metadata: { enrollmentId, userId: row.userId, before: { timeMultiplier: row.timeMultiplier, extraMinutes: row.extraMinutes }, after: next },
    });
    // A running attempt keeps the deadline it started with; the change applies to the next start.
    return { id: enrollmentId, ...next, hasActiveAttempt: !!active };
  }

  async remove(auth: TenantAuthContext, examId: string, enrollmentId: string) {
    const exam = await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    const [row] = await this.db
      .select({ id: examEnrollments.id, userId: examEnrollments.userId, name: users.name })
      .from(examEnrollments)
      .innerJoin(users, eq(users.id, examEnrollments.userId))
      .where(and(eq(examEnrollments.id, enrollmentId), eq(examEnrollments.examId, examId)))
      .limit(1);
    if (!row) throw new NotFoundError('Enrollment');
    const [attempt] = await this.db
      .select({ id: attempts.id })
      .from(attempts)
      .where(and(eq(attempts.examId, examId), eq(attempts.userId, row.userId), realAttempts))
      .limit(1);
    if (attempt) throw new AppError(409, 'HAS_ATTEMPT', `${row.name} has already started this exam, so the enrollment is kept with their attempt for the record.`);
    await this.db.delete(examEnrollments).where(eq(examEnrollments.id, enrollmentId));
    await this.audit.record({ organizationId: exam.organizationId, actorId: auth.user.id, action: 'exam.candidate_removed', entityType: 'exam', entityId: examId, summary: `Removed ${row.name} from "${exam.title}"`, metadata: { userId: row.userId } });
    return { removed: enrollmentId };
  }

  /**
   * Bulk import: creates missing accounts (provisionMember, role candidate) and enrolls everyone valid.
   * The dry run only reads. Temporary passwords of new accounts are returned once, on commit.
   */
  async import(auth: TenantAuthContext, examId: string, req: EnrollmentImportRequest) {
    const exam = await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    if (exam.status === 'archived') throw new ConflictError('Archived exams are read-only.', 'EXAM_ARCHIVED');
    const orgId = exam.organizationId;
    const parsed = parseCandidates(req.format, req.data);
    if ('fatal' in parsed) throw new ValidationError(Object.values(parsed.fatal)[0]!, parsed.fatal);
    const errors: CandidateRowError[] = [...parsed.errors];

    const emails = parsed.drafts.map((d) => d.email);
    const accounts = emails.length
      ? await this.db
          .select({
            userId: users.id,
            email: users.email,
            name: users.name,
            userStatus: users.status,
            membershipStatus: memberships.status,
            roleName: roles.name,
            canTake: sql<boolean>`coalesce('exams.take' = any(${roles.permissions}), false)`,
          })
          .from(users)
          .leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, orgId)))
          .leftJoin(roles, eq(roles.id, memberships.roleId))
          .where(inArray(users.email, emails))
      : [];
    const byEmail = new Map(accounts.map((a) => [a.email, a]));
    const rolls = parsed.drafts.map((d) => d.rollNumber).filter((r): r is string => !!r);
    const rollOwners = rolls.length
      ? await this.db
          .select({ roll: memberships.externalId, email: users.email, name: users.name })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.organizationId, orgId), inArray(sql`upper(${memberships.externalId})`, rolls.map((r) => r.toUpperCase()))))
      : [];
    const rollOwner = new Map(rollOwners.map((r) => [r.roll!.toUpperCase(), r]));
    const enrolledIds = new Set(
      (await this.db.select({ userId: examEnrollments.userId }).from(examEnrollments).where(eq(examEnrollments.examId, examId))).map((r) => r.userId),
    );

    type Status = 'new_account' | 'new_member' | 'existing_member';
    const valid: (typeof parsed.drafts[number] & { status: Status; alreadyEnrolled: boolean; displayName: string })[] = [];
    for (const d of parsed.drafts) {
      const acct = byEmail.get(d.email);
      const rowErr = (field: string, message: string) => errors.push({ row: d.row, field, message });
      const before = errors.length;
      if (acct?.membershipStatus && !acct.canTake) rowErr('email', `${d.email} belongs to a staff member (${acct.roleName}). Staff can't be enrolled as candidates.`);
      else if (acct?.userStatus === 'disabled') rowErr('email', 'This account is disabled');
      else if (acct?.membershipStatus === 'suspended') rowErr('email', 'This membership is suspended');
      if (!acct && !d.name) rowErr('name', 'Name is required for a new account');
      if (d.rollNumber) {
        const owner = rollOwner.get(d.rollNumber.toUpperCase());
        if (owner && owner.email !== d.email) rowErr('roll_number', `Roll number ${d.rollNumber} already belongs to ${owner.name}`);
      }
      if (errors.length > before) continue;
      const status: Status = !acct ? 'new_account' : acct.membershipStatus ? 'existing_member' : 'new_member';
      valid.push({ ...d, status, alreadyEnrolled: !!acct && enrolledIds.has(acct.userId), displayName: d.name || acct!.name });
    }

    errors.sort((a, b) => a.row - b.row);
    const summary = {
      format: req.format,
      total: parsed.total,
      valid: valid.length,
      invalid: new Set(errors.map((e) => e.row)).size,
      errors,
      counts: {
        newAccounts: valid.filter((v) => v.status === 'new_account').length,
        newMembers: valid.filter((v) => v.status === 'new_member').length,
        existingMembers: valid.filter((v) => v.status === 'existing_member').length,
        alreadyEnrolled: valid.filter((v) => v.alreadyEnrolled).length,
      },
      preview: valid.map((v) => ({ row: v.row, name: v.displayName, email: v.email, rollNumber: v.rollNumber, cohort: v.cohort, timeMultiplier: v.timeMultiplier ?? 1, status: v.status, alreadyEnrolled: v.alreadyEnrolled })),
    };
    if (req.dryRun) return { ...summary, dryRun: true as const, enrolled: 0, credentials: [] as { name: string; email: string; temporaryPassword: string }[], jobId: null };
    if (valid.length === 0) throw new ValidationError('Nothing to import: every row has errors', { data: 'Fix the errors and try again' });

    const result = await this.db.transaction(async (tx) => {
      const credentials: { name: string; email: string; temporaryPassword: string }[] = [];
      let enrolled = 0;
      for (const v of valid) {
        const p = await provisionMember(tx, { organizationId: orgId, email: v.email, name: v.displayName, roleKey: 'candidate', externalId: v.rollNumber, cohort: v.cohort });
        if (p.temporaryPassword) credentials.push({ name: v.displayName, email: v.email, temporaryPassword: p.temporaryPassword });
        const inserted = await tx
          .insert(examEnrollments)
          .values({ examId, userId: p.userId, enrolledBy: auth.user.id, timeMultiplier: v.timeMultiplier ?? 1 })
          .onConflictDoNothing()
          .returning({ id: examEnrollments.id });
        if (inserted.length) enrolled++;
        else if (v.timeMultiplier !== null) {
          await tx
            .update(examEnrollments)
            .set({ timeMultiplier: v.timeMultiplier, status: 'enrolled' })
            .where(and(eq(examEnrollments.examId, examId), eq(examEnrollments.userId, p.userId), ne(examEnrollments.timeMultiplier, v.timeMultiplier)));
        }
      }
      const [job] = await tx
        .insert(importJobs)
        .values({ organizationId: orgId, kind: 'candidates', filename: req.filename ?? null, totalRows: parsed.total, importedRows: valid.length, errorRows: summary.invalid, errors: errors.slice(0, 500), createdBy: auth.user.id })
        .returning({ id: importJobs.id });
      await this.audit.record(
        {
          organizationId: orgId,
          actorId: auth.user.id,
          action: 'exam.candidates_imported',
          entityType: 'exam',
          entityId: examId,
          summary: `Imported ${valid.length} of ${parsed.total} candidates into "${exam.title}" (${credentials.length} new account${credentials.length === 1 ? '' : 's'})`,
          metadata: { jobId: job!.id, enrolled, newAccounts: credentials.length, errorRows: summary.invalid },
        },
        tx,
      );
      return { credentials, enrolled, jobId: job!.id };
    });
    return { ...summary, dryRun: false as const, ...result };
  }
}
