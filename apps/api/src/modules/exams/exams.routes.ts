import { Router } from 'express';
import type { Container } from '../../container';

/** Routes for the exams module (mounted in src/routes.ts). */
export function examsRoutes(_c: Container): Router {
  const router = Router();
  return router;
}
