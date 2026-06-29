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

app.post('/api/sessions', async (context) => {
  const input = await parseJson(context.req.raw, registerSessionSchema)
  const [sessions, session] = registerSession(state.sessions, input)
  state = { sessions }

  return context.json({ session }, 201)
})

app.patch('/api/sessions/:id', async (context) => {
  const input = await parseJson(context.req.raw, updateSessionSchema)
  const [sessions, session] = updateSession(state.sessions, context.req.param('id'), input)
  state = { sessions }

  if (!session) {
    throw new HTTPException(404, { message: 'Session not found.' })
  }

  return context.json({ session })
})

app.delete('/api/sessions/:id', (context) => {
  const [sessions, deleted] = deleteSession(state.sessions, context.req.param('id'))
  state = { sessions }

  if (!deleted) {
    throw new HTTPException(404, { message: 'Session not found.' })
  }

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
