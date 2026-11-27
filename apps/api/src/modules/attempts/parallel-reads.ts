import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Executor } from '../../db/client';

/**
 * Runs independent reads in parallel on the pool. A transaction (the seed, tests) holds one connection,
 * where node-postgres would only queue them and warns that it will stop doing so, so there they run in order.
 */
export async function inParallel<T extends readonly unknown[]>(
  db: Executor,
  reads: { [K in keyof T]: () => PromiseLike<T[K]> },
): Promise<T> {
  if (!(db instanceof PgTransaction))
    return (await Promise.all(reads.map((read) => read()))) as unknown as T;
  const results: unknown[] = [];
  for (const read of reads) results.push(await read());
  return results as unknown as T;
}
