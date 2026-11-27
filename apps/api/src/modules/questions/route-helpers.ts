import type { Request } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors';

const uuid = z.string().uuid();

/** Reads a uuid route param. A malformed id is reported as "not found", the same as an id from another tenant. */
export function idParam(req: Request, name: string, what: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !uuid.safeParse(value).success) throw new NotFoundError(what);
  return value;
}
