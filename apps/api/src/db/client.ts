import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 });

export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type Database = NodePgDatabase<typeof schema>;
/** A transaction or the root database; services accept either so callers can compose transactions. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export { schema };
