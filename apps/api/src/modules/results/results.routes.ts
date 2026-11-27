import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the results module (mounted in src/routes.ts). */
export function resultsRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
