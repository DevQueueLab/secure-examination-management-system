import { defineConfig } from 'vitest/config';

export const E2E_DATABASE_URL = 'postgres://athena:athena@127.0.0.1:5433/athena_e2e';

/**
 * Judge-scenario suite: the real app over HTTP against its own freshly migrated and seeded database.
 * Scenario files share that database, so they run one after another.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: E2E_DATABASE_URL,
      APP_ORIGIN: 'http://localhost:3900',
      LEDGER_SECRET: 'e2e-ledger-secret-0123456789abcdef',
      LOG_LEVEL: 'fatal',
    },
  },
});
