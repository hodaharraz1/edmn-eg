import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a production build (`next start`) backed by a dedicated database
 * (E2E_DATABASE_URL, default edmn_e2e) that the global setup resets, migrates and seeds with demo data.
 * Set E2E_SKIP_BUILD=1 to reuse an existing `.next` build.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
/** Set E2E_BASE_URL to run against a deployed environment (e.g. staging). No local server is started then. */
const REMOTE = process.env.E2E_BASE_URL;
const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://edmn:edmn@localhost:5432/edmn_e2e';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    locale: 'ar-EG',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: REMOTE ? undefined : {
    command: `${process.env.E2E_SKIP_BUILD ? '' : 'npx next build && '}npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: DB, APP_URL: `https://localhost:${PORT}`, EDMN_ENVIRONMENT: 'staging', STORAGE_LOCAL_ROOT: './.e2e-storage', MAIL_DRIVER: 'log', SMS_DRIVER: 'log' },
  },
});
