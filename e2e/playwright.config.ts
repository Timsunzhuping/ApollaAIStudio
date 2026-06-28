import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// The e2e suite drives the REAL stack: the built web SPA served single-origin by a hermetic,
// in-memory BFF (no DATABASE_URL) with all stub providers. No network, no creds, deterministic.
const PORT = Number(process.env.E2E_PORT ?? 4317);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @apolla/bff start',
    url: `${BASE}/api/health`,
    timeout: 90_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      WEB_DIST: path.resolve(__dirname, '../apps/web/dist'),
      SESSION_SECRET: 'e2e-secret-not-for-prod',
      DATABASE_URL: '', // force the hermetic in-memory harness
      NODE_ENV: 'test', // not production → no Secure cookie over http
    },
  },
});
