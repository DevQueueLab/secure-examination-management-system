import { env } from './config/env';
import { db, type Database } from './db/client';
import { AuditService } from './modules/audit/audit.service';
import { AuthService } from './modules/auth/auth.service';
import { SessionService } from './modules/auth/session.service';
import { Realtime } from './realtime/realtime';

/**
 * Composition root: the only place infrastructure is wired. Feature modules receive this container and
 * build their own services from it (constructor injection), which keeps modules independent and testable.
 */
export interface Container {
  db: Database;
  audit: AuditService;
  sessions: SessionService;
  auth: AuthService;
  realtime: Realtime;
  config: typeof env;
}

export function createContainer(): Container {
  const audit = new AuditService(db);
  const sessions = new SessionService(db, env.SESSION_TTL_HOURS);
  const auth = new AuthService(db, sessions, audit);
  return { db, audit, sessions, auth, realtime: new Realtime(), config: env };
}
