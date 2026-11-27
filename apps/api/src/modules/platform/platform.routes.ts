import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the platform module (mounted in src/routes.ts). */
export function platformRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
