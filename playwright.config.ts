import { defineConfig, devices } from '@playwright/test'

import { e2eDataDir, e2ePort } from './e2e/test-data-dir.js'

export default defineConfig({
  testDir: './e2e',
  // Wipes the fixed data directory so a run never inherits the previous run's
  // sessions.
  globalSetup: './e2e/global-setup.ts',
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
    command: 'node dist/server.js',
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
