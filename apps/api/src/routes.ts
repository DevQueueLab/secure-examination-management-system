import { Router } from 'express';
import type { Container } from './container';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { attemptsRoutes } from './modules/attempts/attempts.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { disputesRoutes } from './modules/disputes/disputes.routes';
import { examsRoutes } from './modules/exams/exams.routes';
import { fairnessRoutes } from './modules/fairness/fairness.routes';
import { filesRoutes } from './modules/files/files.routes';
import { gradingRoutes } from './modules/grading/grading.routes';
import { healthRoutes } from './modules/health/health.routes';
import { integrityRoutes } from './modules/integrity/integrity.routes';
import { monitoringRoutes } from './modules/monitoring/monitoring.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { orgRoutes } from './modules/org/org.routes';
import { platformRoutes } from './modules/platform/platform.routes';
import { questionsRoutes } from './modules/questions/questions.routes';
import { publicReportRoutes, reportsRoutes } from './modules/reports/reports.routes';
import { resultsRoutes } from './modules/results/results.routes';

/** Every API route, mounted under /api/v1. Each module owns its own router file. */
export function apiRouter(c: Container): Router {
  const r = Router();
  r.use('/health', healthRoutes(c.db));
  r.use('/auth', authRoutes({ auth: c.auth, sessions: c.sessions, ttlHours: c.config.SESSION_TTL_HOURS }));
  r.use('/public', publicReportRoutes(c));
  r.use('/platform', platformRoutes(c));
  r.use('/org', orgRoutes(c));
  r.use('/questions', questionsRoutes(c));
  r.use('/exams', examsRoutes(c));
  r.use('/attempts', attemptsRoutes(c));
  r.use('/fairness', fairnessRoutes(c));
  r.use('/monitoring', monitoringRoutes(c));
  r.use('/grading', gradingRoutes(c));
  r.use('/results', resultsRoutes(c));
  r.use('/analytics', analyticsRoutes(c));
  r.use('/reports', reportsRoutes(c));
  r.use('/disputes', disputesRoutes(c));
  r.use('/integrity', integrityRoutes(c));
  r.use('/notifications', notificationsRoutes(c));
  r.use('/files', filesRoutes(c));
  return r;
}
