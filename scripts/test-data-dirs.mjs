// Test data locations, shared by vitest.config.ts, playwright.config.ts, and the
// pre-server cleanup below. Plain .mjs so it can run under bare node before the
// E2E server starts, without a TypeScript loader.

import { rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Every test data directory must live here. The guard below depends on it. */
const testDataRoot = resolve(repoRoot, '.test-data')

// Never './data': a dashboard launched from this checkout uses that path, and
// the suites create, mutate, and delete sessions.
export const unitDataDir = '.test-data/unit'
export const e2eDataDir = process.env.E2E_DATA_DIR ?? '.test-data/e2e'

// Never 8787 either — that is where a real dashboard listens.
export const e2ePort = process.env.E2E_PORT ?? '8788'

/** Deletes a test data directory, refusing any path outside `.test-data/`.
 *  Without this guard an exported DATA_DIR or a mistaken override would turn a
 *  test run into `rm -rf` of real data — the exact failure this file exists to
 *  prevent. Fails loudly rather than silently skipping. */
export const wipeTestDataDir = (dir) => {
  const target = resolve(repoRoot, dir)

  if (target !== testDataRoot && !target.startsWith(testDataRoot + sep)) {
    throw new Error(
      `Refusing to delete ${target}: test data directories must live under ${testDataRoot}.`,
    )
  }

  rmSync(target, { recursive: true, force: true })
}

// CLI form, used by the Playwright webServer command so the wipe happens before
// the server boots and reads the previous run's session cache.
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  try {
    wipeTestDataDir(process.argv[2] ?? e2eDataDir)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
