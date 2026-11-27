import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  offlineJournalSchema,
  startAttemptSchema,
  submitAttemptSchema,
  syncRequestSchema,
  uuidParam,
} from '@athena/shared';
import type { Container } from '../../container';
import { parse } from '../../lib/validate';
import { requireAnyPermission, requirePermission, tenantOf } from '../../middleware/guards';
import { attemptEngine } from './attempt.service';
import { CandidateExamsService } from './candidate-exams.service';
import { OfflineJournalService } from './offline-journal.service';

const sandboxSchema = z.object({ examId: z.string().uuid() });
const journalDecisionSchema = z.object({
  accept: z.boolean(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * The attempt engine over HTTP, mounted at /api/v1/attempts.
 *
 * Candidates (exams.take) list their exams, open a lobby, start, autosave, submit and read their receipt.
 * Examiners (exams.manage) start sandbox previews and use the same workspace routes on them. Every attempt
 * route is owner-only: the service looks attempts up by id AND the caller's user id, so another person's
 * attempt is indistinguishable from one that does not exist. Answer keys never leave the server.
 */
export function attemptsRoutes(c: Container): Router {
  const router = Router();
  const engine = attemptEngine(c);
  const catalog = new CandidateExamsService(c.db);
  const journal = new OfflineJournalService({ db: c.db, audit: c.audit, realtime: c.realtime });

  const candidate = requirePermission('exams.take');
  /** The workspace routes serve real attempts (exams.take) and sandbox previews (exams.manage). */
  const owner = requireAnyPermission('exams.take', 'exams.manage');
  const manage = requirePermission('exams.manage');
  const intervene = requirePermission('monitor.view', 'monitor.intervene');

  const id = (req: Request, name = 'id') => parse(uuidParam, req.params[name]);

  // ---- dashboard and lobby
  router.get('/exams', candidate, async (req, res) => {
    res.json(await catalog.list(tenantOf(req)));
  });
  router.get('/exams/:examId/lobby', candidate, async (req, res) => {
    res.json(await catalog.lobby(tenantOf(req), id(req, 'examId')));
  });

  // ---- start (idempotent: an attempt in progress is resumed)
  router.post('/', candidate, async (req, res) => {
    res.json(await engine.start(tenantOf(req), parse(startAttemptSchema, req.body)));
  });

  // ---- sandbox previews (SF-4.3)
  router.post('/sandbox', manage, async (req, res) => {
    const { examId } = parse(sandboxSchema, req.body);
    res.status(201).json(await engine.startSandbox(tenantOf(req), examId));
  });
  router.delete('/sandbox/:id', manage, async (req, res) => {
    await engine.discardSandbox(tenantOf(req), id(req));
    res.status(204).end();
  });

  // ---- the workspace
  router.get('/:id', owner, async (req, res) => {
    res.json(await engine.getView(tenantOf(req), id(req)));
  });
  router.post('/:id/claim', owner, async (req, res) => {
    res.json(
      await engine.claim(tenantOf(req), id(req), {
        userAgent: req.get('user-agent')?.slice(0, 400),
      }),
    );
  });
  router.post('/:id/sync', owner, async (req, res) => {
    res.json(await engine.sync(tenantOf(req), id(req), parse(syncRequestSchema, req.body)));
  });
  router.post('/:id/submit', owner, async (req, res) => {
    res.json(await engine.submit(tenantOf(req), id(req), parse(submitAttemptSchema, req.body)));
  });
  router.get('/:id/receipt', owner, async (req, res) => {
    res.json(await engine.receipt(tenantOf(req), id(req)));
  });

  // ---- offline journal (IC-5.3): held for an examiner, never counted automatically
  router.post('/:id/offline-journal', candidate, async (req, res) => {
    res
      .status(202)
      .json(await journal.submit(tenantOf(req), id(req), parse(offlineJournalSchema, req.body)));
  });
  router.post('/:id/offline-journal/decision', intervene, async (req, res) => {
    res.json(await journal.decide(tenantOf(req), id(req), parse(journalDecisionSchema, req.body)));
  });

  return router;
}
