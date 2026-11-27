import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the org module (mounted in src/routes.ts). */
export function orgRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
