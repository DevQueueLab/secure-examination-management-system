import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the notifications module (mounted in src/routes.ts). */
export function notificationsRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
