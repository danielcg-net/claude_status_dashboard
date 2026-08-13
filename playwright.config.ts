import { defineConfig, devices } from '@playwright/test'

import { e2eDataDir, e2ePort } from './scripts/test-data-dirs.mjs'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // The wipe has to run here, not in globalSetup: Playwright starts the web
    // server first, so a setup hook would delete the directory only after the
    // server had already loaded the previous run's sessions into memory.
    // No argument: the script defaults to the same e2eDataDir this config uses,
    // so there is one source of truth and no shell quoting of a path.
    command: 'node scripts/test-data-dirs.mjs && node dist/server.js',
    url: `http://localhost:${e2ePort}/api/health`,
    // Always start a dedicated server. Reusing one would silently discard the
    // isolated DATA_DIR below, since the environment is only applied to a
    // server this config launches.
    reuseExistingServer: false,
    cwd: '.',
    env: {
      PORT: e2ePort,
      DATA_DIR: e2eDataDir,
      // Exercise the notification code path end-to-end.  The URL points at a
      // port nothing listens on so every POST fails fast (connection refused)
      // and the fire-and-forget handler swallows it.  This proves that
      // notification failures never affect API responses.
      NOTIFY_WEBHOOK_URL: 'http://127.0.0.1:19999/dead',
      NOTIFY_ON: 'started,finished,attention',
    },
  },
})
