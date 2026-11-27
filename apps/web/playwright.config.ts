import { defineConfig } from '@playwright/test';
import { BASE_URL, OUTPUT_ROOT } from './e2e/support/env';

/**
 * End-to-end flows against a running Athena (web + API + seeded database).
 * Start the stack yourself; this config never launches servers. Point it at a stack with
 * E2E_BASE_URL, and give it E2E_DATABASE_URL for the flows that adjust time through SQL.
 *
 * PW_NVIDIA=1 renders on a discrete NVIDIA GPU through PRIME offload instead of software GL.
 */
const nvidia = process.env.PW_NVIDIA === '1';

export default defineConfig({
  testDir: './e2e',
  outputDir: `${OUTPUT_ROOT}/test-results`,
  globalSetup: './e2e/global-setup.ts',
  // The flows share demo accounts and one database, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: `${OUTPUT_ROOT}/report.json` }],
    ['html', { outputFolder: `${OUTPUT_ROOT}/html`, open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    timezoneId: 'Asia/Karachi',
    locale: 'en-GB',
    launchOptions: nvidia
      ? {
          args: ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
          env: { ...process.env, __NV_PRIME_RENDER_OFFLOAD: '1', __VK_LAYER_NV_optimus: 'NVIDIA_only' },
        }
      : {},
  },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }],
});
