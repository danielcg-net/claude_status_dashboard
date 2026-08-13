import { unitDataDir, wipeTestDataDir } from '../scripts/test-data-dirs.mjs'

// Unit tests never load this cache — src/server.ts skips its bootstrap when
// NODE_ENV is 'test' — so this is housekeeping, not correctness: it keeps a
// failed run's artifacts from being mistaken for the current run's when
// inspecting them. (The E2E wipe *is* correctness: that server runs as a real
// process and does load the cache.)
//
// The directory is hard-coded, never taken from process.env.DATA_DIR — a
// developer with DATA_DIR exported for their own dashboard would otherwise
// have that directory deleted.
export default function globalSetup() {
  wipeTestDataDir(unitDataDir)
}
