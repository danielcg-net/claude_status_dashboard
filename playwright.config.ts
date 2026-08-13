import { defineConfig, devices } from '@playwright/test'

// Deliberately not 8787: the suite creates, mutates, and deletes sessions, so
// pointing it at the port a real dashboard listens on would drive that instance
// (`reuseExistingServer` would hand the tests the running server) and rewrite
// its session store.
const e2ePort = process.env.E2E_PORT ?? '8788'

// Deliberately not './data' — see DATA_DIR in vitest.config.ts.
const e2eDataDir = process.env.E2E_DATA_DIR ?? '.test-data/e2e'

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
