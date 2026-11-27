import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '@athena/shared';
import { isProd } from '../../config/env';

/**
 * Cost and abuse limits for every assist call, keyed by user and organization (never IP):
 *   15 per user per 10 minutes, 150 per organization per hour, 1000 per day in total, 4 in flight at once.
 * ASSIST_USER_LIMIT lowers the per-user ceiling outside production, for testing only.
 */

const BODY_LIMIT = 32 * 1024;
const MAX_IN_FLIGHT = 4;

function devUserLimit(): number {
  const v = Number(process.env.ASSIST_USER_LIMIT);
  return !isProd && Number.isInteger(v) && v > 0 && v < 15 ? v : 15;
}

export function sendTooMany(req: Request, res: Response, retryAfterSeconds: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: `Too many suggestions just now. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      fields: { retryAfter: String(seconds) },
      requestId: req.requestId,
    },
  });
}

function limiter(windowMs: number, limit: number, key: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: key,
    handler: (req, res) => {
      const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      sendTooMany(req, res, reset ? (reset.getTime() - Date.now()) / 1000 : windowMs / 1000);
    },
  });
}

let inFlight = 0;

/** At most MAX_IN_FLIGHT provider calls across the process. */
function concurrency(req: Request, res: Response, next: NextFunction) {
  if (inFlight >= MAX_IN_FLIGHT) return sendTooMany(req, res, 30);
  inFlight++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight--;
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}

/** 32 kB ceiling on assist request bodies (the global JSON parser allows more). */
function bodyCap(req: Request, res: Response, next: NextFunction) {
  const declared = Number(req.headers['content-length'] ?? 0);
  const actual = req.body === undefined ? 0 : Buffer.byteLength(JSON.stringify(req.body));
  if (declared > BODY_LIMIT || actual > BODY_LIMIT) {
    res.status(413).json({ error: { code: ERROR_CODES.VALIDATION, message: 'Request body is too large', requestId: req.requestId } });
    return;
  }
  next();
}

/** Built once per router; each limiter keeps its own in-memory store. Runs after the permission guard. */
export function assistLimits(): RequestHandler[] {
  const userId = (req: Request) => `user:${req.auth?.user.id ?? 'none'}`;
  const orgId = (req: Request) => `org:${req.auth?.organization?.id ?? 'none'}`;
  return [
    bodyCap,
    limiter(10 * 60_000, devUserLimit(), userId),
    limiter(60 * 60_000, 150, orgId),
    limiter(24 * 60 * 60_000, 1000, () => 'all'),
    concurrency,
  ];
}
