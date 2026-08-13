import { defineConfig } from 'vitest/config'

import { unitDataDir } from './scripts/test-data-dirs.mjs'

export default defineConfig({
  // scripts/build-client.mjs injects this at bundle time; render tests need it
  // too, otherwise importing ui-render.ts throws on the version label.
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['tests/setup.ts'],
    // Wipes the fixed DATA_DIR below so a run never inherits the previous
    // run's session cache.
    globalSetup: ['tests/global-setup.mjs'],
    env: {
      // Never the default './data'. tests/server.test.ts drives the real app,
      // whose mutations persist through enqueueSave() — pointed at the default
      // it overwrites the sessions and notification settings of a dashboard
      // running from this checkout.
      DATA_DIR: unitDataDir,
    },
  },
})
