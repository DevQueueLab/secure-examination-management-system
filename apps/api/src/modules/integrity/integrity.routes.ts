import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { uuidParam } from '@athena/shared';
import { z } from 'zod';
import type { Container } from '../../container';
import { parse } from '../../lib/validate';
import { requirePermission, tenantOf } from '../../middleware/guards';
import { IntegrityService, type Actor } from './integrity.service';
import { LeakService } from './leak.service';

const leakTraceSchema = z
  .object({
    text: z.string().max(20_000, 'Paste up to 20,000 characters at a time').default(''),
    code: z.string().max(40, 'A watermark code is at most 12 characters').default(''),
  })
  .refine((b) => b.text.trim().length > 0 || b.code.trim().length > 0, {
    message: 'Paste the leaked text or enter a watermark code',
    path: ['text'],
  });

/**
 * Integrity review, mounted at /api/v1/integrity. Every route needs integrity.review; exam-level access is
 * checked in the service (loadExamForStaff). Sensitive lookups (authorship replays, leak traces) are audited.
 */
export function integrityRoutes(c: Container): Router {
  const router = Router();
  const service = new IntegrityService(c.db, c.audit);
  const leaks = new LeakService(c.db, c.audit);
  const review = requirePermission('integrity.review');

  const id = (req: Request, name: string) => parse(uuidParam, req.params[name]);
  const actor = (req: Request): Actor => ({ auth: tenantOf(req), ip: req.ip ?? null });

  router.get('/exams/:examId/overview', review, async (req, res) => {
    res.json(await service.overview(tenantOf(req), id(req, 'examId')));
  });
  router.get('/exams/:examId/similarity', review, async (req, res) => {
    res.json(await service.similarity(tenantOf(req), id(req, 'examId')));
  });
  router.get('/answers/:answerId/provenance', review, async (req, res) => {
    res.json(await service.provenance(actor(req), id(req, 'answerId')));
  });

  // After the permission guard, keyed on the reviewer: candidates get 403, not 429, and a venue NAT is not shared.
  const leakLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `leak:${tenantOf(req).user.id}`,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'That’s a lot of traces in one minute. Wait a moment and try again.' } }),
  });
  router.post('/leak-trace', review, leakLimiter, async (req, res) => {
    res.json(await leaks.trace(actor(req), parse(leakTraceSchema, req.body ?? {})));
  });

  return router;
}
