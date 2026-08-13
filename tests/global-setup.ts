import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

// DATA_DIR is a fixed path (see vitest.config.ts), so without this a run would
// inherit the session cache left by the previous one — tests/server.test.ts
// loads that cache at import time, which makes leftovers look like real state.
export default async function globalSetup(): Promise<void> {
  await rm(resolve(process.env.DATA_DIR ?? '.test-data/unit'), { recursive: true, force: true })
}
