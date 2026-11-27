import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { requireAnyPermission, requirePermission, tenantOf } from '../../middleware/guards';
import { parse } from '../../lib/validate';
import { reportsServiceFor } from './reports.service';

const sendPdf = (res: Response, { buffer, filename }: { buffer: Buffer; filename: string }) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', String(buffer.length));
  res.end(buffer);
};


/** Routes for the reports module (mounted at /reports). */
export function reportsRoutes(c: Container): Router {
  const router = Router();
  const svc = reportsServiceFor(c);

  router.get('/attempts/:attemptId/pdf', requireAnyPermission('results.view_own', 'reports.generate'), async (req, res) => {
    sendPdf(res, await svc.attemptPdf(tenantOf(req), parse(uuidParam, req.params.attemptId)));
  });

  router.post('/attempts/:attemptId/issue', requireAnyPermission('results.view_own', 'reports.generate'), async (req, res) => {
    res.json(await svc.issueForAttempt(tenantOf(req), parse(uuidParam, req.params.attemptId)));
  });

  router.get('/exams/:examId/pdf', requirePermission('reports.generate'), async (req, res) => {
    sendPdf(res, await svc.examPdf(tenantOf(req), parse(uuidParam, req.params.examId)));
  });

  return router;
}

/** Unauthenticated endpoints (report verification). Must never expose private data. */
export function publicReportRoutes(c: Container): Router {
  const router = Router();
  const svc = reportsServiceFor(c);

  // Per client IP (IPv6 grouped by subnet by the library's default key generator).
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many verification requests. Wait a minute and try again.' } }),
  });
  router.use(limiter);

  router.get('/verify-key', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(await svc.publicKey());
  });

  router.get('/verify/:code', async (req, res) => {
    const code = parse(z.string().trim().min(1).max(40), req.params.code);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await svc.verify(code));
  });

  return router;
}
