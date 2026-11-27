import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the integrity module (mounted in src/routes.ts). */
export function integrityRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
