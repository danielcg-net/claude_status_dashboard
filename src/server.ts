import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  beepSettingsSchema,
  loadBeepSettings,
  saveBeepSettings,
  type BeepSettings,
} from './beep-settings.js'
import {
  deleteSession,
  registerSession,
  registerSessionSchema,
  serializeSessions,
  type SessionStore,
  transitionStaleSessions,
  updateSession,
  updateSessionSchema,
} from './domain.js'
import { getNotifyConfig, notify, setNotifyConfig } from './notify.js'
import {
  loadNotifySettings,
  notifySettingsSchema,
  saveNotifySettings,
  type NotifySettings,
} from './notify-settings.js'
import { evictStaleSessions, loadSessions, saveSessions } from './session-store.js'
import { fetchUsageSummary, type UsageSummary } from './usage.js'
import {
  deleteHooks,
  detectHookStatus,
  hookActionSchema,
  type HookAction,
  installHooks,
  type HookSettings,
} from './hook-settings.js'
import { checkLatestVersion, compareVersions, getVersion } from './version.js'

type AppState = {
  readonly sessions: SessionStore
  readonly notifySettings: NotifySettings
  readonly beepSettings: BeepSettings
}

let state: AppState = {
  sessions: new Map(),
  notifySettings: notifySettingsSchema.parse({}),
  beepSettings: beepSettingsSchema.parse({}),
}

const app = new Hono()
const staticRoot = fileURLToPath(new URL('../public', import.meta.url))

// Auto-detect the git ref for hook downloads. Precedence:
//   1. dist/git-ref.txt  (generated at build time, works in Docker)
//   2. git rev-parse      (works in dev with tsx watch)
//   3. 'main'             (fallback)
// Result is cached — the git ref cannot change at runtime.
let cachedHookRef: string | null = null
const getHookRef = (): string => {
  if (cachedHookRef !== null) return cachedHookRef
  try {
    const ref = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'git-ref.txt'), 'utf-8').trim()
    if (ref) { cachedHookRef = ref; return cachedHookRef }
  } catch { /* not found */ }
  try {
    const ref = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (ref && ref !== 'HEAD') { cachedHookRef = ref; return cachedHookRef }
  } catch { /* git not available or not in a repo */ }
  cachedHookRef = 'main'
  return cachedHookRef
}
const port = Number.parseInt(process.env.PORT ?? '8787', 10)
const hostname = process.env.HOST ?? '0.0.0.0'
const redAlertAfterMs = Number.parseInt(process.env.RED_ALERT_AFTER_MS ?? '300000', 10)
const usageCacheTtlMs = Number.parseInt(process.env.USAGE_CACHE_TTL_MS ?? '30000', 10)
const dataDir = process.env.DATA_DIR ?? 'data'
const sessionTtlMs = Number.parseInt(process.env.SESSION_TTL_MS ?? '604800000', 10)
const evictIntervalMs = Number.parseInt(process.env.SESSION_EVICT_INTERVAL_MS ?? '3600000', 10)
// Sessions in 'working' or 'attention' state that haven't been updated within
// this window are transitioned to 'idle' — the owning Claude process died.
const staleIdleMs = Number.parseInt(process.env.SESSION_STALE_IDLE_MS ?? '300000', 10)
let usageCache: { readonly expiresAt: number; readonly summary: UsageSummary } | null = null
const versionCheckUrl = process.env.VERSION_CHECK_URL ?? 'https://raw.githubusercontent.com/danielcg-net/claude_status_dashboard/main/package.json'
const versionCheckTtlMs = Number.parseInt(process.env.VERSION_CHECK_TTL_MS ?? '3600000', 10)
const versionCheckEnabled = (process.env.VERSION_CHECK_ENABLED ?? 'true') !== 'false'
let versionCache: { readonly expiresAt: number; readonly latestVersion: string | null } | null = null
// Set by the hooks API handler to suppress the health-check warning when the
// user intentionally deletes hooks via the panel.
let hooksDeletedViaPanel = false
let hooksLastScope: 'global' | 'project' = 'global'

// Serializes all writes: each save reads state.sessions at execution time so it
// always reflects the latest in-memory state even when multiple mutations queue up.
let saveQueue: Promise<void> = Promise.resolve()
const enqueueSave = (): void => {
  saveQueue = saveQueue.then(() => saveSessions(dataDir, state.sessions)).catch((err) => {
    console.error('Failed to persist sessions:', err)
  })
}

let notifySaveQueue: Promise<void> = Promise.resolve()
const enqueueSaveNotifySettings = (): void => {
  notifySaveQueue = notifySaveQueue
    .then(() => saveNotifySettings(dataDir, state.notifySettings))
    .catch((err) => console.error('Failed to persist notify settings:', err))
}

let beepSaveQueue: Promise<void> = Promise.resolve()
const enqueueSaveBeepSettings = (): void => {
  beepSaveQueue = beepSaveQueue
    .then(() => saveBeepSettings(dataDir, state.beepSettings))
    .catch((err) => console.error('Failed to persist beep settings:', err))
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

app.get('/api/version', async (context) => {
  const currentVersion = getVersion()

  if (!versionCache || Date.now() >= versionCache.expiresAt) {
    const latestVersion = versionCheckEnabled ? await checkLatestVersion(versionCheckUrl) : null
    versionCache = {
      expiresAt: Date.now() + versionCheckTtlMs,
      latestVersion,
    }
  }

  const latestVersion = versionCache.latestVersion
  const updateAvailable =
    latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0

  return context.json({
    version: currentVersion,
    latestVersion,
    updateAvailable,
  })
})

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
  const previous = input.id ? state.sessions.get(input.id) : undefined
  const [sessions, session] = registerSession(state.sessions, input)
  state = { ...state, sessions }
  enqueueSave()

  // Fire notifications on session lifecycle events (fire-and-forget).
  if (!previous) {
    notify('started', session)
  }
  // Always fire status-based events when a status transition occurs,
  // including the initial status for new sessions — 'else if' here
  // would skip e.g. 'idle' for a brand-new idle session, so a user
  // who only subscribes to state-based events would never be notified.
  if (!previous || previous.status !== session.status) {
    notify(session.status, session)
  }

  return context.json({ session }, 201)
})

app.patch('/api/sessions/:id', async (context) => {
  const input = await parseJson(context.req.raw, updateSessionSchema)
  const id = context.req.param('id')
  const previous = state.sessions.get(id)
  const [sessions, session] = updateSession(state.sessions, id, input)
  state = { ...state, sessions }

  if (!session) {
    throw new HTTPException(404, { message: 'Session not found.' })
  }

  // Fire notification on status change (fire-and-forget).
  if (previous && previous.status !== session.status) {
    notify(session.status, session)
  }

  enqueueSave()
  return context.json({ session })
})

app.delete('/api/sessions/:id', (context) => {
  const [sessions, deleted] = deleteSession(state.sessions, context.req.param('id'))
  state = { ...state, sessions }

  if (!deleted) {
    throw new HTTPException(404, { message: 'Session not found.' })
  }

  enqueueSave()
  return context.json({ deleted: true })
})

// ---- Notify settings ------------------------------------------------

const maskSecret = (value: string): string => {
  if (!value) return ''
  if (value.length <= 7) return '****'
  return `${value.slice(0, 4)}...${value.slice(-3)}`
}

const maskNotifySettings = (s: NotifySettings) => ({
  enabled: s.enabled,
  webhookUrl: s.webhookUrl,
  format: s.format,
  events: s.events,
  pushoverToken: maskSecret(s.pushoverToken),
  pushoverUser: maskSecret(s.pushoverUser),
  headers: s.headers,
})

app.get('/api/settings/notify', (context) =>
  context.json(maskNotifySettings(state.notifySettings)),
)

app.put('/api/settings/notify', async (context) => {
  const input = await parseJson(context.req.raw, notifySettingsSchema.partial())
  const updated = { ...state.notifySettings, ...input }
  state = { ...state, notifySettings: updated as NotifySettings }
  const override: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) { if (v !== undefined) (override as Record<string, unknown>)[k] = v }
  setNotifyConfig(override as Parameters<typeof setNotifyConfig>[0])
  enqueueSaveNotifySettings()
  return context.json(maskNotifySettings(updated as NotifySettings))
})

// ---- Beep settings --------------------------------------------------

app.get('/api/settings/beep', (context) =>
  context.json(state.beepSettings),
)

app.put('/api/settings/beep', async (context) => {
  const input = await parseJson(context.req.raw, beepSettingsSchema.partial())
  const updated = { ...state.beepSettings, ...input }
  state = { ...state, beepSettings: updated as BeepSettings }
  enqueueSaveBeepSettings()
  return context.json(updated as BeepSettings)
})

// ---- Hooks settings --------------------------------------------------

app.get('/api/settings/hooks', async (context) => {
  const currentVersion = getVersion()
  const status = await detectHookStatus(currentVersion)
  return context.json(status)
})

app.put('/api/settings/hooks', async (context) => {
  let input: HookAction
  try {
    input = await parseJson(context.req.raw, hookActionSchema)
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new HTTPException(400, { message: 'Invalid request body.' })
    }
    throw error
  }
  // Download ref: HOOKS_VERSION > build-time ref > runtime git > 'main'
  // (determines which git ref to pull the hook script from — not the package version)
  const downloadRef = process.env.HOOKS_VERSION ?? getHookRef()

  try {
    if (input.action === 'install') {
      hooksDeletedViaPanel = false
      hooksLastScope = input.scope
      await installHooks(input.scope, downloadRef)
    } else {
      await deleteHooks(input.scope)
      hooksDeletedViaPanel = true
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('PUT /api/settings/hooks failed:', message)
    throw new HTTPException(500, { message })
  }

  // Report status with the package version (consistent with GET)
  const status = await detectHookStatus(getVersion())
  return context.json(status)
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
// Import for test isolation only.
import { __resetNotifyConfig } from './notify.js'

export const __resetForTests = (): void => {
  state = { sessions: new Map(), notifySettings: notifySettingsSchema.parse({}), beepSettings: beepSettingsSchema.parse({}) }
  usageCache = null
  versionCache = null
  saveQueue = Promise.resolve()
  notifySaveQueue = Promise.resolve()
  beepSaveQueue = Promise.resolve()
  __resetNotifyConfig()
}

const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')

if (isMain || process.env.NODE_ENV !== 'test') {
  const sessions = await loadSessions(dataDir, sessionTtlMs)
  const persistedNotifySettings = await loadNotifySettings(dataDir)
  const persistedBeepSettings = await loadBeepSettings(dataDir)
  if (persistedNotifySettings !== null) {
    setNotifyConfig(persistedNotifySettings)
    state = { ...state, sessions, notifySettings: persistedNotifySettings }
  } else {
    // No persisted settings — seed state from runtime (env vars) so the GUI
    // shows the effective configuration instead of empty defaults.
    const rt = getNotifyConfig()
    state = {
      ...state,
      sessions,
      notifySettings: {
        enabled: rt.enabled,
        webhookUrl: rt.webhookUrl,
        format: rt.format,
        events: [...rt.events] as NotifySettings['events'],
        pushoverToken: rt.pushoverToken,
        pushoverUser: rt.pushoverUser,
        headers: { ...rt.headers },
      },
    }
  }
  if (persistedBeepSettings !== null) {
    state = { ...state, beepSettings: persistedBeepSettings }
  }

  const evictTimer = setInterval(() => {
    const evicted = evictStaleSessions(state.sessions, sessionTtlMs)
    if (evicted.size !== state.sessions.size) {
      state = { ...state, sessions: evicted }
      enqueueSave()
    }
  }, evictIntervalMs)

  // Transition stale working/attention sessions to idle. Runs every 60s
  // (staleIdleMs is the data-age threshold, not the check interval).
  const staleTimer = setInterval(() => {
    const [updated, autoIdled] = transitionStaleSessions(state.sessions, staleIdleMs)
    if (autoIdled.length > 0) {
      state = { ...state, sessions: updated }
      enqueueSave()
      for (const s of autoIdled) {
        console.log(`Auto-idled stale session: ${s.id} (${s.name}) — last update was at ${s.updatedAt}`)
      }
    }
  }, 60_000)

  // Periodically check that hooks haven't been overwritten by another process
  // (e.g. Claude Code restoring its own settings.json state). Auto-repairs by
  // silently reinstalling to the last-used scope.
  const hooksHealthIntervalMs = Number.parseInt(
    process.env.HOOKS_HEALTH_CHECK_INTERVAL_MS ?? '300000',
    10,
  )
  let hooksWereInstalled = false
  let hooksLastScope: 'global' | 'project' = 'global'
  const hooksHealthTimer = setInterval(async () => {
    const status = await detectHookStatus(getVersion())
    if (status.installed) {
      hooksWereInstalled = true
      hooksDeletedViaPanel = false
      return
    }
    if (hooksWereInstalled && !hooksDeletedViaPanel) {
      const ref = process.env.HOOKS_VERSION ?? getHookRef()
      console.warn(
        'hooks health check: dashboard hooks missing — auto-repairing. ' +
        `(scope=${hooksLastScope}, ref=${ref})`,
      )
      try {
        await installHooks(hooksLastScope, ref)
      } catch (err) {
        console.error('hooks auto-repair failed:', (err as Error).message)
      }
    }
    hooksWereInstalled = false
    hooksDeletedViaPanel = false
  }, hooksHealthIntervalMs)

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    (info) => {
      console.log(`Claude status dashboard listening on http://${info.address}:${info.port}`)
    },
  )

  const shutdown = (): void => {
    clearInterval(evictTimer)
    clearInterval(staleTimer)
    clearInterval(hooksHealthTimer)
    // Stop accepting new connections; wait for open connections to drain,
    // then flush pending saves before exiting.
    const serverClosed = new Promise<void>((resolve) => server.on('close', resolve))
    server.close()
    Promise.all([serverClosed, saveQueue.catch(() => {}), notifySaveQueue.catch(() => {})]).finally(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
