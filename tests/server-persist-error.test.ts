import { describe, it, expect, vi } from 'vitest'

// Forces every session save to fail so the server's error path can be driven
// end to end. Isolated in its own file because the mock has to be in place
// before src/server.ts is imported, and tests/server.test.ts needs the real one.
const mockSaveSessions = vi.hoisted(() => vi.fn())

vi.mock('../src/session-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/session-store.js')>()
  return {
    ...actual,
    saveSessions: mockSaveSessions,
  }
})

vi.mock('../src/usage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/usage.js')>()
  return {
    ...actual,
    fetchUsageSummary: vi.fn().mockResolvedValue({ available: false, error: null, projects: {} }),
  }
})

const saveError = 'Cannot write the session cache at /data/sessions.json (EACCES)'
mockSaveSessions.mockResolvedValue({ ok: false, error: saveError })

const { app } = await import('../src/server.js')

const registerSession = async (id: string): Promise<void> => {
  const response = await app.request('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: id, status: 'working', detail: 'go' }),
  })
  expect(response.status).toBe(201)
}

describe('persistError propagation', () => {
  it('surfaces a save failure on /api/sessions and /api/health', async () => {
    await registerSession('persist-fail')

    // enqueueSave() is fire-and-forget, so the queue settles after the response.
    await vi.waitFor(async () => {
      const body = await (await app.request('/api/sessions')).json()
      expect(body.persistError).toBe(saveError)
    })

    const health = await (await app.request('/api/health')).json()
    expect(health.persistError).toBe(saveError)
    // The write failed, but the session is still served from memory — that is
    // exactly the situation the banner has to warn about.
    expect((await (await app.request('/api/sessions')).json()).sessions).toHaveLength(1)
  })

  it('clears the error once a save succeeds again', async () => {
    mockSaveSessions.mockResolvedValue({ ok: true })
    await registerSession('persist-recovered')

    await vi.waitFor(async () => {
      const body = await (await app.request('/api/sessions')).json()
      expect(body.persistError).toBeNull()
    })
  })
})
