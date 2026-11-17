import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests of what the ZHEXU extension adds, against the real app.
 *
 *   pnpm exec playwright test -c extensions/zhexu/e2e/playwright.config.ts
 *
 * Two servers are started: the scripted stand-in model (mock-model.mjs) and the
 * app with the extension and its tools switched on, pointed at that model by
 * openmaic.mock.yml. Nothing leaves the machine and no key is needed.
 *
 * The app needs DATABASE_URL, as it always does: CI provides a PostgreSQL
 * service, locally it comes from `.env.local` (`pnpm db:up`). In CI the app is
 * built by a dedicated workflow step, with the two NEXT_PUBLIC_* values below
 * set for the build as well, so this only starts the built server.
 */

// Playwright loads this file as CommonJS (the repository has no `"type": "module"`).
const HERE = __dirname;
const ROOT = join(HERE, '..', '..', '..');
const APP_PORT = 3210;
const MODEL_PORT = 11999;
const CI = Boolean(process.env.CI);
/**
 * `ZHEXU_E2E_BASE_URL` points the tests at an app that is already running, for
 * example the Docker image. Only the stand-in model is started then; the app
 * has to be configured the way the `env` block below configures it.
 */
const EXTERNAL_APP = process.env.ZHEXU_E2E_BASE_URL;

const modelServer = {
  command: `node ${JSON.stringify(join(HERE, 'mock-model.mjs'))} ${MODEL_PORT}`,
  url: `http://127.0.0.1:${MODEL_PORT}/v1/models`,
  reuseExistingServer: !CI,
  timeout: 30_000,
};

const appServer = {
  command: `node node_modules/next/dist/bin/next ${CI ? 'start' : 'dev'} --port ${APP_PORT}`,
  cwd: ROOT,
  url: `http://localhost:${APP_PORT}`,
  reuseExistingServer: !CI,
  timeout: CI ? 120_000 : 240_000,
  env: {
    NEXT_PUBLIC_DEPLOYMENT_EXTENSION: 'zhexu',
    NEXT_PUBLIC_WORKBENCH_ENABLED: 'true',
    OPENMAIC_AGENT_RUNTIME_ENABLED: 'true',
    ZHEXU_DELIVERABLES_ENABLED: 'true',
    ZHEXU_IMAGE_ANNOTATIONS_ENABLED: 'true',
    // The stand-in model listens on 127.0.0.1, which the URL guard refuses otherwise.
    ALLOW_LOCAL_NETWORKS: 'true',
    OPENMAIC_CONFIG: join(HERE, 'openmaic.mock.yml'),
  },
};

export default defineConfig({
  testDir: join(HERE, 'tests'),
  outputDir: join(ROOT, 'test-results', 'zhexu'),
  // The tests share one app and one stand-in model; run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: join(ROOT, 'playwright-report') }]]
    : 'list',
  // A run goes through the model, the tool, the renderer and the store; the
  // dev server also compiles each route on first use.
  timeout: CI ? 90_000 : 180_000,
  use: {
    baseURL: EXTERNAL_APP ?? `http://localhost:${APP_PORT}`,
    locale: 'zh-CN',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // `ZHEXU_E2E_CHANNEL=chrome` (or `msedge`) drives an installed browser,
        // for a machine where Playwright's own Chromium is not downloaded.
        ...(process.env.ZHEXU_E2E_CHANNEL ? { channel: process.env.ZHEXU_E2E_CHANNEL } : {}),
      },
    },
  ],
  webServer: EXTERNAL_APP ? [modelServer] : [modelServer, appServer],
});
