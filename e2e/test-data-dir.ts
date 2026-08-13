// Shared between playwright.config.ts and the global setup so the port and data
// directory can never drift apart.

// Deliberately not 8787: the suite creates, mutates, and deletes sessions, so
// pointing it at the port a real dashboard listens on would drive that instance
// and rewrite its session store.
export const e2ePort = process.env.E2E_PORT ?? '8788'

// Deliberately not './data' — see DATA_DIR in vitest.config.ts.
export const e2eDataDir = process.env.E2E_DATA_DIR ?? '.test-data/e2e'
