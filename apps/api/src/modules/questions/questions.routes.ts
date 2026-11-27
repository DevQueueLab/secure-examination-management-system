import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the questions module (mounted in src/routes.ts). */
export function questionsRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
