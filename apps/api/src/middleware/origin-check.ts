import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../lib/errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (cookies are already SameSite=Lax): state-changing requests from a browser
 * must come from our own origin.
 */
export function originCheck(allowed: string[]) {
  const allow = new Set(allowed);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.header('origin');
    if (origin && !allow.has(origin)) throw new ForbiddenError('Cross-origin request blocked');
    next();
  };
}
