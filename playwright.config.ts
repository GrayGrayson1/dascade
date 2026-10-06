import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build served by the game server (single port).
 * Set E2E_BASE_URL to reuse an already-running dev/prod server instead.
 */
const port = Number(process.env.E2E_PORT ?? 4173);
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://localhost:${port}`;

/**
 * October is Halloween season: no spec should meet the floor's seasonal invite by accident. Every
 * context — including the ones specs open with browser.newContext() — starts with the QA override set
 * to 'off' (apps/web/src/themes/seasonalController.ts); e2e/seasonal.spec.ts opts in with `?season=…`.
 * A spec that passes its own `storageState` must add this entry itself.
 */
const seasonOff = {
  cookies: [],
  origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: 'dascade:qa:season', value: 'off' }] }],
};

export default defineConfig({
  testDir: 'e2e',
  // Separate output dirs let several Playwright runs coexist (E2E_OUTPUT=test-results/<name>).
  outputDir: process.env.E2E_OUTPUT ?? 'test-results',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: seasonOff,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
  webServer: external
    ? undefined
    : {
        command: 'pnpm build && node apps/game-server/dist/index.js',
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: { PORT: String(port), NODE_ENV: 'production', DASCADE_RELAXED_LIMITS: '1' },
      },
});
