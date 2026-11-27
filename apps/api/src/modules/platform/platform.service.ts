import { and, asc, count, desc, eq, gt, gte, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  EXAM_PHASES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  SYSTEM_ROLES,
  SYSTEM_ROLE_KEYS,
  type ExamPhase,
  type OrganizationStatus,
  type OrganizationType,
} from '@athena/shared';
import type { Database } from '../../db/client';
import { realAttempts } from '../../db/scopes';
import { attempts, auditLogs, exams, memberships, organizations, outages, questions, roles, sessions, users } from '../../db/schema';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { AuditService } from '../audit/audit.service';
import type { Realtime } from '../../realtime/realtime';
import { notify } from '../notifications/notify';
import { isUniqueViolation } from '../org/access';
import { provisionMember } from '../org/provision';
import { normalizeHex } from '../org/settings.service';

export interface PlatformActor {
  userId: string;
  ip?: string;
}

/** Addresses that would collide with routes or read as official. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'athena', 'auth', 'dashboard', 'help', 'login', 'logout', 'new', 'platform', 'public', 'root',
  'settings', 'sign-in', 'signin', 'signup', 'sign-up', 'static', 'status', 'support', 'system', 'verify', 'www',
]);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Lifecycle phase in SQL, identical to examPhase() in @athena/shared (server time). */
const PHASE_SQL = sql<ExamPhase>`case
  when ${exams.status} = 'draft' then 'draft'
  when ${exams.status} = 'archived' then 'archived'
  when now() < ${exams.windowOpensAt} then 'scheduled'
  when now() < ${exams.windowClosesAt} then 'ongoing'
  else 'completed' end`;

const startedAt = new Date();
const ROLE_ORDER = sql.raw(`array_position(array[${SYSTEM_ROLE_KEYS.map((k) => `'${k}'`).join(',')}]::text[], "roles"."key")`);

/**
 * Tenant lifecycle for platform administrators. Privacy by design: everything here is aggregate counts and
 * tenant metadata. No query in this service reads exam content, questions, answers or scores.
 */
export class PlatformService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly realtime: Realtime,
  ) {}

  async overview() {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const twoWeeks = new Date(today.getTime() - 13 * 86_400_000);

    const dbStart = performance.now();
    let database: { status: 'ok' | 'down'; latencyMs: number | null; sizeBytes: number | null; connections: number | null; version: string | null };
    try {
      const { rows } = await this.db.execute<{ size: string; connections: string; version: string }>(
        sql`select pg_database_size(current_database())::text as size,
                   (select count(*) from pg_stat_activity where datname = current_database())::text as connections,
                   current_setting('server_version') as version`,
      );
      database = {
        status: 'ok',
        latencyMs: Math.round((performance.now() - dbStart) * 10) / 10,
        sizeBytes: Number(rows[0]?.size ?? 0),
        connections: Number(rows[0]?.connections ?? 0),
        version: rows[0]?.version ?? null,
      };
    } catch {
      database = { status: 'down', latencyMs: null, sizeBytes: null, connections: null, version: null };
    }

    const [tenantRows, [userTotals], phaseRows, [today_], [live], [outage], [outages30d], series, [activeSessions]] = await Promise.all([
      this.db.select({ type: organizations.type, status: organizations.status, n: count() }).from(organizations).groupBy(organizations.type, organizations.status),
      this.db
        .select({
          total: count(),
          signedInWeek: sql<number>`count(*) filter (where ${users.lastLoginAt} > now() - interval '7 days')`.mapWith(Number),
        })
        .from(users)
        .where(eq(users.isPlatformAdmin, false)),
      this.db.select({ phase: PHASE_SQL, n: count() }).from(exams).groupBy(PHASE_SQL),
      this.db.select({ n: count() }).from(attempts).where(and(realAttempts, gte(attempts.startedAt, today))),
      this.db
        .select({ n: count() })
        .from(attempts)
        .where(and(realAttempts, eq(attempts.status, 'in_progress'), gt(attempts.deadlineAt, now))),
      this.db.select().from(outages).orderBy(desc(outages.endedAt)).limit(1),
      this.db.select({ n: count() }).from(outages).where(gte(outages.endedAt, new Date(now.getTime() - 30 * 86_400_000))),
      this.db
        .select({ day: sql<string>`to_char(date_trunc('day', ${attempts.startedAt}), 'YYYY-MM-DD')`, n: count() })
        .from(attempts)
        .where(and(realAttempts, gte(attempts.startedAt, twoWeeks)))
        .groupBy(sql`date_trunc('day', ${attempts.startedAt})`),
      this.db
        .select({ n: count() })
        .from(sessions)
        .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.lastSeenAt, new Date(now.getTime() - 15 * 60_000)))),
    ]);

    const byType = Object.fromEntries(ORGANIZATION_TYPES.map((t) => [t, 0])) as Record<OrganizationType, number>;
    const byStatus = Object.fromEntries(ORGANIZATION_STATUSES.map((s) => [s, 0])) as Record<OrganizationStatus, number>;
    for (const r of tenantRows) {
      byType[r.type] += r.n;
      byStatus[r.status] += r.n;
    }
    const examsByPhase = Object.fromEntries(EXAM_PHASES.map((p) => [p, 0])) as Record<ExamPhase, number>;
    for (const r of phaseRows) examsByPhase[r.phase] = r.n;

    const perDay = new Map(series.map((s) => [s.day, s.n]));
    const attemptsByDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(twoWeeks.getTime() + i * 86_400_000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { day: key, attempts: perDay.get(key) ?? 0 };
    });

    return {
      generatedAt: now.toISOString(),
      tenants: { total: byType.institution + byType.competition, byType, byStatus, matrix: tenantRows },
      users: { total: userTotals?.total ?? 0, signedInLast7Days: userTotals?.signedInWeek ?? 0, activeSessions: activeSessions?.n ?? 0 },
      exams: { total: Object.values(examsByPhase).reduce((a, b) => a + b, 0), byPhase: examsByPhase },
      attempts: { today: today_?.n ?? 0, inProgressNow: live?.n ?? 0, last14Days: attemptsByDay },
      lastOutage: outage
        ? {
            startedAt: outage.startedAt.toISOString(),
            endedAt: outage.endedAt.toISOString(),
            durationSeconds: outage.durationSeconds,
            compensatedAttempts: outage.compensatedAttempts,
          }
        : null,
      outagesLast30Days: outages30d?.n ?? 0,
      database,
      api: {
        status: 'ok' as const,
        uptimeSeconds: Math.round(process.uptime()),
        startedAt: startedAt.toISOString(),
        node: process.version,
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      },
    };
  }

  private countsSelect() {
    return {
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      type: organizations.type,
      status: organizations.status,
      contactEmail: organizations.contactEmail,
      branding: organizations.branding,
      createdAt: organizations.createdAt,
      // Correlated subqueries spell out "organizations"."id": in a single-table select Drizzle drops the qualifier.
      members: sql<number>`(select count(*) from memberships m where m.organization_id = "organizations"."id")`.mapWith(Number),
      candidates: sql<number>`(select count(*) from memberships m join roles r on r.id = m.role_id where m.organization_id = "organizations"."id" and r.key = 'candidate')`.mapWith(Number),
      exams: sql<number>`(select count(*) from exams e where e.organization_id = "organizations"."id")`.mapWith(Number),
      liveExams: sql<number>`(select count(*) from exams e where e.organization_id = "organizations"."id" and e.status = 'published' and now() >= e.window_opens_at and now() < e.window_closes_at)`.mapWith(Number),
      lastActivityAt: sql<Date | null>`(select max(a.created_at) from audit_logs a where a.organization_id = "organizations"."id")`.mapWith((v) => (v ? new Date(v) : null)),
    };
  }

  async listOrganizations(q: { q?: string; type?: OrganizationType; status?: OrganizationStatus; page: number; pageSize: number }) {
    const conds: (SQL | undefined)[] = [];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(organizations.name, like), ilike(organizations.slug, like), ilike(organizations.contactEmail, like)));
    }
    if (q.type) conds.push(eq(organizations.type, q.type));
    if (q.status) conds.push(eq(organizations.status, q.status));
    const where = and(...conds);
    const [rows, [total], facetRows] = await Promise.all([
      this.db
        .select(this.countsSelect())
        .from(organizations)
        .where(where)
        .orderBy(desc(organizations.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(organizations).where(where),
      this.db.select({ type: organizations.type, status: organizations.status, n: count() }).from(organizations).groupBy(organizations.type, organizations.status),
    ]);
    const facets = { all: 0, institution: 0, competition: 0, active: 0, suspended: 0 };
    for (const f of facetRows) {
      facets.all += f.n;
      facets[f.type] += f.n;
      facets[f.status] += f.n;
    }
    return {
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastActivityAt: r.lastActivityAt?.toISOString() ?? null })),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
      facets,
    };
  }

  async slugAvailability(raw: string) {
    const slug = raw.trim().toLowerCase();
    if (slug.length < 3) return { slug, available: false, reason: 'Use at least 3 characters' };
    if (slug.length > 40) return { slug, available: false, reason: 'Use at most 40 characters' };
    if (!SLUG_PATTERN.test(slug)) return { slug, available: false, reason: 'Use lowercase letters, numbers and single hyphens' };
    if (RESERVED_SLUGS.has(slug)) return { slug, available: false, reason: 'That address is reserved', suggestion: await this.freeSlug(`${slug}-org`) };
    const [taken] = await this.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (taken) return { slug, available: false, reason: 'Another organization already uses this address', suggestion: await this.freeSlug(slug) };
    return { slug, available: true };
  }

  private async freeSlug(base: string): Promise<string> {
    const rows = await this.db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(or(eq(organizations.slug, base), ilike(organizations.slug, `${escapeLike(base)}-%`)));
    const taken = new Set(rows.map((r) => r.slug));
    if (!taken.has(base) && !RESERVED_SLUGS.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  /**
   * Onboards a tenant in one transaction: the organization, its system roles (same definitions as the seed)
   * and its first admin through provisionMember. The admin's temporary password is returned once.
   */
  async onboard(
    actor: PlatformActor,
    input: { name: string; slug: string; type: OrganizationType; contactEmail: string; adminName: string; adminEmail: string },
  ) {
    const check = await this.slugAvailability(input.slug);
    if (!check.available) {
      const taken = check.reason?.startsWith('Another');
      throw new AppError(taken ? 409 : 422, taken ? 'SLUG_TAKEN' : 'VALIDATION_ERROR', check.reason!, { slug: check.reason! });
    }
    const adminEmail = input.adminEmail.trim().toLowerCase();
    try {
      return await this.db.transaction(async (tx) => {
        const [existingUser] = await tx.select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.email, adminEmail)).limit(1);
        if (existingUser?.isPlatformAdmin) {
          throw new ValidationError('Platform administrators cannot administer a tenant', {
            adminEmail: 'This email belongs to a platform administrator. Use the tenant’s own admin.',
          });
        }
        const [org] = await tx
          .insert(organizations)
          .values({ name: input.name, slug: check.slug, type: input.type, contactEmail: input.contactEmail.toLowerCase(), branding: {}, createdBy: actor.userId })
          .returning();
        await tx.insert(roles).values(
          SYSTEM_ROLE_KEYS.map((key) => ({
            organizationId: org!.id,
            key,
            name: SYSTEM_ROLES[key].name,
            description: SYSTEM_ROLES[key].description,
            permissions: SYSTEM_ROLES[key].permissions,
            isSystem: true,
          })),
        );
        const admin = await provisionMember(tx, { organizationId: org!.id, email: adminEmail, name: input.adminName, roleKey: 'org_admin' });
        await this.audit.record(
          {
            organizationId: org!.id,
            actorId: actor.userId,
            action: 'platform.organization_onboarded',
            entityType: 'organization',
            entityId: org!.id,
            summary: `onboarded ${org!.name} as ${input.type === 'institution' ? 'an institution' : 'a competition organizer'}`,
            metadata: { slug: org!.slug, type: input.type, adminEmail, existingAccount: !admin.createdUser },
            ip: actor.ip,
          },
          tx,
        );
        if (!admin.createdUser) {
          await notify(
            tx,
            {
              userId: admin.userId,
              organizationId: org!.id,
              kind: 'membership.added',
              title: `You are the admin of ${org!.name}`,
              body: 'Switch to it from the organization menu to invite people and set up roles.',
              link: '/people',
            },
            this.realtime,
          );
        }
        return {
          organization: { id: org!.id, name: org!.name, slug: org!.slug, type: org!.type, status: org!.status, contactEmail: org!.contactEmail },
          admin: { userId: admin.userId, name: input.adminName, email: adminEmail, existingAccount: !admin.createdUser },
          temporaryPassword: admin.temporaryPassword ?? null,
        };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, 'SLUG_TAKEN', 'Another organization already uses this address', { slug: 'Another organization already uses this address' });
      throw err;
    }
  }

  private async load(id: string) {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!org) throw new NotFoundError('Organization');
    return org;
  }

  async getOrganization(id: string) {
    const [org] = await this.db.select(this.countsSelect()).from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!org) throw new NotFoundError('Organization');
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [creator, admins, roleCounts, statusCounts, phaseRows, [questionCount], attemptStats, suspension, activity] = await Promise.all([
      this.db
        .select({ name: users.name })
        .from(users)
        .innerJoin(organizations, eq(organizations.createdBy, users.id))
        .where(eq(organizations.id, id))
        .limit(1),
      this.db
        .select({ membershipId: memberships.id, userId: users.id, name: users.name, email: users.email, status: memberships.status, lastLoginAt: users.lastLoginAt })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.organizationId, id), eq(roles.key, 'org_admin')))
        .orderBy(asc(users.name)),
      this.db
        .select({ key: roles.key, name: roles.name, isSystem: roles.isSystem, n: count(memberships.id) })
        .from(roles)
        .leftJoin(memberships, eq(memberships.roleId, roles.id))
        .where(eq(roles.organizationId, id))
        .groupBy(roles.id)
        .orderBy(sql`${ROLE_ORDER} nulls last`, asc(roles.name)),
      this.db.select({ status: memberships.status, n: count() }).from(memberships).where(eq(memberships.organizationId, id)).groupBy(memberships.status),
      this.db.select({ phase: PHASE_SQL, n: count() }).from(exams).where(eq(exams.organizationId, id)).groupBy(PHASE_SQL),
      this.db.select({ n: count() }).from(questions).where(and(eq(questions.organizationId, id), ne(questions.status, 'archived'))),
      this.db
        .select({
          total: count(),
          lastWeek: sql<number>`count(*) filter (where ${attempts.startedAt} >= ${weekAgo})`.mapWith(Number),
          inProgressNow: sql<number>`count(*) filter (where ${attempts.status} = 'in_progress' and ${attempts.deadlineAt} > now())`.mapWith(Number),
        })
        .from(attempts)
        .where(and(realAttempts, eq(attempts.organizationId, id))),
      this.db
        .select({ createdAt: auditLogs.createdAt, metadata: auditLogs.metadata, actorName: users.name })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(and(eq(auditLogs.organizationId, id), eq(auditLogs.action, 'platform.organization_suspended')))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1),
      this.db
        .select({ id: auditLogs.id, action: auditLogs.action, summary: auditLogs.summary, createdAt: auditLogs.createdAt, actorName: users.name, metadata: auditLogs.metadata })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(and(eq(auditLogs.organizationId, id), sql`${auditLogs.action} like 'platform.%'`))
        .orderBy(desc(auditLogs.createdAt))
        .limit(20),
    ]);

    const examsByPhase = Object.fromEntries(EXAM_PHASES.map((p) => [p, 0])) as Record<ExamPhase, number>;
    for (const r of phaseRows) examsByPhase[r.phase] = r.n;
    const stats = attemptStats[0];

    return {
      ...org,
      createdAt: org.createdAt.toISOString(),
      lastActivityAt: org.lastActivityAt?.toISOString() ?? null,
      createdBy: creator[0]?.name ?? null,
      suspension:
        org.status === 'suspended' && suspension[0]
          ? { at: suspension[0].createdAt.toISOString(), by: suspension[0].actorName, reason: String(suspension[0].metadata.reason ?? '') }
          : null,
      admins: admins.map((a) => ({ ...a, lastLoginAt: a.lastLoginAt?.toISOString() ?? null })),
      counts: {
        members: org.members,
        activeMembers: statusCounts.find((s) => s.status === 'active')?.n ?? 0,
        suspendedMembers: statusCounts.find((s) => s.status === 'suspended')?.n ?? 0,
        byRole: roleCounts.map((r) => ({ key: r.key, name: r.name, isSystem: r.isSystem, members: r.n })),
        exams: { total: org.exams, byPhase: examsByPhase },
        questions: questionCount?.n ?? 0,
        attempts: { total: stats?.total ?? 0, lastWeek: stats?.lastWeek ?? 0, inProgressNow: stats?.inProgressNow ?? 0 },
      },
      activity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
  }

  async updateOrganization(
    actor: PlatformActor,
    id: string,
    patch: { name?: string; contactEmail?: string | null; branding?: { accentColor?: string | null; tagline?: string | null } },
  ) {
    const org = await this.load(id);
    const branding = { ...org.branding };
    const changed: string[] = [];
    if (patch.branding?.accentColor !== undefined) {
      const next = patch.branding.accentColor ? normalizeHex(patch.branding.accentColor) : undefined;
      if (next !== branding.accentColor) changed.push('accent colour');
      if (next) branding.accentColor = next;
      else delete branding.accentColor;
    }
    if (patch.branding?.tagline !== undefined) {
      const next = patch.branding.tagline?.trim() || undefined;
      if (next !== branding.tagline) changed.push('tagline');
      if (next) branding.tagline = next;
      else delete branding.tagline;
    }
    const set: Partial<typeof organizations.$inferInsert> = { branding };
    if (patch.name !== undefined && patch.name !== org.name) {
      set.name = patch.name;
      changed.push('name');
    }
    if (patch.contactEmail !== undefined && (patch.contactEmail || null) !== org.contactEmail) {
      set.contactEmail = patch.contactEmail || null;
      changed.push('contact email');
    }
    if (changed.length) {
      await this.db.update(organizations).set(set).where(eq(organizations.id, id));
      await this.audit.record({
        organizationId: id,
        actorId: actor.userId,
        action: 'platform.organization_updated',
        entityType: 'organization',
        entityId: id,
        summary: `updated ${set.name ?? org.name} (${changed.join(', ')})`,
        metadata: { changed, ...(set.name ? { previousName: org.name } : {}) },
        ip: actor.ip,
      });
    }
    return this.getOrganization(id);
  }

  /** Suspension takes effect on the tenant's very next request: sessions resolve the tenant status every time. */
  async suspend(actor: PlatformActor, id: string, reason: string) {
    const org = await this.load(id);
    if (org.status === 'suspended') throw new ConflictError(`${org.name} is already suspended`, 'ALREADY_SUSPENDED');
    const [live] = await this.db
      .select({ n: count() })
      .from(attempts)
      .where(and(realAttempts, eq(attempts.organizationId, id), eq(attempts.status, 'in_progress'), gt(attempts.deadlineAt, new Date())));
    await this.db.update(organizations).set({ status: 'suspended' }).where(eq(organizations.id, id));
    await this.audit.record({
      organizationId: id,
      actorId: actor.userId,
      action: 'platform.organization_suspended',
      entityType: 'organization',
      entityId: id,
      summary: `suspended ${org.name}`,
      metadata: { reason, attemptsInProgress: live?.n ?? 0 },
      ip: actor.ip,
    });
    return this.getOrganization(id);
  }

  async reactivate(actor: PlatformActor, id: string) {
    const org = await this.load(id);
    if (org.status === 'active') throw new ConflictError(`${org.name} is already active`, 'ALREADY_ACTIVE');
    await this.db.transaction(async (tx) => {
      await tx.update(organizations).set({ status: 'active' }).where(eq(organizations.id, id));
      await this.audit.record(
        {
          organizationId: id,
          actorId: actor.userId,
          action: 'platform.organization_reactivated',
          entityType: 'organization',
          entityId: id,
          summary: `reactivated ${org.name}`,
          ip: actor.ip,
        },
        tx,
      );
      const admins = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.organizationId, id), eq(roles.key, 'org_admin'), eq(memberships.status, 'active')));
      for (const a of admins) {
        await notify(
          tx,
          { userId: a.userId, organizationId: id, kind: 'organization.reactivated', title: `${org.name} is active again`, body: 'Everyone in your organization can sign in and continue.', link: '/dashboard' },
          this.realtime,
        );
      }
    });
    return this.getOrganization(id);
  }
}
