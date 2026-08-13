import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { e2eDataDir } from './test-data-dir.js'

// The data directory is a fixed path, so without this every run would inherit
// the sessions left behind by the previous one. Stale cards break assertions
// that count elements — leftovers from an earlier run look identical to a bug.
export default async function globalSetup(): Promise<void> {
  await rm(resolve(e2eDataDir), { recursive: true, force: true })
}
