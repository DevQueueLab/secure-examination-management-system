import { and, eq } from 'drizzle-orm';
import { workspacePreferencesSchema } from '@athena/shared';
import type { Database } from '../../db/client';
import { memberships, organizations, users } from '../../db/schema';
import { AppError, ForbiddenError, UnauthenticatedError, ValidationError } from '../../lib/errors';
import type { AuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { dummyVerify, hashPassword, verifyPassword } from './password';
import type { SessionService } from './session.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(input: { email: string; password: string; ip?: string; userAgent?: string }) {
    const email = input.email.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
      await dummyVerify(input.password);
      throw new UnauthenticatedError('Email or password is incorrect');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await this.db
        .update(users)
        .set({
          failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        })
        .where(eq(users.id, user.id));
      await this.audit.record({ actorId: user.id, action: 'auth.login_failed', ip: input.ip, metadata: { failed } });
      throw new UnauthenticatedError('Email or password is incorrect');
    }
    if (user.status !== 'active') throw new ForbiddenError('This account has been disabled. Contact your administrator.');

    const memberList = await this.sessions.listMemberships(user.id);
    if (!user.isPlatformAdmin && memberList.length === 0) {
      throw new ForbiddenError('Your organization access is suspended. Contact your administrator.');
    }
    await this.db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const organizationId = user.isPlatformAdmin ? null : memberList[0]!.organizationId;
    const session = await this.sessions.create({ userId: user.id, organizationId, ip: input.ip, userAgent: input.userAgent });
    await this.audit.record({ organizationId, actorId: user.id, action: 'auth.login', ip: input.ip });
    return session;
  }

  async switchOrganization(auth: AuthContext, organizationId: string) {
    const [m] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(memberships.userId, auth.user.id),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, 'active'),
          eq(organizations.status, 'active'),
        ),
      )
      .limit(1);
    if (!m) throw new ForbiddenError('You are not a member of that organization');
    await this.sessions.setOrganization(auth.sessionId, organizationId);
  }

  async updatePreferences(auth: AuthContext, patch: unknown) {
    const merged = workspacePreferencesSchema.parse({ ...(auth.user.preferences ?? {}), ...(patch as object) });
    await this.db.update(users).set({ preferences: merged }).where(eq(users.id, auth.user.id));
    return merged;
  }

  async changePassword(auth: AuthContext, current: string, next: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, auth.user.id)).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, current))) {
      throw new ValidationError('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    await this.db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, user.id));
    await this.sessions.revokeAllForUser(user.id, auth.sessionId);
    await this.audit.record({ organizationId: auth.organization?.id, actorId: user.id, action: 'auth.password_changed' });
  }
}
