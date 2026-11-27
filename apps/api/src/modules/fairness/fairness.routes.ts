import { Router, type Request } from 'express';
import { z } from 'zod';
import { uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { parse } from '../../lib/validate';
import { requirePermission, tenantOf } from '../../middleware/guards';
import { FairnessService } from './fairness.service';

export const SIMULATION_RUNS = { min: 50, max: 2000, default: 400 } as const;

/** Any number is accepted and clamped, so a hand-typed ?runs=100000 gets the maximum instead of an error. */
const simulationQuery = z.object({
  runs: z.coerce
    .number()
    .catch(SIMULATION_RUNS.default)
    .default(SIMULATION_RUNS.default)
    .transform((n) => Math.min(SIMULATION_RUNS.max, Math.max(SIMULATION_RUNS.min, Math.round(Number.isFinite(n) ? n : SIMULATION_RUNS.default)))),
});

/**
 * Routes for paper fairness (mounted at /api/v1/fairness): Monte Carlo simulation of randomized papers,
 * post-exam difficulty audit and recalibration of the bank. exams.manage plus examiner access to the exam.
 */
export function fairnessRoutes(c: Container): Router {
  const router = Router();
  const service = new FairnessService(c);
  const manage = requirePermission('exams.manage');
  const examId = (req: Request) => parse(uuidParam, req.params.examId);

  router.get('/exams/:examId/simulation', manage, async (req, res) => {
    const { runs } = parse(simulationQuery, req.query);
    res.json(await service.simulation(tenantOf(req), examId(req), runs));
  });

  router.get('/exams/:examId/audit', manage, async (req, res) => {
    res.json(await service.audit(tenantOf(req), examId(req)));
  });

  router.post('/exams/:examId/recalibrate', manage, async (req, res) => {
    res.json(await service.recalibrate({ auth: tenantOf(req), ip: req.ip ?? null }, examId(req)));
  });

  return router;
}
