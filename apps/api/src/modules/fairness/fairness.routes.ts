import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for paper fairness: simulation of randomized papers and post-exam difficulty audit. */
export function fairnessRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
