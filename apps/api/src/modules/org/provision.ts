import { and, eq } from 'drizzle-orm';
import type { SystemRoleKey } from '@athena/shared';
import type { Executor } from '../../db/client';
import { memberships, roles, users } from '../../db/schema';
import { randomToken } from '../../lib/crypto';
import { hashPassword } from '../auth/password';

export interface ProvisionInput {
  organizationId: string;
  email: string;
  name: string;
  roleKey: SystemRoleKey | string;
  externalId?: string | null;
  cohort?: string | null;
  /** Initial password; when omitted a random one is generated and the user must change it. */
  password?: string;
}

export interface ProvisionResult {
  userId: string;
  membershipId: string;
  createdUser: boolean;
  createdMembership: boolean;
  /** Returned once when a password was generated, so an admin can hand it over. */
  temporaryPassword?: string;
}

/**
 * Ensures a person exists and belongs to the organization with the given role. Used by people management and
 * by both bulk imports, so account creation rules live in one place. Run inside the caller's transaction.
 */
export async function provisionMember(tx: Executor, input: ProvisionInput): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();
  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, input.organizationId), eq(roles.key, input.roleKey)))
    .limit(1);
  if (!role) throw new Error(`Unknown role "${input.roleKey}"`);

  let [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let createdUser = false;
  let temporaryPassword: string | undefined;
  if (!user) {
    temporaryPassword = input.password ? undefined : `Ath-${randomToken(6)}9`;
    const passwordHash = await hashPassword(input.password ?? temporaryPassword!);
    [user] = await tx
      .insert(users)
      .values({ email, name: input.name.trim(), passwordHash, mustChangePassword: !input.password })
      .returning({ id: users.id });
    createdUser = true;
  }

  const [existing] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user!.id), eq(memberships.organizationId, input.organizationId)))
    .limit(1);
  if (existing) {
    await tx
      .update(memberships)
      .set({ externalId: input.externalId ?? undefined, cohort: input.cohort ?? undefined })
      .where(eq(memberships.id, existing.id));
    return { userId: user!.id, membershipId: existing.id, createdUser, createdMembership: false, temporaryPassword };
  }
  const [m] = await tx
    .insert(memberships)
    .values({ userId: user!.id, organizationId: input.organizationId, roleId: role.id, externalId: input.externalId ?? null, cohort: input.cohort ?? null })
    .returning({ id: memberships.id });
  return { userId: user!.id, membershipId: m!.id, createdUser, createdMembership: true, temporaryPassword };
}
