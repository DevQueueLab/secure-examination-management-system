import { and, asc, count, eq, sql } from 'drizzle-orm';
import { PERMISSION_KEYS, SYSTEM_ROLE_KEYS, type Permission } from '@athena/shared';
import type { Database } from '../../db/client';
import { memberships, roles } from '../../db/schema';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { assertWithinOwnAccess, isUniqueViolation } from './access';
import type { Actor } from './people.service';
import type { AuditService } from '../audit/audit.service';

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isSystem: boolean;
  /** org_admin always holds every staff permission so a tenant can never lock itself out. */
  locked: boolean;
  memberCount: number;
  activeMemberCount: number;
  createdAt: string;
  updatedAt: string;
}

const ORDER = sql.raw(`array_position(array[${SYSTEM_ROLE_KEYS.map((k) => `'${k}'`).join(',')}]::text[], "roles"."key")`);

/** Keep the canonical order of PERMISSIONS so diffs and the matrix read the same everywhere. */
const normalize = (list: readonly string[]) => PERMISSION_KEYS.filter((p) => list.includes(p));

/** Readable keys for custom roles ("Teaching Assistant" -> teaching_assistant): the CSV role column uses them. */
export function roleKeyFrom(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'role';
}

export class RolesService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<RoleView[]> {
    const rows = await this.db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        permissions: roles.permissions,
        isSystem: roles.isSystem,
        createdAt: roles.createdAt,
        updatedAt: roles.updatedAt,
        memberCount: count(memberships.id),
        activeMemberCount: sql<number>`count(${memberships.id}) filter (where ${memberships.status} = 'active')`.mapWith(Number),
      })
      .from(roles)
      .leftJoin(memberships, eq(memberships.roleId, roles.id))
      .where(eq(roles.organizationId, organizationId))
      .groupBy(roles.id)
      .orderBy(sql`${ORDER} nulls last`, asc(roles.createdAt));
    return rows.map((r) => ({
      ...r,
      permissions: normalize(r.permissions),
      locked: r.key === 'org_admin',
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async load(organizationId: string, id: string) {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.organizationId, organizationId)))
      .limit(1);
    if (!role) throw new NotFoundError('Role');
    return role;
  }

  private async view(organizationId: string, id: string) {
    const all = await this.list(organizationId);
    return all.find((r) => r.id === id)!;
  }

  private async assertNameFree(organizationId: string, name: string, exceptId?: string) {
    const [clash] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), sql`lower(${roles.name}) = lower(${name})`, exceptId ? sql`${roles.id} <> ${exceptId}` : undefined))
      .limit(1);
    if (clash) throw new AppError(409, 'ROLE_NAME_TAKEN', 'A role with that name already exists', { name: 'A role with that name already exists' });
  }

  async create(actor: Actor, input: { name: string; description?: string | null; permissions: Permission[] }) {
    const { auth } = actor;
    const organizationId = auth.organization.id;
    const permissions = normalize(input.permissions);
    assertWithinOwnAccess(auth, permissions, "You can't create a role with access you don't have yourself.");
    await this.assertNameFree(organizationId, input.name);

    const taken = new Set((await this.db.select({ key: roles.key }).from(roles).where(eq(roles.organizationId, organizationId))).map((r) => r.key));
    const base = roleKeyFrom(input.name);
    let key = (SYSTEM_ROLE_KEYS as readonly string[]).includes(base) ? `${base}_custom` : base;
    for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;

    try {
      const [row] = await this.db
        .insert(roles)
        .values({ organizationId, key, name: input.name, description: input.description || null, permissions, isSystem: false })
        .returning({ id: roles.id });
      await this.audit.record({
        organizationId,
        actorId: auth.user.id,
        action: 'roles.created',
        entityType: 'role',
        entityId: row!.id,
        summary: `created the ${input.name} role`,
        metadata: { key, permissions },
        ip: actor.ip,
      });
      return this.view(organizationId, row!.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A role with that name was just created. Refresh and try again.');
      throw err;
    }
  }

  async update(actor: Actor, id: string, patch: { name?: string; description?: string | null; permissions?: Permission[] }) {
    const { auth } = actor;
    const organizationId = auth.organization.id;
    const role = await this.load(organizationId, id);
    if (role.key === 'org_admin') {
      throw new AppError(
        403,
        'ROLE_LOCKED',
        'The Organization Admin role always keeps every permission, so someone can always manage people and roles.',
      );
    }
    const renaming = patch.name !== undefined && patch.name !== role.name;
    const redescribing = patch.description !== undefined && (patch.description || null) !== role.description;
    if (role.isSystem && (renaming || redescribing)) {
      throw new ValidationError('System role names are fixed. You can change their permissions.', { name: 'System role names are fixed' });
    }
    // Editing a role means holding everything it grants today and everything it will grant.
    assertWithinOwnAccess(auth, role.permissions, `You can't edit ${role.name} because it has access you don't have.`);

    const next = patch.permissions ? normalize(patch.permissions) : normalize(role.permissions);
    assertWithinOwnAccess(auth, next, "You can't grant access you don't have yourself.");
    const before = normalize(role.permissions);
    const added = next.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !next.includes(p));
    if (renaming) await this.assertNameFree(organizationId, patch.name!, id);

    if (!renaming && !redescribing && added.length === 0 && removed.length === 0) return this.view(organizationId, id);

    await this.db
      .update(roles)
      .set({
        ...(renaming ? { name: patch.name } : {}),
        ...(redescribing ? { description: patch.description || null } : {}),
        permissions: next,
      })
      .where(eq(roles.id, id));

    const name = renaming ? patch.name! : role.name;
    if (added.length || removed.length) {
      const parts = [added.length ? `granted ${added.join(', ')}` : '', removed.length ? `removed ${removed.join(', ')}` : ''].filter(Boolean);
      await this.audit.record({
        organizationId,
        actorId: auth.user.id,
        action: 'roles.permissions_changed',
        entityType: 'role',
        entityId: id,
        summary: `changed ${name} permissions: ${parts.join('; ')}`,
        metadata: { role: role.key, system: role.isSystem, added, removed },
        ip: actor.ip,
      });
    }
    if (renaming || redescribing) {
      await this.audit.record({
        organizationId,
        actorId: auth.user.id,
        action: 'roles.updated',
        entityType: 'role',
        entityId: id,
        summary: renaming ? `renamed the ${role.name} role to ${patch.name}` : `updated the ${name} role description`,
        metadata: { role: role.key },
        ip: actor.ip,
      });
    }
    return this.view(organizationId, id);
  }

  async remove(actor: Actor, id: string) {
    const { auth } = actor;
    const organizationId = auth.organization.id;
    const role = await this.load(organizationId, id);
    if (role.isSystem) throw new ForbiddenError('System roles cannot be deleted. You can change their permissions instead.');
    assertWithinOwnAccess(auth, role.permissions, `You can't delete ${role.name} because it has access you don't have.`);
    const [holders] = await this.db.select({ n: count() }).from(memberships).where(eq(memberships.roleId, id));
    const n = holders?.n ?? 0;
    if (n > 0) {
      throw new ConflictError(`${n} ${n === 1 ? 'person holds' : 'people hold'} this role. Move them to another role first.`, 'ROLE_IN_USE');
    }
    try {
      await this.db.delete(roles).where(eq(roles.id, id));
    } catch (err) {
      // Someone was given this role between the check and the delete (foreign key violation).
      if ((err as { code?: string; cause?: { code?: string } })?.cause?.code === '23503' || (err as { code?: string })?.code === '23503') {
        throw new ConflictError('Someone was just given this role. Move them to another role first.', 'ROLE_IN_USE');
      }
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorId: auth.user.id,
      action: 'roles.deleted',
      entityType: 'role',
      entityId: id,
      summary: `deleted the ${role.name} role`,
      metadata: { key: role.key },
      ip: actor.ip,
    });
  }
}
