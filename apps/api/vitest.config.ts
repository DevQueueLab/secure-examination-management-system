import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { DATABASE_URL: 'postgres://athena:athena@127.0.0.1:5433/athena', LEDGER_SECRET: 'test-ledger-secret-0123456789' },
  },
});
