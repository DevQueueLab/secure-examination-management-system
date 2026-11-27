/** Postgres error helpers. Drizzle may wrap the driver error, so the code is looked up on the cause too. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  if (e && typeof e.code === 'string') return e.code;
  if (e?.cause && typeof e.cause.code === 'string') return e.cause.code;
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgCode(err) === '23505';
export const isCheckViolation = (err: unknown) => pgCode(err) === '23514';
