import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the analytics module (mounted in src/routes.ts). */
export function analyticsRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
