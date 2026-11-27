import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the reports module (mounted in src/routes.ts). */
export function reportsRoutes(_c: Container): Router {
  const router = Router();
  return router;
}

/** Unauthenticated endpoints (report verification). Must never expose private data. */
export function publicReportRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
