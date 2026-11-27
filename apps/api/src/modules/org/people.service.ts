import { and, asc, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { MEMBERSHIP_STATUSES, SYSTEM_ROLE_KEYS, type MembershipStatus } from '@athena/shared';
import type { Database, Executor } from '../../db/client';
import { memberships, organizations, roles, users } from '../../db/schema';
import { randomToken } from '../../lib/crypto';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import type { SessionService } from '../auth/session.service';
import type { Realtime } from '../../realtime/realtime';
import { notify } from '../notifications/notify';
import { assertWithinOwnAccess, isUniqueViolation } from './access';
import { provisionMember } from './provision';

export interface PersonView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  /** Membership status in this organization. */
  status: MembershipStatus;
  /** Account-wide status (a disabled account cannot sign in anywhere). */
  accountStatus: 'active' | 'disabled';
  externalId: string | null;
  cohort: string | null;
  lastLoginAt: string | null;
  joinedAt: string;
  mustChangePassword: boolean;
  role: { id: string; key: string; name: string; isSystem: boolean };
}

export interface PeopleQuery {
  q?: string;
  role?: string;
  status?: MembershipStatus;
  cohort?: string;
  page: number;
  pageSize: number;
  sort: 'name' | 'recent' | 'last_login';
}

export interface Actor {
  auth: TenantAuthContext;
  ip?: string;
}

const personColumns = {
  membershipId: memberships.id,
  userId: users.id,
  name: users.name,
  email: users.email,
  status: memberships.status,
  accountStatus: users.status,
  externalId: memberships.externalId,
  cohort: memberships.cohort,
  lastLoginAt: users.lastLoginAt,
  joinedAt: memberships.createdAt,
  mustChangePassword: users.mustChangePassword,
  roleId: roles.id,
  roleKey: roles.key,
  roleName: roles.name,
  roleIsSystem: roles.isSystem,
};

type PersonRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: MembershipStatus;
  accountStatus: 'active' | 'disabled';
  externalId: string | null;
  cohort: string | null;
  lastLoginAt: Date | null;
  joinedAt: Date;
  mustChangePassword: boolean;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleIsSystem: boolean;
};

function toView(r: PersonRow): PersonView {
  return {
    membershipId: r.membershipId,
    userId: r.userId,
    name: r.name,
    email: r.email,
    status: r.status,
    accountStatus: r.accountStatus,
    externalId: r.externalId,
    cohort: r.cohort,
    lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
    joinedAt: r.joinedAt.toISOString(),
    mustChangePassword: r.mustChangePassword,
    role: { id: r.roleId, key: r.roleKey, name: r.roleName, isSystem: r.roleIsSystem },
  };
}

/** Same format provisionMember uses, so every temporary password looks alike. Meets the password policy. */
export const temporaryPassword = () => `Ath-${randomToken(6)}9`;

const SYSTEM_ORDER = sql.raw(`array_position(array[${SYSTEM_ROLE_KEYS.map((k) => `'${k}'`).join(',')}]::text[], "roles"."key")`);

/**
 * People in a tenant: memberships joined with the global identity and the tenant role.
 * Guard rails live here, not in the UI: the last active org admin cannot be demoted or suspended, nobody can
 * suspend themselves, and nobody can grant or alter access beyond their own.
 */
export class PeopleService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly realtime: Realtime,
  ) {}

  async list(organizationId: string, query: PeopleQuery) {
    const conds: (SQL | undefined)[] = [eq(memberships.organizationId, organizationId)];
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(users.name, like), ilike(users.email, like), ilike(memberships.externalId, like)));
    }
    if (query.role) conds.push(eq(roles.key, query.role));
    if (query.status) conds.push(eq(memberships.status, query.status));
    if (query.cohort) conds.push(eq(memberships.cohort, query.cohort));
    const where = and(...conds);

    const order =
      query.sort === 'recent'
        ? [desc(memberships.createdAt), asc(users.name), asc(memberships.id)]
        : query.sort === 'last_login'
          ? [sql`${users.lastLoginAt} desc nulls last`, asc(users.name), asc(memberships.id)]
          : [asc(users.name), asc(users.email), asc(memberships.id)];

    const base = this.db
      .select(personColumns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId));

    const [rows, [total], facets] = await Promise.all([
      base
        .where(where)
        .orderBy(...order)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ n: count() })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(where),
      this.facets(organizationId),
    ]);

    return { items: (rows as PersonRow[]).map(toView), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize, facets };
  }

  /** Counts that power the filter controls (always for the whole tenant, not the filtered page). */
  private async facets(organizationId: string) {
    const [roleCounts, cohorts, statuses] = await Promise.all([
      this.db
        .select({ id: roles.id, key: roles.key, name: roles.name, isSystem: roles.isSystem, count: count(memberships.id) })
        .from(roles)
        .leftJoin(memberships, eq(memberships.roleId, roles.id))
        .where(eq(roles.organizationId, organizationId))
        .groupBy(roles.id)
        .orderBy(sql`${SYSTEM_ORDER} nulls last`, asc(roles.name)),
      this.db
        .select({ cohort: memberships.cohort, count: count() })
        .from(memberships)
        .where(and(eq(memberships.organizationId, organizationId), sql`${memberships.cohort} is not null and ${memberships.cohort} <> ''`))
        .groupBy(memberships.cohort)
        .orderBy(asc(memberships.cohort)),
      this.db
        .select({ status: memberships.status, count: count() })
        .from(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .groupBy(memberships.status),
    ]);
    return {
      roles: roleCounts,
      cohorts: cohorts.map((c) => ({ cohort: c.cohort!, count: c.count })),
      statuses: Object.fromEntries(MEMBERSHIP_STATUSES.map((s) => [s, statuses.find((x) => x.status === s)?.count ?? 0])) as Record<MembershipStatus, number>,
    };
  }

  async get(organizationId: string, membershipId: string, tx: Executor = this.db): Promise<PersonView> {
    const [row] = await tx
      .select(personColumns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundError('Person');
    return toView(row as PersonRow);
  }

  /** A role of this tenant by id or key. Never trusts a role id from another tenant. */
  async resolveRole(tx: Executor, organizationId: string, ref: { roleId?: string; roleKey?: string }) {
    if (!ref.roleId && !ref.roleKey) throw new ValidationError('Choose a role', { roleId: 'Choose a role' });
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), ref.roleId ? eq(roles.id, ref.roleId) : eq(roles.key, ref.roleKey!)))
      .limit(1);
    if (!role) throw new ValidationError('That role does not exist in this organization', { [ref.roleId ? 'roleId' : 'roleKey']: 'Unknown role' });
    return role;
  }

  private async assertExternalIdFree(tx: Executor, organizationId: string, externalId: string | null | undefined, exceptMembershipId?: string) {
    if (!externalId) return;
    const [taken] = await tx
      .select({ name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.externalId, externalId),
          exceptMembershipId ? ne(memberships.id, exceptMembershipId) : undefined,
        ),
      )
      .limit(1);
    if (taken) throw new ConflictError(`Roll number ${externalId} already belongs to ${taken.name}`, 'EXTERNAL_ID_TAKEN');
  }

  async create(
    actor: Actor,
    input: { name: string; email: string; roleId?: string; roleKey?: string; externalId?: string | null; cohort?: string | null },
  ) {
    const { auth } = actor;
    const organizationId = auth.organization.id;
    const email = input.email.trim().toLowerCase();
    try {
      return await this.db.transaction(async (tx) => {
        const role = await this.resolveRole(tx, organizationId, input);
        assertWithinOwnAccess(auth, role.permissions, `You can't give someone the ${role.name} role because it has access you don't have.`);

        const [existingUser] = await tx
          .select({ id: users.id, name: users.name, isPlatformAdmin: users.isPlatformAdmin })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (existingUser?.isPlatformAdmin) {
          throw new ValidationError('Platform administrator accounts cannot join an organization', { email: 'This email belongs to a platform administrator' });
        }
        if (existingUser) {
          const [member] = await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(and(eq(memberships.userId, existingUser.id), eq(memberships.organizationId, organizationId)))
            .limit(1);
          if (member) throw new AppError(409, 'ALREADY_MEMBER', `${existingUser.name} is already in this organization`, { email: 'Already a member of this organization' });
        }
        await this.assertExternalIdFree(tx, organizationId, input.externalId);

        const result = await provisionMember(tx, {
          organizationId,
          email,
          name: input.name,
          roleKey: role.key,
          externalId: input.externalId || null,
          cohort: input.cohort || null,
        });
        const person = await this.get(organizationId, result.membershipId, tx);
        await this.audit.record(
          {
            organizationId,
            actorId: auth.user.id,
            action: 'people.added',
            entityType: 'membership',
            entityId: result.membershipId,
            summary: `added ${person.name} as ${role.name}`,
            metadata: { email, role: role.key, existingAccount: !result.createdUser },
            ip: actor.ip,
          },
          tx,
        );
        if (!result.createdUser) {
          await notify(
            tx,
            {
              userId: result.userId,
              organizationId,
              kind: 'membership.added',
              title: `You were added to ${auth.organization.name}`,
              body: `Your role is ${role.name}. Switch to it from the organization menu.`,
              link: '/dashboard',
            },
            this.realtime,
          );
        }
        return { person, temporaryPassword: result.temporaryPassword ?? null, existingAccount: !result.createdUser };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('That person was just added by someone else. Refresh to see them.');
      throw err;
    }
  }

  async update(
    actor: Actor,
    membershipId: string,
    patch: { roleId?: string; roleKey?: string; cohort?: string | null; externalId?: string | null; status?: MembershipStatus },
  ) {
    const { auth } = actor;
    const organizationId = auth.organization.id;
    return this.db.transaction(async (tx) => {
      // Serializes admin-affecting changes per tenant, so two admins demoting each other can't both succeed.
      await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).for('update');

      const [current] = await tx
        .select({ ...personColumns, rolePermissions: roles.permissions })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
        .limit(1);
      if (!current) throw new NotFoundError('Person');
      const isSelf = current.userId === auth.user.id;
      if (!isSelf) assertWithinOwnAccess(auth, current.rolePermissions, `You can't change ${current.name} because they have access you don't have.`);

      const nextRole = patch.roleId || patch.roleKey ? await this.resolveRole(tx, organizationId, patch) : null;
      const roleChanges = nextRole && nextRole.id !== current.roleId ? nextRole : null;
      if (roleChanges) assertWithinOwnAccess(auth, roleChanges.permissions, `You can't give someone the ${roleChanges.name} role because it has access you don't have.`);

      const statusChanges = patch.status && patch.status !== current.status ? patch.status : null;
      if (statusChanges === 'suspended' && isSelf) throw new ConflictError("You can't suspend yourself", 'SELF_SUSPEND');

      const losesAdmin =
        current.roleKey === 'org_admin' &&
        current.status === 'active' &&
        ((roleChanges && roleChanges.key !== 'org_admin') || statusChanges === 'suspended');
      if (losesAdmin) {
        const [admins] = await tx
          .select({ n: count() })
          .from(memberships)
          .innerJoin(roles, eq(roles.id, memberships.roleId))
          .where(and(eq(memberships.organizationId, organizationId), eq(roles.key, 'org_admin'), eq(memberships.status, 'active')));
        if ((admins?.n ?? 0) <= 1) {
          throw new ConflictError(
            `${current.name} is the only active organization admin. Make someone else an admin first, so the organization always has one.`,
            'LAST_ADMIN',
          );
        }
      }

      const set: Partial<typeof memberships.$inferInsert> = {};
      if (roleChanges) set.roleId = roleChanges.id;
      if (statusChanges) set.status = statusChanges;
      if (patch.cohort !== undefined && (patch.cohort || null) !== current.cohort) set.cohort = patch.cohort || null;
      if (patch.externalId !== undefined && (patch.externalId || null) !== current.externalId) {
        await this.assertExternalIdFree(tx, organizationId, patch.externalId, membershipId);
        set.externalId = patch.externalId || null;
      }
      if (Object.keys(set).length === 0) return this.get(organizationId, membershipId, tx);
      await tx.update(memberships).set(set).where(eq(memberships.id, membershipId));

      const base = { organizationId, actorId: auth.user.id, entityType: 'membership', entityId: membershipId, ip: actor.ip };
      if (roleChanges) {
        await this.audit.record(
          {
            ...base,
            action: 'people.role_changed',
            summary: `changed ${current.name}'s role from ${current.roleName} to ${roleChanges.name}`,
            metadata: { from: current.roleKey, to: roleChanges.key },
          },
          tx,
        );
        if (!isSelf) {
          await notify(
            tx,
            {
              userId: current.userId,
              organizationId,
              kind: 'role.changed',
              title: `Your role is now ${roleChanges.name}`,
              body: `${auth.user.name} changed your role in ${auth.organization.name}.`,
              link: '/dashboard',
            },
            this.realtime,
          );
        }
      }
      if (statusChanges) {
        await this.audit.record(
          {
            ...base,
            action: statusChanges === 'suspended' ? 'people.suspended' : 'people.reactivated',
            summary: `${statusChanges === 'suspended' ? 'suspended' : 'reactivated'} ${current.name}`,
          },
          tx,
        );
      }
      if (set.cohort !== undefined || set.externalId !== undefined) {
        await this.audit.record(
          {
            ...base,
            action: 'people.updated',
            summary: `updated ${current.name}'s details`,
            metadata: {
              ...(set.cohort !== undefined ? { cohort: { from: current.cohort, to: set.cohort } } : {}),
              ...(set.externalId !== undefined ? { externalId: { from: current.externalId, to: set.externalId } } : {}),
            },
          },
          tx,
        );
      }
      return this.get(organizationId, membershipId, tx);
    });
  }

  /**
   * Issues a temporary password and signs the person out everywhere. Accounts that also belong to another
   * tenant are refused: one tenant's admin must never be able to take over an identity another tenant relies on.
   */
  async resetPassword(actor: Actor, membershipId: string) {
    const { auth } = actor;
    const organizationId = auth.organization.id;
    const [target] = await this.db
      .select({ userId: users.id, name: users.name, isPlatformAdmin: users.isPlatformAdmin, rolePermissions: roles.permissions })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .limit(1);
    if (!target) throw new NotFoundError('Person');
    if (target.userId === auth.user.id) throw new ConflictError('Change your own password from your profile', 'SELF_RESET');
    if (target.isPlatformAdmin) throw new ForbiddenError();
    assertWithinOwnAccess(auth, target.rolePermissions, `You can't reset ${target.name}'s password because they have access you don't have.`);

    const [elsewhere] = await this.db
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.userId, target.userId), ne(memberships.organizationId, organizationId)));
    if ((elsewhere?.n ?? 0) > 0) {
      throw new ConflictError(
        `${target.name} also belongs to another organization on Athena, so only they can change this password. Ask them to sign in and change it from their profile.`,
        'SHARED_ACCOUNT',
      );
    }

    const password = temporaryPassword();
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, target.userId));
    await this.sessions.revokeAllForUser(target.userId);
    await this.audit.record({
      organizationId,
      actorId: auth.user.id,
      action: 'people.password_reset',
      entityType: 'membership',
      entityId: membershipId,
      summary: `reset ${target.name}'s password and signed them out`,
      ip: actor.ip,
    });
    return { temporaryPassword: password };
  }
}
