import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Ensure the session data directory exists before any tests run.
// The server's enqueueSave() fires async writes that race with vitest
// teardown — if the directory is missing, console.error during teardown
// triggers "Closing rpc while onUserConsoleLog was pending" errors.
const dataDir = resolve(process.env.DATA_DIR ?? 'data')
mkdirSync(dataDir, { recursive: true })
