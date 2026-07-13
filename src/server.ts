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

const app = new Hono()
const staticRoot = fileURLToPath(new URL('../public', import.meta.url))

// ── Mutable runtime state — all grouped into const containers ──────────

const rt = {
  state: {
    sessions: new Map(),
    notifySettings: notifySettingsSchema.parse({}),
    beepSettings: beepSettingsSchema.parse({}),
  } as AppState,
  cache: {
    hookRef: null as string | null,
    usage: null as { readonly expiresAt: number; readonly summary: UsageSummary } | null,
    version: null as { readonly expiresAt: number; readonly latestVersion: string | null } | null,
  },
  hooks: {
    deletedViaPanel: false,
    lastScope: 'global' as 'global' | 'project',
  },
  queues: {
    save: Promise.resolve() as Promise<void>,
    notifySave: Promise.resolve() as Promise<void>,
    beepSave: Promise.resolve() as Promise<void>,
  },
}

// Auto-detect the git ref for hook downloads. Precedence:
//   1. dist/git-ref.txt  (generated at build time, works in Docker)
//   2. git rev-parse      (works in dev with tsx watch)
//   3. 'main'             (fallback)
// Result is cached — the git ref cannot change at runtime.
const getHookRef = (): string => {
  if (rt.cache.hookRef !== null) return rt.cache.hookRef
  try {
    const ref = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'git-ref.txt'), 'utf-8').trim()
    if (ref) { rt.cache.hookRef = ref; return rt.cache.hookRef }
  } catch { /* not found */ }
  try {
    const ref = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (ref && ref !== 'HEAD') { rt.cache.hookRef = ref; return rt.cache.hookRef }
  } catch { /* git not available or not in a repo */ }
  rt.cache.hookRef = 'main'
  return rt.cache.hookRef
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
const versionCheckUrl = process.env.VERSION_CHECK_URL ?? 'https://raw.githubusercontent.com/danielcg-net/claude_status_dashboard/main/package.json'
const versionCheckTtlMs = Number.parseInt(process.env.VERSION_CHECK_TTL_MS ?? '3600000', 10)
const versionCheckEnabled = (process.env.VERSION_CHECK_ENABLED ?? 'true') !== 'false'

// Serializes all writes: each save reads rt.state.sessions at execution time so it
// always reflects the latest in-memory state even when multiple mutations queue up.
const enqueueSave = (): void => {
  rt.queues.save = rt.queues.save
    .then(() => saveSessions(dataDir, rt.state.sessions))
    .catch((err) => { console.error('Failed to persist sessions:', err) })
}

const enqueueSaveNotifySettings = (): void => {
  rt.queues.notifySave = rt.queues.notifySave
    .then(() => saveNotifySettings(dataDir, rt.state.notifySettings))
    .catch((err) => console.error('Failed to persist notify settings:', err))
}

const enqueueSaveBeepSettings = (): void => {
  rt.queues.beepSave = rt.queues.beepSave
    .then(() => saveBeepSettings(dataDir, rt.state.beepSettings))
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

  if (!rt.cache.version || Date.now() >= rt.cache.version.expiresAt) {
    const latestVersion = versionCheckEnabled ? await checkLatestVersion(versionCheckUrl) : null
    rt.cache.version = {
      expiresAt: Date.now() + versionCheckTtlMs,
      latestVersion,
    }
  }

  const latestVersion = rt.cache.version.latestVersion
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
    sessions: serializeSessions(rt.state.sessions),
    redAlertAfterMs,
  }),
)

app.get('/api/usage', async (context) => {
  if (rt.cache.usage && Date.now() < rt.cache.usage.expiresAt) {
    return context.json(rt.cache.usage.summary)
  }

  const summary = await fetchUsageSummary()
  rt.cache.usage = {
    expiresAt: Date.now() + usageCacheTtlMs,
    summary,
  }

  return context.json(summary)
})

app.post('/api/sessions', async (context) => {
  const input = await parseJson(context.req.raw, registerSessionSchema)
  const previous = input.id ? rt.state.sessions.get(input.id) : undefined
  const [sessions, session] = registerSession(rt.state.sessions, input)
  rt.state = { ...rt.state, sessions }
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
  const previous = rt.state.sessions.get(id)
  const [sessions, session] = updateSession(rt.state.sessions, id, input)
  rt.state = { ...rt.state, sessions }

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
  const [sessions, deleted] = deleteSession(rt.state.sessions, context.req.param('id'))
  rt.state = { ...rt.state, sessions }

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
  context.json(maskNotifySettings(rt.state.notifySettings)),
)

app.put('/api/settings/notify', async (context) => {
  const input = await parseJson(context.req.raw, notifySettingsSchema.partial())
  const updated = { ...rt.state.notifySettings, ...input }
  rt.state = { ...rt.state, notifySettings: updated as NotifySettings }
  const override: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) { if (v !== undefined) (override as Record<string, unknown>)[k] = v }
  setNotifyConfig(override as Parameters<typeof setNotifyConfig>[0])
  enqueueSaveNotifySettings()
  return context.json(maskNotifySettings(updated as NotifySettings))
})

// ---- Beep settings --------------------------------------------------

app.get('/api/settings/beep', (context) =>
  context.json(rt.state.beepSettings),
)

app.put('/api/settings/beep', async (context) => {
  const input = await parseJson(context.req.raw, beepSettingsSchema.partial())
  const updated = { ...rt.state.beepSettings, ...input }
  rt.state = { ...rt.state, beepSettings: updated as BeepSettings }
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
  const parseInput = async (): Promise<HookAction> => {
    try {
      return await parseJson(context.req.raw, hookActionSchema)
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new HTTPException(400, { message: 'Invalid request body.' })
      }
      throw error
    }
  }
  const input = await parseInput()
  // Download ref: HOOKS_VERSION > build-time ref > runtime git > 'main'
  // (determines which git ref to pull the hook script from — not the package version)
  const downloadRef = process.env.HOOKS_VERSION ?? getHookRef()

  try {
    if (input.action === 'install') {
      rt.hooks.deletedViaPanel = false
      rt.hooks.lastScope = input.scope
      await installHooks(input.scope, downloadRef)
    } else {
      await deleteHooks(input.scope)
      rt.hooks.deletedViaPanel = true
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
  rt.state = { sessions: new Map(), notifySettings: notifySettingsSchema.parse({}), beepSettings: beepSettingsSchema.parse({}) }
  rt.cache.usage = null
  rt.cache.version = null
  rt.queues.save = Promise.resolve()
  rt.queues.notifySave = Promise.resolve()
  rt.queues.beepSave = Promise.resolve()
  __resetNotifyConfig()
}

const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')

if (isMain || process.env.NODE_ENV !== 'test') {
  const sessions = await loadSessions(dataDir, sessionTtlMs)
  const persistedNotifySettings = await loadNotifySettings(dataDir)
  const persistedBeepSettings = await loadBeepSettings(dataDir)
  if (persistedNotifySettings !== null) {
    setNotifyConfig(persistedNotifySettings)
    rt.state = { ...rt.state, sessions, notifySettings: persistedNotifySettings }
  } else {
    // No persisted settings — seed state from runtime (env vars) so the GUI
    // shows the effective configuration instead of empty defaults.
    const notifyConfig = getNotifyConfig()
    rt.state = {
      ...rt.state,
      sessions,
      notifySettings: {
        enabled: notifyConfig.enabled,
        webhookUrl: notifyConfig.webhookUrl,
        format: notifyConfig.format,
        events: [...notifyConfig.events] as NotifySettings['events'],
        pushoverToken: notifyConfig.pushoverToken,
        pushoverUser: notifyConfig.pushoverUser,
        headers: { ...notifyConfig.headers },
      },
    }
  }
  if (persistedBeepSettings !== null) {
    rt.state = { ...rt.state, beepSettings: persistedBeepSettings }
  }

  const evictTimer = setInterval(() => {
    const evicted = evictStaleSessions(rt.state.sessions, sessionTtlMs)
    if (evicted.size !== rt.state.sessions.size) {
      rt.state = { ...rt.state, sessions: evicted }
      enqueueSave()
    }
  }, evictIntervalMs)

  // Transition stale working/attention sessions to idle. Runs every 60s
  // (staleIdleMs is the data-age threshold, not the check interval).
  const staleTimer = setInterval(() => {
    const [updated, autoIdled] = transitionStaleSessions(rt.state.sessions, staleIdleMs)
    if (autoIdled.length > 0) {
      rt.state = { ...rt.state, sessions: updated }
      enqueueSave()
      for (const s of autoIdled) {
        console.log(`Auto-idled stale session: ${s.id} (${s.name}) — last update was at ${s.updatedAt}`)
        notify(s.status, s)
      }
    }
  }, 60_000)

  // Periodically check that hooks haven't been overwritten by another process
  // (e.g. Claude Code restoring its own settings.json state). Auto-repairs by
  // silently reinstalling to the last-used scope.
  // Check frequently — Claude Code may overwrite settings.json at any time.
  const hooksHealthIntervalMs = Number.parseInt(
    process.env.HOOKS_HEALTH_CHECK_INTERVAL_MS ?? '30000',
    10,
  )
  const hooksHealth = { wereInstalled: false }
  const hooksHealthTimer = setInterval(async () => {
    const status = await detectHookStatus(getVersion())
    if (status.installed) {
      hooksHealth.wereInstalled = true
      rt.hooks.deletedViaPanel = false
      return
    }
    if (hooksHealth.wereInstalled && !rt.hooks.deletedViaPanel) {
      const ref = process.env.HOOKS_VERSION ?? getHookRef()
      console.warn(
        'hooks health check: dashboard hooks missing — auto-repairing. ' +
        `(scope=${rt.hooks.lastScope}, ref=${ref})`,
      )
      try {
        await installHooks(rt.hooks.lastScope, ref)
      } catch (err) {
        console.error('hooks auto-repair failed:', (err as Error).message)
      }
    }
    hooksHealth.wereInstalled = false
    rt.hooks.deletedViaPanel = false
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
    Promise.all([serverClosed, rt.queues.save.catch(() => {}), rt.queues.notifySave.catch(() => {})]).finally(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
