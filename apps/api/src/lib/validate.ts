import type { z } from 'zod';
import { ValidationError } from './errors';

/** Parse untrusted input with a zod schema, turning issues into a field -> message map. */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const first = Object.values(fields)[0];
  throw new ValidationError(first ?? 'Invalid input', fields);
}
