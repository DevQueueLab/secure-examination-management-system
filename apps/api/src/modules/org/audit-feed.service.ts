import { and, count, desc, eq, gte, ilike, inArray, like, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { auditLogs, organizations, users } from '../../db/schema';

export interface AuditQuery {
  actorId?: string;
  /** Prefix such as "people" or "people.role_changed". */
  action?: string;
  from?: Date;
  to?: Date;
  q?: string;
  page: number;
  pageSize: number;
}

export interface AuditEntryView {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string; isPlatformAdmin: boolean } | null;
  organization?: { id: string; name: string } | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Read side of the audit log for two audiences:
 * - a tenant sees only its own entries;
 * - the platform sees platform actions and platform admins' sign-ins, never what happens inside a tenant.
 */
export class AuditFeedService {
  constructor(private readonly db: Database) {}

  private filters(q: AuditQuery): (SQL | undefined)[] {
    const conds: (SQL | undefined)[] = [];
    if (q.actorId) conds.push(eq(auditLogs.actorId, q.actorId));
    if (q.action) {
      const prefix = escapeLike(q.action);
      conds.push(or(eq(auditLogs.action, q.action), like(auditLogs.action, `${prefix}.%`)));
    }
    if (q.from) conds.push(gte(auditLogs.createdAt, q.from));
    if (q.to) conds.push(lte(auditLogs.createdAt, q.to));
    if (q.q) conds.push(or(ilike(auditLogs.summary, `%${escapeLike(q.q)}%`), ilike(auditLogs.action, `%${escapeLike(q.q)}%`), ilike(users.name, `%${escapeLike(q.q)}%`)));
    return conds;
  }

  private platformScope(): SQL {
    return or(
      like(auditLogs.action, 'platform.%'),
      and(like(auditLogs.action, 'auth.%'), inArray(auditLogs.actorId, this.db.select({ id: users.id }).from(users).where(eq(users.isPlatformAdmin, true)))),
    )!;
  }

  async forOrganization(organizationId: string, q: AuditQuery) {
    const scope = eq(auditLogs.organizationId, organizationId);
    const page = await this.page(and(scope, ...this.filters(q))!, q, false);
    const [actors, groups] = await Promise.all([
      this.db
        .select({ id: users.id, name: users.name, entries: count() })
        .from(auditLogs)
        .innerJoin(users, eq(users.id, auditLogs.actorId))
        .where(scope)
        .groupBy(users.id)
        .orderBy(desc(count()))
        .limit(100),
      this.actionGroups(scope),
    ]);
    return { ...page, facets: { actors, actions: groups } };
  }

  async forPlatform(q: AuditQuery) {
    const scope = this.platformScope();
    const page = await this.page(and(scope, ...this.filters(q))!, q, true);
    return { ...page, facets: { actions: await this.actionGroups(scope) } };
  }

  private async actionGroups(scope: SQL) {
    const rows = await this.db
      .select({ group: sql<string>`split_part(${auditLogs.action}, '.', 1)`, entries: count() })
      .from(auditLogs)
      .where(scope)
      .groupBy(sql`split_part(${auditLogs.action}, '.', 1)`)
      .orderBy(desc(count()));
    return rows;
  }

  private async page(where: SQL, q: AuditQuery, withOrg: boolean) {
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          summary: auditLogs.summary,
          metadata: auditLogs.metadata,
          ip: auditLogs.ip,
          createdAt: auditLogs.createdAt,
          actorId: users.id,
          actorName: users.name,
          actorEmail: users.email,
          actorIsPlatformAdmin: users.isPlatformAdmin,
          orgId: organizations.id,
          orgName: organizations.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .leftJoin(organizations, eq(organizations.id, auditLogs.organizationId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(where),
    ]);
    const items: AuditEntryView[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.summary,
      metadata: r.metadata,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      actor: r.actorId ? { id: r.actorId, name: r.actorName!, email: r.actorEmail!, isPlatformAdmin: r.actorIsPlatformAdmin! } : null,
      ...(withOrg ? { organization: r.orgId ? { id: r.orgId, name: r.orgName! } : null } : {}),
    }));
    return { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  }
}

