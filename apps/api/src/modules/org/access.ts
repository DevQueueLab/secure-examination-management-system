import { PERMISSION_KEYS, type Permission } from '@athena/shared';
import { ForbiddenError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';

/** Permissions that only act on the holder's own work. Granting them never gives power over other people. */
export const CANDIDATE_PERMISSIONS: readonly Permission[] = ['exams.take', 'results.view_own', 'disputes.raise'];

/** Every permission that makes someone staff. Any one of them opens the staff dashboard. */
export const STAFF_PERMISSIONS: Permission[] = PERMISSION_KEYS.filter((p) => !CANDIDATE_PERMISSIONS.includes(p));

/** Staff permissions in `permissions` that the caller does not hold. */
export function permissionsBeyond(auth: TenantAuthContext, permissions: readonly string[]): string[] {
  return permissions.filter((p) => !CANDIDATE_PERMISSIONS.includes(p as Permission) && !auth.permissions.has(p as Permission));
}

/**
 * No privilege escalation: nobody can hand out (or take away from someone else) access they don't hold themselves.
 * Candidate permissions are exempt because they only cover the holder's own attempts.
 */
export function assertWithinOwnAccess(auth: TenantAuthContext, permissions: readonly string[], message: string) {
  if (permissionsBeyond(auth, permissions).length > 0) throw new ForbiddenError(message);
}

/** Postgres unique violation (e.g. a concurrent insert won the race). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
