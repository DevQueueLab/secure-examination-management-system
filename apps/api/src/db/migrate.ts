import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';
import { logger } from '../lib/logger';

/** Applies generated migrations, then idempotent SQL (triggers) from src/db/sql. */
export async function runMigrations() {
  const migrationsFolder = path.resolve(process.env.MIGRATIONS_DIR ?? 'drizzle');
  await migrate(db, { migrationsFolder });
  await applySqlFiles(path.resolve(process.env.SQL_DIR ?? 'src/db/sql'));
  logger.info('database migrated');
}

export async function applySqlFiles(dir: string) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(path.join(dir, file), 'utf8'));
  }
}
