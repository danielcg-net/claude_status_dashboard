import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8787',
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
    url: 'http://localhost:8787/api/health',
    reuseExistingServer: !process.env.CI,
    cwd: '.',
    env: {
      // Exercise the notification code path end-to-end.  The URL points at a
      // port nothing listens on so every POST fails fast (connection refused)
      // and the fire-and-forget handler swallows it.  This proves that
      // notification failures never affect API responses.
      NOTIFY_WEBHOOK_URL: 'http://127.0.0.1:19999/dead',
      NOTIFY_ON: 'started,finished,idle,working,attention',
    },
  },
})
