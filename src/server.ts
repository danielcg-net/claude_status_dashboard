import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { fileURLToPath } from 'node:url'
import {
  deleteSession,
  registerSession,
  registerSessionSchema,
  serializeSessions,
  type SessionStore,
  updateSession,
  updateSessionSchema,
} from './domain.js'
import { evictStaleSessions, loadSessions, saveSessions } from './session-store.js'
import { fetchUsageSummary, type UsageSummary } from './usage.js'

type AppState = {
  readonly sessions: SessionStore
}

let state: AppState = {
  sessions: new Map(),
}

const app = new Hono()
const staticRoot = fileURLToPath(new URL('../public', import.meta.url))
const port = Number.parseInt(process.env.PORT ?? '8787', 10)
const hostname = process.env.HOST ?? '0.0.0.0'
const redAlertAfterMs = Number.parseInt(process.env.RED_ALERT_AFTER_MS ?? '300000', 10)
const usageCacheTtlMs = Number.parseInt(process.env.USAGE_CACHE_TTL_MS ?? '30000', 10)
const dataDir = process.env.DATA_DIR ?? 'data'
const sessionTtlMs = Number.parseInt(process.env.SESSION_TTL_MS ?? '604800000', 10)
const evictIntervalMs = Number.parseInt(process.env.SESSION_EVICT_INTERVAL_MS ?? '3600000', 10)
let usageCache: { readonly expiresAt: number; readonly summary: UsageSummary } | null = null

// Serializes all writes: each save reads state.sessions at execution time so it
// always reflects the latest in-memory state even when multiple mutations queue up.
let saveQueue: Promise<void> = Promise.resolve()
const enqueueSave = (): void => {
  saveQueue = saveQueue.then(() => saveSessions(dataDir, state.sessions)).catch((err) => {
    console.error('Failed to persist sessions:', err)
  })
}

const parseJson = async <T>(request: Request, schema: { parse: (value: unknown) => T }): Promise<T> => {
  const body = await request.json().catch(() => {
    throw new HTTPException(400, { message: 'Request body must be valid JSON.' })
  })

  return schema.parse(body)
}

app.use(logger())

app.get('/api/health', (context) =>
  context.json({
    ok: true,
    service: 'claude-status-dashboard',
    redAlertAfterMs,
  }),
)

app.get('/api/sessions', (context) =>
  context.json({
    sessions: serializeSessions(state.sessions),
    redAlertAfterMs,
  }),
)

app.get('/api/usage', async (context) => {
  if (usageCache && Date.now() < usageCache.expiresAt) {
    return context.json(usageCache.summary)
  }

  const summary = await fetchUsageSummary()
  usageCache = {
    expiresAt: Date.now() + usageCacheTtlMs,
    summary,
  }

  return context.json(summary)
})

app.post('/api/sessions', async (context) => {
  const input = await parseJson(context.req.raw, registerSessionSchema)
  const [sessions, session] = registerSession(state.sessions, input)
  state = { sessions }
  enqueueSave()

  return context.json({ session }, 201)
})

app.patch('/api/sessions/:id', async (context) => {
  const input = await parseJson(context.req.raw, updateSessionSchema)
  const [sessions, session] = updateSession(state.sessions, context.req.param('id'), input)
  state = { sessions }

  if (!session) {
    throw new HTTPException(404, { message: 'Session not found.' })
  }

  enqueueSave()
  return context.json({ session })
})

app.delete('/api/sessions/:id', (context) => {
  const [sessions, deleted] = deleteSession(state.sessions, context.req.param('id'))
  state = { sessions }

  if (!deleted) {
    throw new HTTPException(404, { message: 'Session not found.' })
  }

  enqueueSave()
  return context.json({ deleted: true })
})

app.onError((error, context) => {
  if (error instanceof HTTPException) {
    return context.json({ error: error.message }, error.status)
  }

  if (error instanceof Error && error.name === 'ZodError') {
    return context.json({ error: 'Invalid request body.', details: JSON.parse(error.message) }, 400)
  }

  console.error(error)
  return context.json({ error: 'Internal server error.' }, 500)
})

app.use('/assets/*', serveStatic({ root: staticRoot }))
app.use('/favicon.ico', serveStatic({ path: `${staticRoot}/favicon.ico` }))
app.get('*', serveStatic({ path: `${staticRoot}/index.html` }))

export { app }

// Exported for test isolation — resets sessions, usage cache, and save queue.
export const __resetForTests = (): void => {
  state = { sessions: new Map() }
  usageCache = null
  saveQueue = Promise.resolve()
}

const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')

if (isMain || process.env.NODE_ENV !== 'test') {
  const sessions = await loadSessions(dataDir, sessionTtlMs)
  state = { sessions }

  const evictTimer = setInterval(() => {
    const evicted = evictStaleSessions(state.sessions, sessionTtlMs)
    if (evicted.size !== state.sessions.size) {
      state = { sessions: evicted }
      enqueueSave()
    }
  }, evictIntervalMs)

  const shutdown = (): void => {
    clearInterval(evictTimer)
    process.exit(0)
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    (info) => {
      console.log(`Claude status dashboard listening on http://${info.address}:${info.port}`)
    },
  )
}
