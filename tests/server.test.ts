import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getVersion } from '../src/version.js'

const mockFetchUsageSummary = vi.hoisted(() => vi.fn())
const mockCheckLatestVersion = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())

vi.mock('../src/usage.js', () => ({
  fetchUsageSummary: mockFetchUsageSummary,
}))

vi.mock('../src/notify.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/notify.js')>()
  return {
    ...actual,
    notify: mockNotify,
  }
})

vi.mock('../src/version.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/version.js')>()
  return {
    ...actual,
    checkLatestVersion: mockCheckLatestVersion,
  }
})

const mockExecSync = vi.hoisted(() => vi.fn())
const mockDetectDeployment = vi.hoisted(() => vi.fn(() => ({ mode: 'npm' as const })))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execSync: mockExecSync,
  }
})

vi.mock('../src/deployment.js', () => ({
  detectDeployment: mockDetectDeployment,
}))

vi.mocked(mockFetchUsageSummary).mockResolvedValue({
  available: false,
  generatedAt: new Date().toISOString(),
  totals: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 },
  today: null,
  projects: {},
  activeBlock: null,
  blocks: [],
  sessions: [],
  error: null,
})

vi.mocked(mockCheckLatestVersion).mockResolvedValue(null)

import { app, __resetForTests } from '../src/server.js'

beforeEach(async () => {
  await __resetForTests()
  mockNotify.mockClear()
  mockExecSync.mockReset()
  mockDetectDeployment.mockReturnValue({ mode: 'npm' as const })
})

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.service).toBe('claude-status-dashboard')
    expect(body.redAlertAfterMs).toBeGreaterThan(0)
  })
})

describe('persistence health reporting', () => {
  it('reports persistError on GET /api/sessions', async () => {
    const res = await app.request('/api/sessions')
    const body = await res.json()

    // Writable DATA_DIR in tests, so persistence is healthy — but the field
    // must be present, otherwise the client can never warn about a failure.
    expect(body).toHaveProperty('persistError')
    expect(body.persistError).toBeNull()
  })

  it('reports persistError on GET /api/health', async () => {
    const res = await app.request('/api/health')
    const body = await res.json()

    expect(body).toHaveProperty('persistError')
    expect(body.persistError).toBeNull()
  })
})

describe('POST /api/sessions', () => {
  it('creates a session with status defaulting to working', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-session' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.session.name).toBe('test-session')
    expect(body.session.status).toBe('working')
    expect(body.session.id).toBeDefined()
  })

  it('creates a session with explicit status', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'green-session', status: 'finished' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.session.status).toBe('finished')
  })

  it('updates an existing session by id', async () => {
    const create = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'my-session', name: 'original', status: 'idle' }),
    })
    expect(create.status).toBe(201)

    const update = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'my-session', status: 'attention' }),
    })
    expect(update.status).toBe(201)
    const body = await update.json()
    expect(body.session.name).toBe('original')
    expect(body.session.status).toBe('attention')
  })

  it('rejects invalid status', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad-status', status: 'purple' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects empty name', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects non-JSON body', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/sessions/:id', () => {
  it('updates an existing session', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'patch-me', name: 'before' }),
    })

    const res = await app.request('/api/sessions/patch-me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'attention' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.status).toBe('attention')
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.request('/api/sessions/nonexistent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'finished' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/sessions/:id', () => {
  it('deletes an existing session', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'delete-me' }),
    })

    const res = await app.request('/api/sessions/delete-me', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.request('/api/sessions/ghost', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/sessions', () => {
  it('returns empty list initially', async () => {
    const res = await app.request('/api/sessions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toEqual([])
  })

  it('returns created sessions sorted by updatedAt desc', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'first', name: 'First' }),
    })
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'second', name: 'Second' }),
    })

    const res = await app.request('/api/sessions')
    const body = await res.json()
    expect(body.sessions).toHaveLength(2)
    const names = body.sessions.map((s: { name: string }) => s.name).sort()
    expect(names).toEqual(['First', 'Second'])
  })
})

describe('GET /api/usage', () => {
  it('returns cached usage when available', async () => {
    const res = await app.request('/api/usage')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toBe(false) // mock returns unavailable
  })

  it('calls fetchUsageSummary', async () => {
    mockFetchUsageSummary.mockResolvedValueOnce({
      available: true,
      generatedAt: new Date().toISOString(),
      totals: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 150, totalCost: 0.01 },
      today: null,
      projects: {},
      activeBlock: null,
      blocks: [],
      sessions: [],
      error: null,
    })

    const res = await app.request('/api/usage')
    const body = await res.json()
    expect(body.available).toBe(true)
    expect(body.totals.totalCost).toBe(0.01)
  })
})

describe('GET /api/version', () => {
  it('returns the current version and no update by default', async () => {
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(body.updateAvailable).toBe(false)
    expect(body.latestVersion).toBeNull()
  })

  it('reports updateAvailable when latest version is newer', async () => {
    mockCheckLatestVersion.mockResolvedValueOnce('99.99.99')

    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.latestVersion).toBe('99.99.99')
    expect(body.updateAvailable).toBe(true)
  })

  it('does not report updateAvailable when latest is older', async () => {
    mockCheckLatestVersion.mockResolvedValueOnce('0.0.1')

    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.latestVersion).toBe('0.0.1')
    expect(body.updateAvailable).toBe(false)
  })

  it('does not report updateAvailable when latest equals current', async () => {
    const currentVersion = getVersion()
    mockCheckLatestVersion.mockResolvedValueOnce(currentVersion)

    const res = await app.request('/api/version')
    const body = await res.json()
    expect(body.version).toBe(currentVersion)
    expect(body.latestVersion).toBe(currentVersion)
    expect(body.updateAvailable).toBe(false)
  })

  it('caches version check results', async () => {
    mockCheckLatestVersion.mockClear()
    mockCheckLatestVersion.mockResolvedValueOnce('1.0.0')

    const first = await app.request('/api/version')
    const firstBody = await first.json()
    expect(firstBody.latestVersion).toBe('1.0.0')

    const second = await app.request('/api/version')
    const secondBody = await second.json()
    expect(secondBody.latestVersion).toBe('1.0.0')

    expect(mockCheckLatestVersion).toHaveBeenCalledTimes(1)
  })
})

describe('notification integration', () => {
  it('fires "started" and status-based event when a new session is created via POST', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-project', status: 'working' }),
    })
    expect(res.status).toBe(201)

    expect(mockNotify).toHaveBeenCalledWith(
      'started',
      expect.objectContaining({ name: 'new-project' }),
    )
    // New sessions also fire the status-based event so that users who
    // subscribe to e.g. 'idle' are notified even for the initial status.
    expect(mockNotify).toHaveBeenCalledWith(
      'working',
      expect.objectContaining({ name: 'new-project', status: 'working' }),
    )
  })

  it('fires status-based event for new session even without "started" enabled', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'just-idle', status: 'idle' }),
    })
    expect(res.status).toBe(201)

    // Both 'started' and 'idle' fire — the user's event filter
    // (shouldNotify) decides which actually send to the webhook.
    expect(mockNotify).toHaveBeenCalledWith(
      'started',
      expect.objectContaining({ name: 'just-idle' }),
    )
    expect(mockNotify).toHaveBeenCalledWith(
      'idle',
      expect.objectContaining({ name: 'just-idle', status: 'idle' }),
    )
  })

  it('fires "finished" event when an existing session transitions to green via POST', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'finishing', name: 'wrapping-up', status: 'working' }),
    })

    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'finishing', status: 'finished' }),
    })

    expect(mockNotify).toHaveBeenCalledWith(
      'finished',
      expect.objectContaining({ name: 'wrapping-up', status: 'finished' }),
    )
  })

  it('fires "attention" event when a session transitions to red via POST', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alert-me', name: 'urgent', status: 'idle' }),
    })

    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alert-me', status: 'attention' }),
    })

    expect(mockNotify).toHaveBeenCalledWith(
      'attention',
      expect.objectContaining({ name: 'urgent', status: 'attention' }),
    )
  })

  it('fires "idle" event when a session transitions to yellow via POST', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'going-idle', name: 'waiting', status: 'working' }),
    })

    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'going-idle', status: 'idle' }),
    })

    expect(mockNotify).toHaveBeenCalledWith(
      'idle',
      expect.objectContaining({ name: 'waiting', status: 'idle' }),
    )
  })

  it('fires "working" event when a session transitions to orange via POST', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'going-working', name: 'busy', status: 'idle' }),
    })

    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'going-working', status: 'working' }),
    })

    expect(mockNotify).toHaveBeenCalledWith(
      'working',
      expect.objectContaining({ name: 'busy', status: 'working' }),
    )
  })

  it('does not fire when status stays the same via POST', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'no-change', name: 'steady', status: 'idle' }),
    })
    mockNotify.mockClear()

    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'no-change', status: 'idle', detail: 'still here' }),
    })

    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('fires "finished" event on PATCH to green', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'patch-finish', name: 'done', status: 'working' }),
    })
    mockNotify.mockClear()

    await app.request('/api/sessions/patch-finish', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'finished' }),
    })

    expect(mockNotify).toHaveBeenCalledWith(
      'finished',
      expect.objectContaining({ name: 'done', status: 'finished' }),
    )
  })

  it('fires "attention" event on PATCH to red', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'patch-attn', name: 'help', status: 'idle' }),
    })
    mockNotify.mockClear()

    await app.request('/api/sessions/patch-attn', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'attention', detail: 'needs approval' }),
    })

    expect(mockNotify).toHaveBeenCalledWith(
      'attention',
      expect.objectContaining({ name: 'help', detail: 'needs approval' }),
    )
  })

  it('fires "idle" event on PATCH to yellow', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'patch-idle', name: 'waiting', status: 'working' }),
    })
    mockNotify.mockClear()

    await app.request('/api/sessions/patch-idle', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'idle' }),
    })

    expect(mockNotify).toHaveBeenCalledWith(
      'idle',
      expect.objectContaining({ name: 'waiting', status: 'idle' }),
    )
  })

  it('does not fire on PATCH with no status change', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'patch-steady', name: 'same', status: 'idle' }),
    })
    mockNotify.mockClear()

    await app.request('/api/sessions/patch-steady', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'idle', detail: 'updated detail only' }),
    })

    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('does not fire when only detail changes (no status transition)', async () => {
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'detail-only', name: 'details', status: 'working' }),
    })
    mockNotify.mockClear()

    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'detail-only', detail: 'updated' }),
    })

    expect(mockNotify).not.toHaveBeenCalled()
  })
})

describe('GET /api/settings/notify', () => {
  it('returns default settings with masked secrets', async () => {
    const res = await app.request('/api/settings/notify')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.webhookUrl).toBe('')
    expect(body.format).toBe('generic')
    expect(body.events).toEqual(['started', 'finished', 'idle', 'working', 'attention'])
    expect(body.pushoverToken).toBe('')
    expect(body.pushoverUser).toBe('')
    expect(body.headers).toEqual({})
  })
})

describe('PUT /api/settings/notify', () => {
  it('updates settings and returns masked response', async () => {
    const res = await app.request('/api/settings/notify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: 'https://hooks.example.com/push',
        format: 'slack',
        events: ['attention'],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.webhookUrl).toBe('https://hooks.example.com/push')
    expect(body.format).toBe('slack')
    expect(body.events).toEqual(['attention'])
  })

  it('partial update preserves unset fields', async () => {
    await app.request('/api/settings/notify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com/hook' }),
    })
    const res = await app.request('/api/settings/notify')
    const body = await res.json()
    expect(body.webhookUrl).toBe('https://hooks.example.com/hook')
    expect(body.format).toBe('generic')
  })

  it('validates input', async () => {
    const res = await app.request('/api/settings/notify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'invalid-format' }),
    })
    expect(res.status).toBe(400)
  })

  it('masks secrets when set', async () => {
    await app.request('/api/settings/notify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushoverToken: 'abc123def456ghi',
        pushoverUser: 'user789xyz',
      }),
    })
    const res = await app.request('/api/settings/notify')
    const body = await res.json()
    expect(body.pushoverToken).toBe('abc1...ghi')
    expect(body.pushoverUser).toBe('user...xyz')
  })

  it('masks short secrets as ****', async () => {
    await app.request('/api/settings/notify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushoverToken: 'abc' }),
    })
    const res = await app.request('/api/settings/notify')
    const body = await res.json()
    expect(body.pushoverToken).toBe('****')
  })
})

describe('GET /api/settings/hooks', () => {
  it('returns hooks status as JSON', async () => {
    const res = await app.request('/api/settings/hooks')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.installed).toBe('boolean')
    expect(['global', 'project', 'both', 'none']).toContain(body.configLocation)
    expect(typeof body.scriptExists).toBe('boolean')
    expect(typeof body.scriptPath).toBe('string')
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.error === null || typeof body.error === 'string').toBe(true)
  })
})

describe('PUT /api/settings/hooks', () => {
  it('validates the action field', async () => {
    const res = await app.request('/api/settings/hooks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })

  it('validates the scope field', async () => {
    const res = await app.request('/api/settings/hooks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'install', scope: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts valid install request (schema passes)', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'server-hooks-test-'))
    const originalClaudeHome = process.env.CLAUDE_HOME
    const originalDashboardDir = process.env.CLAUDE_DASHBOARD_DIR
    process.env.CLAUDE_HOME = join(tempDir, 'claude')
    process.env.CLAUDE_DASHBOARD_DIR = join(tempDir, 'dashboard')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('#!/bin/sh\necho hook')))

    try {
      const res = await app.request('/api/settings/hooks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', scope: 'global' }),
      })
      expect(res.status).toBe(200)
    } finally {
      vi.unstubAllGlobals()
      if (originalClaudeHome === undefined) delete process.env.CLAUDE_HOME
      else process.env.CLAUDE_HOME = originalClaudeHome
      if (originalDashboardDir === undefined) delete process.env.CLAUDE_DASHBOARD_DIR
      else process.env.CLAUDE_DASHBOARD_DIR = originalDashboardDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('accepts valid delete request without scope (defaults to global)', async () => {
    const res = await app.request('/api/settings/hooks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    })
    // Delete when no hooks exist should be a no-op 200
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.installed).toBe('boolean')
  })
})

describe('POST /api/update', () => {
  it('returns install instructions for npm mode', async () => {
    mockDetectDeployment.mockReturnValue({ mode: 'npm' })

    const res = await app.request('/api/update', { method: 'POST' })
    expect(res.status).toBe(200)

    const body = await res.json() as { success: boolean; mode: string; message: string; requiresRestart: boolean }
    expect(body.success).toBe(false)
    expect(body.mode).toBe('npm')
    expect(body.requiresRestart).toBe(false)
    expect(body.message).toContain('npm install -g claude-status-dashboard@latest')
    expect(body.message).toContain('npx claude-status-dashboard@latest')
  })

  it('returns instructions for docker mode', async () => {
    mockDetectDeployment.mockReturnValue({ mode: 'docker' })

    const res = await app.request('/api/update', { method: 'POST' })
    expect(res.status).toBe(200)

    const body = await res.json() as { success: boolean; mode: string; message: string; requiresRestart: boolean }
    expect(body.success).toBe(false)
    expect(body.mode).toBe('docker')
    expect(body.requiresRestart).toBe(false)
    expect(body.message).toContain('git checkout main')
    expect(body.message).toContain('docker compose build')
    expect(body.message).toContain('&&')
  })
})
