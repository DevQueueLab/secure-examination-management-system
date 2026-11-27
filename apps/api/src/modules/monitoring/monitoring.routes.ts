import { Router, type Request } from 'express';
import { uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { parse } from '../../lib/validate';
import { requirePermission, tenantOf } from '../../middleware/guards';
import { attemptEngine } from '../attempts/attempt.service';
import {
  announcementSchema,
  clarificationAnswerSchema,
  clarificationSchema,
  extendAllSchema,
  extendSchema,
  forceSubmitSchema,
  incidentQuerySchema,
  reviewSchema,
} from './monitoring.schemas';
import { MonitoringService, type Actor } from './monitoring.service';

/**
 * Live examination monitoring, mounted at /api/v1/monitoring.
 * Staff reads need monitor.view (plus exam staff access, checked in the service); actions need monitor.intervene.
 * The two candidate endpoints need exams.take and ownership of the attempt. Guards are per route because the
 * router serves both audiences.
 */
export function monitoringRoutes(c: Container): Router {
  const router = Router();
  const service = new MonitoringService(c.db, c.realtime, c.audit, attemptEngine(c));

  const view = requirePermission('monitor.view');
  const intervene = requirePermission('monitor.view', 'monitor.intervene');
  const candidate = requirePermission('exams.take');

  const id = (req: Request, name: string) => parse(uuidParam, req.params[name]);
  const actor = (req: Request): Actor => ({ auth: tenantOf(req), ip: req.ip ?? null });

  // ---- control room
  router.get('/exams/:examId/live', view, async (req, res) => {
    res.json(await service.live(tenantOf(req), id(req, 'examId')));
  });
  router.get('/attempts/:attemptId/timeline', view, async (req, res) => {
    res.json(await service.timeline(tenantOf(req), id(req, 'attemptId')));
  });

  // ---- announcements
  router.get('/exams/:examId/announcements', view, async (req, res) => {
    res.json({ items: await service.listAnnouncements(tenantOf(req), id(req, 'examId')) });
  });
  router.post('/exams/:examId/announcements', intervene, async (req, res) => {
    const input = parse(announcementSchema, req.body);
    res.status(201).json(await service.createAnnouncement(actor(req), id(req, 'examId'), input));
  });
  router.post('/attempts/:attemptId/announcements/:announcementId/read', candidate, async (req, res) => {
    res.json(await service.markAnnouncementRead(tenantOf(req), id(req, 'attemptId'), id(req, 'announcementId')));
  });

  // ---- clarifications
  router.post('/attempts/:attemptId/clarifications', candidate, async (req, res) => {
    const input = parse(clarificationSchema, req.body);
    res.status(201).json(await service.askClarification(tenantOf(req), id(req, 'attemptId'), input));
  });
  router.get('/exams/:examId/clarifications', view, async (req, res) => {
    res.json({ items: await service.listClarifications(tenantOf(req), id(req, 'examId')) });
  });
  router.post('/clarifications/:clarificationId/answer', intervene, async (req, res) => {
    const input = parse(clarificationAnswerSchema, req.body);
    res.json(await service.answerClarification(actor(req), id(req, 'clarificationId'), input));
  });

  // ---- interventions
  router.post('/attempts/:attemptId/extend', intervene, async (req, res) => {
    const input = parse(extendSchema, req.body);
    res.json(await service.extend(actor(req), id(req, 'attemptId'), input));
  });
  router.post('/exams/:examId/extend-all', intervene, async (req, res) => {
    const input = parse(extendAllSchema, req.body);
    res.json(await service.extendAll(actor(req), id(req, 'examId'), input));
  });
  router.post('/attempts/:attemptId/force-submit', intervene, async (req, res) => {
    const input = parse(forceSubmitSchema, req.body);
    res.json(await service.forceSubmit(actor(req), id(req, 'attemptId'), input));
  });

  // ---- integrity indicators
  router.get('/exams/:examId/incidents', view, async (req, res) => {
    const query = parse(incidentQuerySchema, req.query);
    res.json(await service.listIncidents(tenantOf(req), id(req, 'examId'), query));
  });
  router.patch('/events/:eventId/review', intervene, async (req, res) => {
    const input = parse(reviewSchema, req.body);
    res.json(await service.reviewIncident(actor(req), id(req, 'eventId'), input));
  });

  return router;
}
