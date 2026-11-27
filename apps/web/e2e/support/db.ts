import { createRequire } from 'node:module';
import { DATABASE_URL } from './env';

/** The slice of node-postgres the flows use. */
interface Pool {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}
type PgModule = { Pool: new (config: { connectionString: string; max: number }) => Pool };

/** True when the stack's database is reachable for direct lookups and time travel. */
export const hasDatabase = Boolean(DATABASE_URL);
export const NEEDS_DATABASE = 'needs E2E_DATABASE_URL (the stack database) to move deadlines';

// The web app has no database driver of its own; borrow the API's.
const requireFromApi = createRequire(new URL('../../../api/package.json', import.meta.url));

let pool: Pool | null = null;

function db(): Pool {
  if (!DATABASE_URL) throw new Error(NEEDS_DATABASE);
  if (!pool) {
    const pg = requireFromApi('pg') as PgModule;
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  }
  return pool;
}

export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await db().query(text, params);
  return rows as T[];
}

export async function closeDatabase() {
  await pool?.end();
  pool = null;
}

/** Moves an attempt's server deadline to `seconds` from now (the server clock decides, never the device). */
export async function setDeadlineIn(attemptId: string, seconds: number) {
  await sql(`update attempts set deadline_at = now() + make_interval(secs => $2) where id = $1`, [attemptId, seconds]);
}

export async function attemptRow(attemptId: string) {
  const [row] = await sql<{ status: string; submit_reason: string | null; deadline_at: Date }>(
    `select status, submit_reason, deadline_at from attempts where id = $1`,
    [attemptId],
  );
  return row;
}
