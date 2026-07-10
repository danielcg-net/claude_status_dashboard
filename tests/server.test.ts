import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockFetchUsageSummary = vi.hoisted(() => vi.fn())
const mockCheckLatestVersion = vi.hoisted(() => vi.fn())

vi.mock('../src/usage.js', () => ({
  fetchUsageSummary: mockFetchUsageSummary,
}))

vi.mock('../src/version.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/version.js')>()
  return {
    ...actual,
    checkLatestVersion: mockCheckLatestVersion,
  }
})

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

beforeEach(() => {
  __resetForTests()
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

describe('POST /api/sessions', () => {
  it('creates a session with status defaulting to orange', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-session' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.session.name).toBe('test-session')
    expect(body.session.status).toBe('orange')
    expect(body.session.id).toBeDefined()
  })

  it('creates a session with explicit status', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'green-session', status: 'green' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.session.status).toBe('green')
  })

  it('updates an existing session by id', async () => {
    const create = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'my-session', name: 'original', status: 'yellow' }),
    })
    expect(create.status).toBe(201)

    const update = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'my-session', status: 'red' }),
    })
    expect(update.status).toBe(201)
    const body = await update.json()
    expect(body.session.name).toBe('original')
    expect(body.session.status).toBe('red')
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
      body: JSON.stringify({ status: 'red' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.status).toBe('red')
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.request('/api/sessions/nonexistent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'green' }),
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
    mockCheckLatestVersion.mockResolvedValueOnce('0.1.0')

    const res = await app.request('/api/version')
    const body = await res.json()
    expect(body.version).toBe('0.1.0')
    expect(body.latestVersion).toBe('0.1.0')
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
