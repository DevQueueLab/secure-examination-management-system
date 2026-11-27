import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { AppError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAnyPermission, requirePermission, tenantOf } from '../../middleware/guards';
import { distractorInput, suggestDistractors } from './authoring-assist';
import { assistEnabled } from './gemini';
import { suggestMarks } from './grading-assist';
import { assistLimits } from './limits';

/**
 * Staff-only drafting help (mounted at /assist). Candidates hold none of these permissions, so every route,
 * including /status, answers them 403. Suggestions are never saved: the grader applies and saves them.
 */
export function assistRoutes(c: Container): Router {
  const router = Router();
  const limits = assistLimits();

  const enabled = (_req: Request, _res: Response, next: NextFunction) => {
    if (!assistEnabled()) throw new AppError(503, 'ASSIST_DISABLED', 'Suggestions are not set up on this server.');
    next();
  };

  router.get('/status', requireAnyPermission('grading.grade', 'questions.manage'), (_req, res) => {
    res.json({ enabled: assistEnabled() });
  });

  router.post('/grading/answers/:answerId/suggest', requirePermission('grading.grade'), enabled, ...limits, async (req, res) => {
    res.json(await suggestMarks(c, tenantOf(req), parse(uuidParam, req.params.answerId)));
  });

  router.post('/questions/distractors', requirePermission('questions.manage'), enabled, ...limits, async (req, res) => {
    res.json(await suggestDistractors(tenantOf(req), parse(distractorInput, req.body)));
  });

  return router;
}
