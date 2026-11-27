import { pool } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

// The production path: generated migrations plus the database-level guards.
await runMigrations();
await pool.end();
