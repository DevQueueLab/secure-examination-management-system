import { Router } from 'express';
import { uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { requirePermission, tenantOf } from '../../middleware/guards';
import { parse } from '../../lib/validate';
import { AnalyticsService } from './analytics.service';

/** Routes for the analytics module (mounted at /analytics). Real attempts only. */
export function analyticsRoutes(c: Container): Router {
  const router = Router();
  const svc = new AnalyticsService(c);

  router.get('/exams/:examId', requirePermission('analytics.view'), async (req, res) => {
    res.json(await svc.examAnalytics(tenantOf(req), parse(uuidParam, req.params.examId)));
  });

  return router;
}
