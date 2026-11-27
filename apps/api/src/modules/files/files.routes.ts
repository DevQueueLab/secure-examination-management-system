import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Container } from '../../container';
import { authOf, requireAuth } from '../../middleware/guards';
import { AppError, NotFoundError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { DOCUMENT_CATEGORIES, FilesService, contentDisposition } from './files.service';

const UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/octet-stream',
];
const idParam = z.string().uuid();
const uploadQuery = z.object({
  filename: z.string().max(1024).optional(),
  category: z.enum(DOCUMENT_CATEGORIES, 'Choose a category'),
});

function bodyOf(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new AppError(415, 'VALIDATION_ERROR', 'Send the file as PDF, JPEG, PNG or WebP bytes');
  }
  return req.body;
}

/** A UUID param, or 404 so malformed ids look the same as missing ones. */
function idOf(value: unknown, what: string): string {
  const r = idParam.safeParse(value);
  if (!r.success) throw new NotFoundError(what);
  return r.data;
}

function sendFileHeaders(res: Response, mime: string, size: number) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
}

/** Profile photos and personal documents. Every route needs a session; visibility is checked per file. */
export function filesRoutes(c: Container): Router {
  const router = Router();
  const files = new FilesService(c.db, c.audit);

  const uploadLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `files:${(req as Request).auth?.user.id ?? 'anon'}`,
    handler: (_req, res) =>
      res
        .status(429)
        .json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many uploads. Wait a few minutes and try again.',
          },
        }),
  });

  router.use(requireAuth);

  // ---------- avatar ----------
  router.put(
    '/avatar',
    uploadLimiter,
    express.raw({ type: UPLOAD_TYPES, limit: '300kb' }),
    async (req, res) => {
      res.json({ avatar: await files.setAvatar(authOf(req), bodyOf(req)) });
    },
  );

  router.delete('/avatar', async (req, res) => {
    await files.removeAvatar(authOf(req));
    res.status(204).end();
  });

  router.get('/avatar/:userId', async (req, res) => {
    const row = await files.getAvatar(authOf(req), idOf(req.params.userId, 'Photo'));
    res.setHeader('Cache-Control', 'private, no-cache');
    if (!row) {
      res.status(204).end();
      return;
    }
    const etag = `"${row.id}"`;
    res.setHeader('ETag', etag);
    if (req.header('if-none-match') === etag) {
      res.status(304).end();
      return;
    }
    sendFileHeaders(res, row.mime, row.data.length);
    res.end(row.data);
  });

  // ---------- documents ----------
  router.get('/documents', async (req, res) => {
    res.json(await files.listOwn(authOf(req)));
  });

  router.post(
    '/documents',
    uploadLimiter,
    express.raw({ type: UPLOAD_TYPES, limit: '5mb' }),
    async (req, res) => {
      const q = parse(uploadQuery, req.query);
      const document = await files.upload(authOf(req), {
        body: bodyOf(req),
        filename: q.filename,
        category: q.category,
        ip: req.ip,
      });
      res.status(201).json({ document });
    },
  );

  router.get('/documents/:id', async (req, res) => {
    const row = await files.download(authOf(req), idOf(req.params.id, 'Document'), req.ip);
    sendFileHeaders(res, row.mime, row.data.length);
    res.setHeader('Content-Disposition', contentDisposition(row.filename));
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(row.data);
  });

  router.delete('/documents/:id', async (req, res) => {
    await files.remove(authOf(req), idOf(req.params.id, 'Document'), req.ip);
    res.status(204).end();
  });

  router.get('/users/:userId/documents', async (req, res) => {
    res.json(await files.listForMember(authOf(req), idOf(req.params.userId, 'Person')));
  });

  return router;
}
