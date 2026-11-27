import { and, count, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { QUESTION_TYPES, isAutoGraded, type ExamStaffRole } from '@athena/shared';
import type { Database } from '../../db/client';
import { realAttempts } from '../../db/scopes';
import { attemptEvents, attemptItems, attempts, answers, disputes, examEnrollments, exams, examStaff, memberships, organizations, questions, users } from '../../db/schema';
import type { TenantAuthContext } from '../../types/auth';

/** Staff exam roles that grade (proctors never see grading). Mirrors the grading module. */
const GRADING_ROLES: readonly ExamStaffRole[] = ['owner', 'co_examiner', 'grader'];
const MANUAL_TYPES = QUESTION_TYPES.filter((t) => !isAutoGraded(t));
const OPEN_DISPUTE_STATUSES = ['open', 'under_review', 'needs_info', 'appealed'] as const;

interface VisibleExam {
  id: string;
  title: string;
  code: string | null;
  status: 'draft' | 'published' | 'archived';
  windowOpensAt: Date;
  windowClosesAt: Date;
  durationMinutes: number;
  createdBy: string | null;
  staffRole: ExamStaffRole | null;
}

/**
 * Everything StaffHome shows, scoped to the exams the caller can see: all of them with exams.view_all,
 * otherwise only those they are staff on. Sections the caller has no permission for come back as null.
 */
export class StaffDashboardService {
  constructor(private readonly db: Database) {}

  private async visibleExams(auth: TenantAuthContext): Promise<VisibleExam[]> {
    const orgId = auth.organization.id;
    const cols = {
      id: exams.id,
      title: exams.title,
      code: exams.code,
      status: exams.status,
      windowOpensAt: exams.windowOpensAt,
      windowClosesAt: exams.windowClosesAt,
      durationMinutes: exams.durationMinutes,
      createdBy: exams.createdBy,
      staffRole: examStaff.role,
    };
    const join = and(eq(examStaff.examId, exams.id), eq(examStaff.userId, auth.user.id));
    const where = and(eq(exams.organizationId, orgId), ne(exams.status, 'archived'));
    if (auth.permissions.has('exams.view_all')) {
      return this.db.select(cols).from(exams).leftJoin(examStaff, join).where(where);
    }
    return this.db.select(cols).from(exams).innerJoin(examStaff, join).where(where);
  }

  async get(auth: TenantAuthContext) {
    const orgId = auth.organization.id;
    const can = (p: Parameters<typeof auth.permissions.has>[0]) => auth.permissions.has(p);
    const now = new Date();
    const [all, [org]] = await Promise.all([
      this.visibleExams(auth),
      this.db.select({ branding: organizations.branding }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    ]);
    const ids = all.map((e) => e.id);
    const live = all.filter((e) => e.status === 'published' && e.windowOpensAt <= now && e.windowClosesAt > now);
    const upcoming = all
      .filter((e) => e.status === 'published' && e.windowOpensAt > now)
      .sort((a, b) => a.windowOpensAt.getTime() - b.windowOpensAt.getTime())
      .slice(0, 6);
    const viewAll = can('exams.view_all');
    const gradable = can('grading.grade') ? all.filter((e) => viewAll || (e.staffRole && GRADING_ROLES.includes(e.staffRole))) : [];

    const countIds = [...new Set([...live, ...upcoming].map((e) => e.id))];
    const day = new Date(now.getTime() - 24 * 3600_000);

    const [enrolled, attemptCounts, pending, incidents, incidentTotal, openDisputes, bank, checklist] = await Promise.all([
      countIds.length
        ? this.db
            .select({ examId: examEnrollments.examId, n: count() })
            .from(examEnrollments)
            .where(and(inArray(examEnrollments.examId, countIds), eq(examEnrollments.status, 'enrolled')))
            .groupBy(examEnrollments.examId)
        : [],
      live.length
        ? this.db
            .select({ examId: attempts.examId, status: attempts.status, n: count() })
            .from(attempts)
            .where(and(realAttempts, inArray(attempts.examId, live.map((e) => e.id))))
            .groupBy(attempts.examId, attempts.status)
        : [],
      gradable.length
        ? this.db
            .select({
              examId: attempts.examId,
              items: count(),
              attempts: sql<number>`count(distinct ${attempts.id})`.mapWith(Number),
            })
            .from(attemptItems)
            .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
            .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
            .where(
              and(
                realAttempts,
                eq(attempts.status, 'submitted'),
                inArray(attempts.examId, gradable.map((e) => e.id)),
                sql`((${inArray(attemptItems.type, MANUAL_TYPES)} and ${answers.manualScore} is null) or (${attemptItems.workingMarks} > 0 and ${answers.workingScore} is null))`,
              ),
            )
            .groupBy(attempts.examId)
        : [],
      ids.length && (can('monitor.view') || can('integrity.review'))
        ? this.db
            .select({
              id: attemptEvents.id,
              type: attemptEvents.type,
              severity: attemptEvents.severity,
              examId: attemptEvents.examId,
              attemptId: attemptEvents.attemptId,
              reviewStatus: attemptEvents.reviewStatus,
              createdAt: attemptEvents.createdAt,
              candidateName: users.name,
            })
            .from(attemptEvents)
            .innerJoin(attempts, eq(attempts.id, attemptEvents.attemptId))
            .innerJoin(users, eq(users.id, attempts.userId))
            .where(
              and(
                realAttempts,
                eq(attemptEvents.organizationId, orgId),
                inArray(attemptEvents.examId, ids),
                inArray(attemptEvents.severity, ['medium', 'high']),
                gte(attemptEvents.createdAt, day),
              ),
            )
            .orderBy(desc(attemptEvents.createdAt))
            .limit(8)
        : null,
      ids.length && (can('monitor.view') || can('integrity.review'))
        ? this.db
            .select({ n: count(), open: sql<number>`count(*) filter (where ${attemptEvents.reviewStatus} is null or ${attemptEvents.reviewStatus} = 'open')`.mapWith(Number) })
            .from(attemptEvents)
            .innerJoin(attempts, eq(attempts.id, attemptEvents.attemptId))
            .where(
              and(
                realAttempts,
                eq(attemptEvents.organizationId, orgId),
                inArray(attemptEvents.examId, ids),
                inArray(attemptEvents.severity, ['medium', 'high']),
                gte(attemptEvents.createdAt, day),
              ),
            )
        : null,
      ids.length && can('disputes.resolve')
        ? this.db
            .select({ n: count(), overdue: sql<number>`count(*) filter (where ${disputes.dueAt} < now())`.mapWith(Number) })
            .from(disputes)
            .where(and(eq(disputes.organizationId, orgId), inArray(disputes.examId, ids), inArray(disputes.status, [...OPEN_DISPUTE_STATUSES])))
        : null,
      can('questions.view')
        ? this.db
            .select({ n: count() })
            .from(questions)
            .where(and(eq(questions.organizationId, orgId), eq(questions.status, 'active')))
        : null,
      can('exams.create') ? this.checklist(auth) : null,
    ]);

    const enrolledBy = new Map(enrolled.map((r) => [r.examId, r.n]));
    const attemptsBy = new Map<string, Record<string, number>>();
    for (const r of attemptCounts) attemptsBy.set(r.examId, { ...(attemptsBy.get(r.examId) ?? {}), [r.status]: r.n });
    const titleOf = new Map(all.map((e) => [e.id, e]));

    const gradingExams = pending
      .map((p) => ({ id: p.examId, title: titleOf.get(p.examId)?.title ?? 'Exam', code: titleOf.get(p.examId)?.code ?? null, pendingItems: p.items, pendingAttempts: p.attempts }))
      .sort((a, b) => b.pendingItems - a.pendingItems);

    return {
      generatedAt: now.toISOString(),
      user: { name: auth.user.name, role: auth.membership.roleName, roleKey: auth.membership.roleKey },
      organization: {
        name: auth.organization.name,
        type: auth.organization.type,
        accentColor: org?.branding.accentColor ?? null,
        tagline: org?.branding.tagline ?? null,
      },
      live: live
        .sort((a, b) => a.windowClosesAt.getTime() - b.windowClosesAt.getTime())
        .map((e) => {
          const a = attemptsBy.get(e.id) ?? {};
          return {
            id: e.id,
            title: e.title,
            code: e.code,
            opensAt: e.windowOpensAt.toISOString(),
            closesAt: e.windowClosesAt.toISOString(),
            durationMinutes: e.durationMinutes,
            staffRole: e.staffRole,
            enrolled: enrolledBy.get(e.id) ?? 0,
            inProgress: a.in_progress ?? 0,
            awaitingSync: a.awaiting_sync ?? 0,
            submitted: a.submitted ?? 0,
          };
        }),
      grading: can('grading.grade') ? { pendingItems: gradingExams.reduce((s, e) => s + e.pendingItems, 0), exams: gradingExams } : null,
      upcoming: upcoming.map((e) => ({
        id: e.id,
        title: e.title,
        code: e.code,
        opensAt: e.windowOpensAt.toISOString(),
        closesAt: e.windowClosesAt.toISOString(),
        durationMinutes: e.durationMinutes,
        staffRole: e.staffRole,
        enrolled: enrolledBy.get(e.id) ?? 0,
      })),
      incidents: incidents
        ? {
            last24h: incidentTotal?.[0]?.n ?? 0,
            unreviewed: incidentTotal?.[0]?.open ?? 0,
            items: incidents.map((i) => ({
              ...i,
              examTitle: titleOf.get(i.examId)?.title ?? 'Exam',
              createdAt: i.createdAt.toISOString(),
            })),
          }
        : null,
      disputes: openDisputes ? { open: openDisputes[0]?.n ?? 0, overdue: openDisputes[0]?.overdue ?? 0 } : null,
      questionBank: bank ? { active: bank[0]?.n ?? 0 } : null,
      drafts: all.filter((e) => e.status === 'draft' && (e.createdBy === auth.user.id || e.staffRole === 'owner')).length,
      checklist,
    };
  }

  /**
   * First steps, each done once it has happened at least once. Someone who sees every exam (an admin)
   * is measured on the whole organization, so a brand-new tenant gets a setup guide and a busy one doesn't;
   * everyone else is measured on their own work, so a new examiner gets theirs.
   */
  private async checklist(auth: TenantAuthContext) {
    const orgId = auth.organization.id;
    const me = auth.user.id;
    const orgWide = auth.permissions.has('exams.view_all');
    const mineQ = orgWide ? undefined : eq(questions.createdBy, me);
    const mineE = orgWide ? undefined : eq(exams.createdBy, me);
    const [q, made, enrolledAny, published, people] = await Promise.all([
      this.db.select({ n: count() }).from(questions).where(and(eq(questions.organizationId, orgId), mineQ)),
      this.db.select({ n: count() }).from(exams).where(and(eq(exams.organizationId, orgId), mineE)),
      this.db
        .select({ n: count() })
        .from(examEnrollments)
        .innerJoin(exams, eq(exams.id, examEnrollments.examId))
        .where(and(eq(exams.organizationId, orgId), mineE)),
      this.db
        .select({ n: count() })
        .from(exams)
        .where(and(eq(exams.organizationId, orgId), mineE, eq(exams.status, 'published'))),
      auth.permissions.has('users.manage')
        ? this.db.select({ n: count() }).from(memberships).where(and(eq(memberships.organizationId, orgId), ne(memberships.userId, me)))
        : null,
    ]);
    return {
      scope: orgWide ? ('organization' as const) : ('mine' as const),
      people: people ? (people[0]?.n ?? 0) > 0 : null,
      questions: (q[0]?.n ?? 0) > 0,
      exam: (made[0]?.n ?? 0) > 0,
      candidates: (enrolledAny[0]?.n ?? 0) > 0,
      published: (published[0]?.n ?? 0) > 0,
    };
  }
}

