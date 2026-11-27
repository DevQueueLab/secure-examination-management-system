import { Router, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { workspacePreferencesSchema } from '@athena/shared';
import { isProd } from '../../config/env';
import { authOf, requireAuth } from '../../middleware/guards';
import { parse } from '../../lib/validate';
import type { AuthContext } from '../../types/auth';
import type { AuthService } from './auth.service';
import { passwordSchema } from './password';
import { SESSION_COOKIE, type SessionService } from './session.service';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254),
  password: z.string().min(1, 'Enter your password').max(128),
});

export function authRoutes(deps: { auth: AuthService; sessions: SessionService; ttlHours: number }): Router {
  const router = Router();

  // Per IP + email, so a whole venue behind one NAT is not locked out by a single person.
  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '0.0.0.0')}:${String(req.body?.email ?? '').toLowerCase()}`,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait a minute and try again.' } }),
  });

  const setCookie = (res: Response, token: string, expiresAt: Date) =>
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', expires: expiresAt });

  const profile = async (auth: AuthContext) => ({
    user: auth.user,
    organization: auth.organization,
    role: auth.membership ? { id: auth.membership.roleId, key: auth.membership.roleKey, name: auth.membership.roleName } : null,
    permissions: [...auth.permissions],
    memberships: await deps.sessions.listMemberships(auth.user.id),
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const body = parse(loginSchema, req.body);
    const session = await deps.auth.login({ ...body, ip: req.ip, userAgent: req.header('user-agent') });
    setCookie(res, session.token, session.expiresAt);
    const auth = await deps.sessions.resolve(session.token);
    res.json(await profile(auth!));
  });

  router.post('/logout', async (req, res) => {
    if (req.auth) await deps.sessions.revoke(req.auth.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json(await profile(authOf(req)));
  });

  router.post('/switch-organization', requireAuth, async (req, res) => {
    const { organizationId } = parse(z.object({ organizationId: z.string().uuid() }), req.body);
    const auth = authOf(req);
    await deps.auth.switchOrganization(auth, organizationId);
    const token: string = req.cookies[SESSION_COOKIE];
    res.json(await profile((await deps.sessions.resolve(token))!));
  });

  router.patch('/me/preferences', requireAuth, async (req, res) => {
    const patch = parse(workspacePreferencesSchema.partial(), req.body);
    res.json({ preferences: await deps.auth.updatePreferences(authOf(req), patch) });
  });

  router.post('/me/password', requireAuth, async (req, res) => {
    const body = parse(
      z
        .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema })
        .refine((v) => v.currentPassword !== v.newPassword, { message: 'Choose a different password', path: ['newPassword'] }),
      req.body,
    );
    await deps.auth.changePassword(authOf(req), body.currentPassword, body.newPassword);
    res.status(204).end();
  });

  return router;
}
