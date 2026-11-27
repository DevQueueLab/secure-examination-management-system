import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, type SessionService } from '../modules/auth/session.service';

/** Resolves the session cookie (if any) into req.auth. Never rejects; guards decide. */
export function authenticate(sessions: SessionService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    if (token && token.length <= 128) {
      const auth = await sessions.resolve(token);
      if (auth) req.auth = auth;
    }
    next();
  };
}
