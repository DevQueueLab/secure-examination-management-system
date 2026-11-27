import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the monitoring module (mounted in src/routes.ts). */
export function monitoringRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
