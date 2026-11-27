import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the attempts module (mounted in src/routes.ts). */
export function attemptsRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
