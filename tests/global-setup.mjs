import { unitDataDir, wipeTestDataDir } from '../scripts/test-data-dirs.mjs'

// tests/server.test.ts loads the session cache at import time, so a leftover
// from a previous run reads as real state. The directory is hard-coded, never
// taken from process.env.DATA_DIR — a developer with DATA_DIR exported for
// their own dashboard would otherwise have that directory deleted.
export default function globalSetup() {
  wipeTestDataDir(unitDataDir)
}
