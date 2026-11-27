import { Router } from 'express';
import { z } from 'zod';
import { uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { authOf, requireAuth } from '../../middleware/guards';
import { parse } from '../../lib/validate';
import { NotificationsService } from './notifications.service';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.date().optional(),
  unread: z.enum(['true', 'false']).optional(),
});

/** Every signed-in person has a bell: staff, candidates and platform admins. */
export function notificationsRoutes(c: Container): Router {
  const router = Router();
  const service = new NotificationsService(c.db);
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    res.json(await service.list(authOf(req), { limit: q.limit, before: q.before, unreadOnly: q.unread === 'true' }));
  });

  router.post('/read-all', async (req, res) => {
    res.json(await service.markAllRead(authOf(req)));
  });

  router.post('/:id/read', async (req, res) => {
    const id = parse(uuidParam, req.params.id);
    await service.markRead(authOf(req), id);
    res.status(204).end();
  });

  return router;
}
