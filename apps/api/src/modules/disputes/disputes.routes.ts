import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the disputes module (mounted in src/routes.ts). */
export function disputesRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
