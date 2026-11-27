import { Router, type Request } from 'express';
import { z } from 'zod';
import { MEMBERSHIP_STATUSES, PERMISSION_KEYS, paginationQuerySchema, uuidParam, type Permission } from '@athena/shared';
import type { Container } from '../../container';
import { requireAnyPermission, requirePermission, tenantOf } from '../../middleware/guards';
import { parse } from '../../lib/validate';
import { STAFF_PERMISSIONS } from './access';
import { AuditFeedService } from './audit-feed.service';
import { StaffDashboardService } from './dashboard.service';
import { IMPORT_TEMPLATE, MAX_IMPORT_ROWS, PeopleImportService } from './people-import.service';
import { PeopleService, type Actor } from './people.service';
import { RolesService } from './roles.service';
import { OrgSettingsService, accentColorSchema } from './settings.service';

const optionalText = (max: number, message?: string) => z.string().trim().max(max, message).nullable().optional();

const peopleQuery = paginationQuerySchema.extend({
  role: z.string().trim().max(60).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  cohort: z.string().trim().max(64).optional(),
  sort: z.enum(['name', 'recent', 'last_login']).default('name'),
});

const createPerson = z
  .object({
    name: z.string().trim().min(2, 'Enter their full name').max(120, 'Use at most 120 characters'),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
    roleId: z.string().uuid('Choose a role').optional(),
    roleKey: z.string().trim().min(1).max(60).optional(),
    externalId: optionalText(64, 'Use at most 64 characters'),
    cohort: optionalText(64, 'Use at most 64 characters'),
  })
  .refine((v) => v.roleId || v.roleKey, { message: 'Choose a role', path: ['roleId'] });

const patchPerson = z.object({
  roleId: z.string().uuid('Choose a role').optional(),
  roleKey: z.string().trim().min(1).max(60).optional(),
  externalId: optionalText(64, 'Use at most 64 characters'),
  cohort: optionalText(64, 'Use at most 64 characters'),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
});

const importBody = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  data: z.union([z.string().max(3_000_000, 'The file is too large'), z.array(z.unknown()).max(MAX_IMPORT_ROWS + 1)]),
  dryRun: z.boolean().default(true),
  skipInvalid: z.boolean().default(false),
  filename: optionalText(200),
});

const permissionList = z.array(z.enum(PERMISSION_KEYS as [Permission, ...Permission[]], 'Unknown permission')).max(PERMISSION_KEYS.length);
const roleName = z.string().trim().min(2, 'Use at least 2 characters').max(60, 'Use at most 60 characters');
const createRole = z.object({
  name: roleName,
  description: optionalText(240, 'Use at most 240 characters'),
  permissions: permissionList.min(1, 'Choose at least one permission'),
});
const patchRole = z.object({ name: roleName.optional(), description: optionalText(240, 'Use at most 240 characters'), permissions: permissionList.optional() });

const auditQuery = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  actor: z.string().uuid().optional(),
  action: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9_.]+$/i, 'Invalid action filter')
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const patchSettings = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(120, 'Use at most 120 characters').optional(),
  contactEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email address').max(254)]).nullable().optional(),
  branding: z
    .object({
      accentColor: accentColorSchema.nullable().optional(),
      tagline: optionalText(120, 'Keep the tagline under 120 characters'),
    })
    .optional(),
});

const actorOf = (req: Request): Actor => ({ auth: tenantOf(req), ip: req.ip });

/** Tenant administration: people, bulk import, roles, audit log, settings and the staff dashboard. */
export function orgRoutes(c: Container): Router {
  const router = Router();
  const people = new PeopleService(c.db, c.audit, c.sessions, c.realtime);
  const importer = new PeopleImportService(c.db, c.audit);
  const rolesService = new RolesService(c.db, c.audit);
  const feed = new AuditFeedService(c.db);
  const settings = new OrgSettingsService(c.db, c.audit);
  const dashboard = new StaffDashboardService(c.db);

  // ---------- people ----------
  router.get('/people', requirePermission('users.view'), async (req, res) => {
    const q = parse(peopleQuery, req.query);
    res.json(await people.list(tenantOf(req).organization.id, q));
  });

  router.post('/people', requirePermission('users.manage'), async (req, res) => {
    const body = parse(createPerson, req.body);
    res.status(201).json(await people.create(actorOf(req), body));
  });

  router.get('/people/import/template', requirePermission('users.manage'), (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="athena-people-template.csv"');
    res.send(IMPORT_TEMPLATE);
  });

  // JSON body { format, data, dryRun, skipInvalid, filename }, or a raw text/csv body with ?dryRun=false&skipInvalid=true.
  router.post('/people/import', requirePermission('users.manage'), async (req, res) => {
    const raw =
      typeof req.body === 'string'
        ? {
            format: 'csv',
            data: req.body,
            dryRun: req.query.dryRun !== 'false',
            skipInvalid: req.query.skipInvalid === 'true',
            filename: typeof req.query.filename === 'string' ? req.query.filename : null,
          }
        : req.body;
    const body = parse(importBody, raw);
    res.json(await importer.run(actorOf(req), { ...body, filename: body.filename ?? null }));
  });

  router.get('/people/:membershipId', requirePermission('users.view'), async (req, res) => {
    const id = parse(uuidParam, req.params.membershipId);
    res.json(await people.get(tenantOf(req).organization.id, id));
  });

  router.patch('/people/:membershipId', requirePermission('users.manage'), async (req, res) => {
    const id = parse(uuidParam, req.params.membershipId);
    const body = parse(patchPerson, req.body);
    res.json(await people.update(actorOf(req), id, body));
  });

  router.post('/people/:membershipId/reset-password', requirePermission('users.manage'), async (req, res) => {
    const id = parse(uuidParam, req.params.membershipId);
    res.json(await people.resetPassword(actorOf(req), id));
  });

  // ---------- roles ----------
  router.get('/roles', requireAnyPermission('roles.manage', 'users.manage', 'users.view'), async (req, res) => {
    res.json({ items: await rolesService.list(tenantOf(req).organization.id) });
  });

  router.post('/roles', requirePermission('roles.manage'), async (req, res) => {
    const body = parse(createRole, req.body);
    res.status(201).json(await rolesService.create(actorOf(req), body));
  });

  router.patch('/roles/:id', requirePermission('roles.manage'), async (req, res) => {
    const id = parse(uuidParam, req.params.id);
    const body = parse(patchRole, req.body);
    res.json(await rolesService.update(actorOf(req), id, body));
  });

  router.delete('/roles/:id', requirePermission('roles.manage'), async (req, res) => {
    const id = parse(uuidParam, req.params.id);
    await rolesService.remove(actorOf(req), id);
    res.status(204).end();
  });

  // ---------- audit ----------
  router.get('/audit', requirePermission('audit.view'), async (req, res) => {
    const q = parse(auditQuery, req.query);
    res.json(await feed.forOrganization(tenantOf(req).organization.id, { ...q, actorId: q.actor }));
  });

  // ---------- settings ----------
  router.get('/settings', requirePermission('org.settings'), async (req, res) => {
    res.json(await settings.get(tenantOf(req).organization.id));
  });

  router.patch('/settings', requirePermission('org.settings'), async (req, res) => {
    const body = parse(patchSettings, req.body);
    res.json(await settings.update(actorOf(req), body));
  });

  // ---------- staff dashboard ----------
  router.get('/dashboard', requireAnyPermission(...STAFF_PERMISSIONS), async (req, res) => {
    res.json(await dashboard.get(tenantOf(req)));
  });

  return router;
}
