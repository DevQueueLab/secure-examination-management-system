import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the grading module (mounted in src/routes.ts). */
export function gradingRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
