import type { NextFunction, Request, Response } from 'express';
import type { Permission } from '@athena/shared';
import { ForbiddenError, UnauthenticatedError } from '../lib/errors';
import type { AuthContext, TenantAuthContext } from '../types/auth';

/** Authorization is enforced here and in services, never only by hiding UI. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw new UnauthenticatedError();
  next();
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw new UnauthenticatedError();
  if (!req.auth.user.isPlatformAdmin) throw new ForbiddenError('Platform administrators only');
  next();
}

export function requireOrg(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw new UnauthenticatedError();
  if (!req.auth.organization || !req.auth.membership) throw new ForbiddenError('Select an organization first');
  next();
}

/** Requires an active tenant and ALL of the listed permissions. */
export function requirePermission(...needed: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw new UnauthenticatedError();
    if (!req.auth.organization || !req.auth.membership) throw new ForbiddenError('Select an organization first');
    for (const p of needed) if (!req.auth.permissions.has(p)) throw new ForbiddenError();
    next();
  };
}

/** Requires an active tenant and ANY of the listed permissions. */
export function requireAnyPermission(...options: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw new UnauthenticatedError();
    if (!req.auth.organization || !req.auth.membership) throw new ForbiddenError('Select an organization first');
    if (!options.some((p) => req.auth!.permissions.has(p))) throw new ForbiddenError();
    next();
  };
}

/** Typed accessors for handlers that run after the guards above. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new UnauthenticatedError();
  return req.auth;
}
export function tenantOf(req: Request): TenantAuthContext {
  const auth = authOf(req);
  if (!auth.organization || !auth.membership) throw new ForbiddenError('Select an organization first');
  return auth as TenantAuthContext;
}
