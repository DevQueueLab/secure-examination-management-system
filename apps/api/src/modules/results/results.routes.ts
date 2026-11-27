import { Router } from 'express';
import { z } from 'zod';
import { uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { requireAnyPermission, requirePermission, tenantOf } from '../../middleware/guards';
import { parse } from '../../lib/validate';
import { reportsServiceFor } from '../reports/reports.service';
import { ResultsService } from './results.service';

const publishSchema = z.object({
  force: z.boolean().default(false),
  reason: z.string().trim().max(1000, 'Keep the reason under 1000 characters').nullable().optional(),
});
const unpublishSchema = z.object({
  reason: z.string().trim().min(10, 'Explain why, in at least 10 characters').max(1000, 'Keep the reason under 1000 characters'),
});

/** Routes for the results module (mounted at /results). */
export function resultsRoutes(c: Container): Router {
  const router = Router();
  const svc = new ResultsService(c, reportsServiceFor(c));

  // Candidate
  router.get('/mine', requirePermission('results.view_own'), async (req, res) => {
    res.json(await svc.mine(tenantOf(req)));
  });
  router.get('/mine/:attemptId', requirePermission('results.view_own'), async (req, res) => {
    res.json(await svc.mineDetail(tenantOf(req), parse(uuidParam, req.params.attemptId)));
  });

  // Staff
  router.get('/exams/:examId', requireAnyPermission('analytics.view', 'results.publish'), async (req, res) => {
    res.json(await svc.examResults(tenantOf(req), parse(uuidParam, req.params.examId)));
  });
  router.post('/exams/:examId/publish', requirePermission('results.publish'), async (req, res) => {
    res.json(await svc.publish(tenantOf(req), parse(uuidParam, req.params.examId), parse(publishSchema, req.body ?? {})));
  });
  router.post('/exams/:examId/unpublish', requirePermission('results.publish'), async (req, res) => {
    res.json(await svc.unpublish(tenantOf(req), parse(uuidParam, req.params.examId), parse(unpublishSchema, req.body ?? {})));
  });

  return router;
}
