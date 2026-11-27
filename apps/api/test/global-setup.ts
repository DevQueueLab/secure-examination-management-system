import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../vitest.e2e.config';

/** Recreates the scenario database, applies the production migrations, then loads the demo seed. */
export default async function setup() {
  const admin = new pg.Client({ connectionString: E2E_DATABASE_URL.replace(/\/athena_e2e$/, '/postgres') });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS athena_e2e WITH (FORCE)');
  await admin.query('CREATE DATABASE athena_e2e');
  await admin.end();

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: E2E_DATABASE_URL,
    LEDGER_SECRET: 'e2e-ledger-secret-0123456789abcdef',
    LOG_LEVEL: 'fatal',
  };
  const run = (script: string) => execFileSync('pnpm', ['exec', 'tsx', script], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  run('test/prepare-db.ts');
  run('src/db/seed/index.ts');
}
