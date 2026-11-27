import { Router } from 'express';
import { z } from 'zod';
import { ORGANIZATION_STATUSES, ORGANIZATION_TYPES, paginationQuerySchema, uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { authOf, requirePlatformAdmin } from '../../middleware/guards';
import { parse } from '../../lib/validate';
import { AuditFeedService } from '../org/audit-feed.service';
import { accentColorSchema } from '../org/settings.service';
import { PlatformService, SLUG_PATTERN, type PlatformActor } from './platform.service';

const orgQuery = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  type: z.enum(ORGANIZATION_TYPES).optional(),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
});

const onboardBody = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(120, 'Use at most 120 characters'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Use at least 3 characters')
    .max(40, 'Use at most 40 characters')
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens'),
  type: z.enum(ORGANIZATION_TYPES, 'Choose institution or competition'),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  adminName: z.string().trim().min(2, 'Enter the admin’s full name').max(120, 'Use at most 120 characters'),
  adminEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
});

const patchBody = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(120, 'Use at most 120 characters').optional(),
  contactEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email address').max(254)]).nullable().optional(),
  branding: z
    .object({
      accentColor: accentColorSchema.nullable().optional(),
      tagline: z.string().trim().max(120, 'Keep the tagline under 120 characters').nullable().optional(),
    })
    .optional(),
});

const suspendBody = z.object({
  reason: z
    .string('Say why the organization is being suspended')
    .trim()
    .min(5, 'Say why, in a few words. The reason is kept in the audit log.')
    .max(500, 'Use at most 500 characters'),
});

const auditQuery = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9_.]+$/i, 'Invalid action filter')
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Platform administration: tenant onboarding and lifecycle, aggregate health, platform audit. Admins only sign in. */
export function platformRoutes(c: Container): Router {
  const router = Router();
  const service = new PlatformService(c.db, c.audit, c.realtime);
  const feed = new AuditFeedService(c.db);
  router.use(requirePlatformAdmin);

  const actor = (req: Parameters<typeof authOf>[0]): PlatformActor => ({ userId: authOf(req).user.id, ip: req.ip });

  router.get('/overview', async (_req, res) => {
    res.json(await service.overview());
  });

  router.get('/organizations', async (req, res) => {
    res.json(await service.listOrganizations(parse(orgQuery, req.query)));
  });

  router.get('/organizations/slug-availability', async (req, res) => {
    const { slug } = parse(z.object({ slug: z.string().max(80).default('') }), req.query);
    res.json(await service.slugAvailability(slug));
  });

  router.post('/organizations', async (req, res) => {
    const body = parse(onboardBody, req.body);
    res.status(201).json(await service.onboard(actor(req), body));
  });

  router.get('/organizations/:id', async (req, res) => {
    res.json(await service.getOrganization(parse(uuidParam, req.params.id)));
  });

  router.patch('/organizations/:id', async (req, res) => {
    const id = parse(uuidParam, req.params.id);
    res.json(await service.updateOrganization(actor(req), id, parse(patchBody, req.body)));
  });

  router.post('/organizations/:id/suspend', async (req, res) => {
    const id = parse(uuidParam, req.params.id);
    const { reason } = parse(suspendBody, req.body);
    res.json(await service.suspend(actor(req), id, reason));
  });

  router.post('/organizations/:id/reactivate', async (req, res) => {
    res.json(await service.reactivate(actor(req), parse(uuidParam, req.params.id)));
  });

  router.get('/audit', async (req, res) => {
    const q = parse(auditQuery, req.query);
    res.json(await feed.forPlatform(q));
  });

  return router;
}
