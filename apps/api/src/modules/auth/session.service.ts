import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Permission } from '@athena/shared';
import type { Database } from '../../db/client';
import { memberships, organizations, roles, sessions, users } from '../../db/schema';
import { randomToken, sha256 } from '../../lib/crypto';
import type { AuthContext } from '../../types/auth';

export const SESSION_COOKIE = 'athena_session';

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly ttlHours: number,
  ) {}

  async create(input: { userId: string; organizationId: string | null; ip?: string; userAgent?: string }) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.ttlHours * 3600_000);
    const [row] = await this.db
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: sha256(token),
        organizationId: input.organizationId,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 300),
        expiresAt,
      })
      .returning({ id: sessions.id });
    return { token, sessionId: row!.id, expiresAt };
  }

  async revoke(sessionId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (exceptSessionId && rows.some((r) => r.id === exceptSessionId)) {
      await this.db.update(sessions).set({ revokedAt: null }).where(eq(sessions.id, exceptSessionId));
    }
  }

  async setOrganization(sessionId: string, organizationId: string) {
    await this.db.update(sessions).set({ organizationId }).where(eq(sessions.id, sessionId));
  }

  /** Resolves a raw cookie token into an AuthContext, or null when invalid, expired or revoked. */
  async resolve(token: string): Promise<AuthContext | null> {
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        sessionOrgId: sessions.organizationId,
        lastSeenAt: sessions.lastSeenAt,
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
          isPlatformAdmin: users.isPlatformAdmin,
          mustChangePassword: users.mustChangePassword,
          preferences: users.preferences,
          status: users.status,
        },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .limit(1);
    if (!row || row.user.status !== 'active') return null;

    let organization: AuthContext['organization'] = null;
    let membership: AuthContext['membership'] = null;
    let permissions = new Set<Permission>();

    if (row.sessionOrgId) {
      const [m] = await this.db
        .select({
          membershipId: memberships.id,
          membershipStatus: memberships.status,
          roleId: roles.id,
          roleKey: roles.key,
          roleName: roles.name,
          permissions: roles.permissions,
          org: {
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            type: organizations.type,
            status: organizations.status,
          },
        })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(and(eq(memberships.userId, row.user.id), eq(memberships.organizationId, row.sessionOrgId)))
        .limit(1);
      // A suspended tenant or membership loses all tenant access immediately.
      if (m && m.membershipStatus === 'active' && m.org.status === 'active') {
        organization = m.org;
        membership = { id: m.membershipId, roleId: m.roleId, roleKey: m.roleKey, roleName: m.roleName };
        permissions = new Set(m.permissions as Permission[]);
      }
    }

    // Touch at most once a minute to keep writes cheap.
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      void this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId)).catch(() => {});
    }

    const { status: _status, ...user } = row.user;
    return { sessionId: row.sessionId, user, organization, membership, permissions };
  }

  /** Active memberships of a user in active organizations (for the org switcher). */
  async listMemberships(userId: string) {
    return this.db
      .select({
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationType: organizations.type,
        roleKey: roles.key,
        roleName: roles.name,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'), eq(organizations.status, 'active')))
      .orderBy(memberships.createdAt);
  }
}
