import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Session, SessionStore } from '../src/domain.js'
import { evictStaleSessions, loadSessions, saveSessions } from '../src/session-store.js'

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'test-id',
  name: 'Test Session',
  usageProject: null,
  status: 'finished',
  detail: 'done',
  summary: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  statusSince: new Date().toISOString(),
  ...overrides,
})

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'session-store-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('evictStaleSessions', () => {
  it('keeps sessions updated within the TTL', () => {
    const recent = makeSession({ id: 'recent', updatedAt: new Date().toISOString() })
    const store: SessionStore = new Map([['recent', recent]])
    const result = evictStaleSessions(store, 7 * 24 * 60 * 60 * 1000)
    expect(result.size).toBe(1)
    expect(result.has('recent')).toBe(true)
  })

  it('removes sessions older than the TTL', () => {
    const old = makeSession({ id: 'old', updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() })
    const store: SessionStore = new Map([['old', old]])
    const result = evictStaleSessions(store, 7 * 24 * 60 * 60 * 1000)
    expect(result.size).toBe(0)
  })

  it('keeps recent and removes old in a mixed store', () => {
    const recent = makeSession({ id: 'recent', updatedAt: new Date().toISOString() })
    const old = makeSession({ id: 'old', updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() })
    const store: SessionStore = new Map([['recent', recent], ['old', old]])
    const result = evictStaleSessions(store, 7 * 24 * 60 * 60 * 1000)
    expect(result.size).toBe(1)
    expect(result.has('recent')).toBe(true)
    expect(result.has('old')).toBe(false)
  })

  it('returns empty map when all sessions are stale', () => {
    const s1 = makeSession({ id: 's1', updatedAt: new Date(0).toISOString() })
    const s2 = makeSession({ id: 's2', updatedAt: new Date(0).toISOString() })
    const store: SessionStore = new Map([['s1', s1], ['s2', s2]])
    const result = evictStaleSessions(store, 7 * 24 * 60 * 60 * 1000)
    expect(result.size).toBe(0)
  })

  it('keeps a session whose updatedAt is exactly at the cutoff boundary', () => {
    const ttlMs = 7 * 24 * 60 * 60 * 1000
    const exactCutoff = new Date(Date.now() - ttlMs).toISOString()
    const boundary = makeSession({ id: 'boundary', updatedAt: exactCutoff })
    const store: SessionStore = new Map([['boundary', boundary]])
    const result = evictStaleSessions(store, ttlMs)
    expect(result.has('boundary')).toBe(true)
  })

  it('does not mutate the original store', () => {
    const old = makeSession({ id: 'old', updatedAt: new Date(0).toISOString() })
    const store: SessionStore = new Map([['old', old]])
    evictStaleSessions(store, 7 * 24 * 60 * 60 * 1000)
    expect(store.size).toBe(1)
  })
})

describe('saveSessions / loadSessions round-trip', () => {
  it('persists and reloads sessions faithfully', async () => {
    const session = makeSession({ id: 'abc', name: 'My Session', status: 'attention' })
    const store: SessionStore = new Map([['abc', session]])
    await saveSessions(tmpDir, store)
    const loaded = await loadSessions(tmpDir, 7 * 24 * 60 * 60 * 1000)
    expect(loaded.size).toBe(1)
    expect(loaded.get('abc')).toEqual(session)
  })

  it('returns empty map when file does not exist', async () => {
    const result = await loadSessions(tmpDir, 7 * 24 * 60 * 60 * 1000)
    expect(result.size).toBe(0)
  })

  it('evicts stale sessions on load', async () => {
    const recent = makeSession({ id: 'recent', updatedAt: new Date().toISOString() })
    const old = makeSession({ id: 'old', updatedAt: new Date(0).toISOString() })
    const store: SessionStore = new Map([['recent', recent], ['old', old]])
    await saveSessions(tmpDir, store)
    const loaded = await loadSessions(tmpDir, 7 * 24 * 60 * 60 * 1000)
    expect(loaded.size).toBe(1)
    expect(loaded.has('recent')).toBe(true)
    expect(loaded.has('old')).toBe(false)
  })

  it('returns empty map when file contains invalid JSON', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(tmpDir, 'sessions.json'), 'not valid json', 'utf-8')
    const result = await loadSessions(tmpDir, 7 * 24 * 60 * 60 * 1000)
    expect(result.size).toBe(0)
  })

  it('skips malformed session entries and loads valid ones', async () => {
    const { writeFile } = await import('node:fs/promises')
    const valid = makeSession({ id: 'good' })
    await writeFile(join(tmpDir, 'sessions.json'), JSON.stringify([{ garbage: true }, valid]), 'utf-8')
    const result = await loadSessions(tmpDir, 7 * 24 * 60 * 60 * 1000)
    expect(result.size).toBe(1)
    expect(result.has('good')).toBe(true)
  })

  it('migrates legacy color statuses to semantic names on load', async () => {
    const { writeFile } = await import('node:fs/promises')
    // Simulate a sessions.json written by a pre-0.5.0 version with color names
    const legacy = [
      {
        id: 'legacy-green',
        name: 'Old Green',
        usageProject: null,
        status: 'green',
        detail: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        statusSince: new Date().toISOString(),
      },
      {
        id: 'legacy-orange',
        name: 'Old Orange',
        usageProject: null,
        status: 'orange',
        detail: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        statusSince: new Date().toISOString(),
      },
    ]
    await writeFile(join(tmpDir, 'sessions.json'), JSON.stringify(legacy), 'utf-8')
    const loaded = await loadSessions(tmpDir, 7 * 24 * 60 * 60 * 1000)
    expect(loaded.size).toBe(2)
    expect(loaded.get('legacy-green')?.status).toBe('finished')
    expect(loaded.get('legacy-orange')?.status).toBe('working')
  })

  it('overwrites stale file contents on save', async () => {
    const s1 = makeSession({ id: 's1' })
    await saveSessions(tmpDir, new Map([['s1', s1]]))
    const s2 = makeSession({ id: 's2', name: 'New Session' })
    await saveSessions(tmpDir, new Map([['s2', s2]]))
    const loaded = await loadSessions(tmpDir, 7 * 24 * 60 * 60 * 1000)
    expect(loaded.size).toBe(1)
    expect(loaded.has('s2')).toBe(true)
    expect(loaded.has('s1')).toBe(false)
  })
})
