import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@athena/shared';
import { ERROR_CODES } from '@athena/shared';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, res: Response) {
  const body: ApiErrorBody = { error: { code: ERROR_CODES.NOT_FOUND, message: `No route for ${req.method} ${req.path}`, requestId: req.requestId } };
  res.status(404).json(body);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, fields: err.fields, requestId: req.requestId } };
    res.status(err.status).json(body);
    return;
  }
  const e = err as { type?: string; status?: number; message?: string };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: ERROR_CODES.VALIDATION, message: 'Malformed JSON body', requestId: req.requestId } });
    return;
  }
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: ERROR_CODES.VALIDATION, message: 'Request body is too large', requestId: req.requestId } });
    return;
  }
  logger.error({ err, requestId: req.requestId, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong on our side. Please try again.', requestId: req.requestId } });
}
