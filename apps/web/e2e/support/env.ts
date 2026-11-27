import os from 'node:os';
import path from 'node:path';

/**
 * The web origin under test. The API is reached through it (`/api/v1`), exactly as the browser does. There is no
 * default: the flows create people, publish results and decide disputes, so the stack is always chosen on purpose.
 */
const baseUrl = process.env.E2E_BASE_URL;
if (!baseUrl) {
  throw new Error(
    'Set E2E_BASE_URL to the web origin of the stack to test. ' +
      'The flows create people, publish results and decide disputes, so point them at a database you can reset.',
  );
}
export const BASE_URL = baseUrl.replace(/\/$/, '');

/** Optional: flows that move a deadline or look up rows directly need the stack's database. */
export const DATABASE_URL = process.env.E2E_DATABASE_URL;

/** Traces, screenshots, reports and saved sessions live outside the repository. */
export const OUTPUT_ROOT = process.env.E2E_OUTPUT_DIR ?? path.join(os.homedir(), '.cache', 'athena-qa', 'flows');
export const AUTH_DIR = path.join(OUTPUT_ROOT, '.auth');

export const PASSWORD = 'Athena@2026';

/** Seeded demo accounts (apps/api/src/db/seed). */
export const ACCOUNTS = {
  platformAdmin: 'admin@athena.app',
  registrar: 'registrar@northfield.edu',
  sara: 'sara.ahmed@northfield.edu',
  omar: 'omar.farooq@northfield.edu',
  bilal: 'bilal.khan@northfield.edu',
  hina: 'hina.raza@northfield.edu',
  ali: 'ali.hassan@student.northfield.edu',
  ayesha: 'ayesha.malik@student.northfield.edu',
  organizer: 'organizer@codesprint.io',
  judge: 'judge@codesprint.io',
  riverside: 'admin@riverside.edu',
} as const;

export type Role = keyof typeof ACCOUNTS;

/** Where global setup saves each role's signed-in session. */
export const statePath = (role: Role) => path.join(AUTH_DIR, `${role}.json`);

/** Seeded exams, found by title because seeded ids change on every run. */
export const EXAMS = {
  midterm: 'Data Structures & Algorithms Midterm',
  mechanics: 'Mechanics Quiz 3',
  final: 'Database Systems Final',
  draft: 'Software Design Principles',
  qualifier: 'CodeSprint Qualifier 2026',
} as const;
