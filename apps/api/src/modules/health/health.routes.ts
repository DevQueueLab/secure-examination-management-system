import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client';

export function healthRoutes(db: Database): Router {
  const router = Router();
  const startedAt = new Date();
  router.get('/', async (_req, res) => {
    let database = 'ok';
    try {
      await db.execute(sql`select 1`);
    } catch {
      database = 'down';
    }
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      version: process.env.APP_VERSION ?? 'dev',
    });
  });
  return router;
}
