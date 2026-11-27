import fs from 'node:fs';
import { request } from '@playwright/test';
import { signInAs } from './support/api';
import { ACCOUNTS, AUTH_DIR, BASE_URL, statePath, type Role } from './support/env';

/** Roles whose sessions the flows reuse. Riverside is suspended in the seed, so it signs in on demand. */
const ROLES: Role[] = ['platformAdmin', 'registrar', 'sara', 'omar', 'bilal', 'hina', 'organizer'];

/** Routes compiled ahead of the first test, so a cold dev server does not eat into test timeouts. */
const WARM_ROUTES = ['/sign-in', '/dashboard', '/exams', '/results', '/grading', '/disputes', '/my-disputes'];

export default async function globalSetup() {
  const health = await request.newContext({ baseURL: BASE_URL });
  const res = await health.get('/api/v1/health').catch((error: Error) => error);
  if (res instanceof Error || !res.ok()) {
    throw new Error(`Athena is not reachable at ${BASE_URL} (set E2E_BASE_URL and start the stack first)`);
  }
  await health.dispose();

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  for (const role of ROLES) {
    const session = await signInAs(role);
    await session.context.storageState({ path: statePath(role) });
    await session.dispose();
  }

  const warm = await request.newContext({ baseURL: BASE_URL, storageState: statePath('registrar') });
  for (const route of WARM_ROUTES) await warm.get(route, { timeout: 120_000 }).catch(() => undefined);
  await warm.dispose();

  console.log(`[e2e] ${BASE_URL}: signed in ${ROLES.map((role) => ACCOUNTS[role]).join(', ')}`);
}
