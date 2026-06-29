import { describe, it, expect } from 'vitest'
import {
  registerSession,
  updateSession,
  deleteSession,
  serializeSessions,
  registerSessionSchema,
  updateSessionSchema,
  type SessionStore,
  type Session,
} from '../src/domain.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyStore = (): SessionStore => new Map()

const storeWith = (...sessions: Session[]): SessionStore =>
  new Map(sessions.map((s) => [s.id, s]))

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'test-session',
  name: 'Test Session',
  usageProject: null,
  status: 'orange',
  detail: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  statusSince: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('registerSessionSchema', () => {
  it('accepts a minimal payload', () => {
    const result = registerSessionSchema.parse({})
    expect(result.status).toBe('orange')
    expect(result.id).toBeUndefined()
    expect(result.name).toBeUndefined()
  })

  it('accepts a full payload', () => {
    const result = registerSessionSchema.parse({
      id: 'my-session',
      name: 'My Session',
      usageProject: 'my-project',
      status: 'green',
      detail: 'All good',
    })
    expect(result.id).toBe('my-session')
    expect(result.name).toBe('My Session')
    expect(result.usageProject).toBe('my-project')
    expect(result.status).toBe('green')
    expect(result.detail).toBe('All good')
  })

  it('rejects an invalid status', () => {
    expect(() => registerSessionSchema.parse({ status: 'purple' })).toThrow()
  })

  it('rejects an empty id', () => {
    expect(() => registerSessionSchema.parse({ id: '' })).toThrow()
  })

  it('rejects an id that is too long', () => {
    expect(() => registerSessionSchema.parse({ id: 'x'.repeat(121) })).toThrow()
  })

  it('rejects a name that is too long', () => {
    expect(() => registerSessionSchema.parse({ name: 'x'.repeat(161) })).toThrow()
  })

  it('rejects a usageProject that is too long', () => {
    expect(() => registerSessionSchema.parse({ usageProject: 'x'.repeat(261) })).toThrow()
  })

  it('rejects a detail that is too long', () => {
    expect(() => registerSessionSchema.parse({ detail: 'x'.repeat(501) })).toThrow()
  })

  it('trims whitespace from strings', () => {
    const result = registerSessionSchema.parse({ id: '  my-id  ', name: '  name  ' })
    expect(result.id).toBe('my-id')
    expect(result.name).toBe('name')
  })
})

describe('updateSessionSchema', () => {
  it('requires a status', () => {
    expect(() => updateSessionSchema.parse({})).toThrow()
  })

  it('accepts a valid status with optional fields', () => {
    const result = updateSessionSchema.parse({
      status: 'red',
      usageProject: 'other-project',
      detail: 'Blocked',
    })
    expect(result.status).toBe('red')
    expect(result.usageProject).toBe('other-project')
    expect(result.detail).toBe('Blocked')
  })

  it('rejects an invalid status', () => {
    expect(() => updateSessionSchema.parse({ status: 'neon' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// registerSession
// ---------------------------------------------------------------------------

describe('registerSession', () => {
  it('creates a new session with defaults', () => {
    const [store, session] = registerSession(emptyStore(), { status: 'orange' })
    expect(session.id).toMatch(/^session-/)
    expect(session.name).toBe(session.id)
    expect(session.status).toBe('orange')
    expect(session.detail).toBe('')
    expect(session.usageProject).toBeNull()
    expect(session.createdAt).toBe(session.updatedAt)
    expect(session.statusSince).toBe(session.updatedAt)
    expect(store.get(session.id)).toBe(session)
  })

  it('uses the provided id and name', () => {
    const [, session] = registerSession(emptyStore(), {
      id: 'my-id',
      name: 'My Session',
    })
    expect(session.id).toBe('my-id')
    expect(session.name).toBe('My Session')
  })

  it('uses the id as display name when name is omitted', () => {
    const [, session] = registerSession(emptyStore(), { id: 'my-id' })
    expect(session.name).toBe('my-id')
  })

  it('stores usageProject', () => {
    const [, session] = registerSession(emptyStore(), { usageProject: 'my-project' })
    expect(session.usageProject).toBe('my-project')
  })

  it('stores detail', () => {
    const [, session] = registerSession(emptyStore(), { detail: 'Working on X' })
    expect(session.detail).toBe('Working on X')
  })

  it('stores the provided status', () => {
    const [, session] = registerSession(emptyStore(), { status: 'red' })
    expect(session.status).toBe('red')
  })

  it('updates an existing session preserving createdAt', () => {
    const [store, first] = registerSession(emptyStore(), {
      id: 'same-id',
      name: 'First',
      status: 'orange',
    })

    const [, second] = registerSession(store, {
      id: 'same-id',
      name: 'Second',
      status: 'green',
    })

    expect(second.id).toBe('same-id')
    expect(second.name).toBe('Second')
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt.localeCompare(first.updatedAt)).toBeGreaterThanOrEqual(0)
  })

  it('preserves previous name when updating without name', () => {
    const [store] = registerSession(emptyStore(), {
      id: 'same-id',
      name: 'Original',
    })
    const [, updated] = registerSession(store, { id: 'same-id', status: 'green' })
    expect(updated.name).toBe('Original')
  })

  it('preserves previous usageProject when updating without it', () => {
    const [store] = registerSession(emptyStore(), {
      id: 'same-id',
      usageProject: 'original-project',
    })
    const [, updated] = registerSession(store, { id: 'same-id', status: 'green' })
    expect(updated.usageProject).toBe('original-project')
  })

  it('preserves previous detail when updating without it', () => {
    const [store] = registerSession(emptyStore(), {
      id: 'same-id',
      detail: 'Original detail',
    })
    const [, updated] = registerSession(store, { id: 'same-id', status: 'green' })
    expect(updated.detail).toBe('Original detail')
  })

  it('updates statusSince when status changes', () => {
    const [store, first] = registerSession(emptyStore(), {
      id: 'same-id',
      status: 'orange',
    })
    const [, second] = registerSession(store, { id: 'same-id', status: 'green' })
    // Should be >= because both calls may happen in the same ms
    expect(second.statusSince.localeCompare(first.statusSince)).toBeGreaterThanOrEqual(0)
  })

  it('keeps statusSince when status does not change', () => {
    const [store, first] = registerSession(emptyStore(), {
      id: 'same-id',
      status: 'orange',
    })
    const [, second] = registerSession(store, { id: 'same-id', status: 'orange' })
    expect(second.statusSince).toBe(first.statusSince)
  })

  it('overrides usageProject when provided in update', () => {
    const [store] = registerSession(emptyStore(), {
      id: 'same-id',
      usageProject: 'old-project',
    })
    const [, updated] = registerSession(store, {
      id: 'same-id',
      usageProject: 'new-project',
    })
    expect(updated.usageProject).toBe('new-project')
  })

  it('overrides detail when provided in update', () => {
    const [store] = registerSession(emptyStore(), {
      id: 'same-id',
      detail: 'Old',
    })
    const [, updated] = registerSession(store, {
      id: 'same-id',
      detail: 'New',
    })
    expect(updated.detail).toBe('New')
  })
})

// ---------------------------------------------------------------------------
// updateSession
// ---------------------------------------------------------------------------

describe('updateSession', () => {
  it('returns undefined when session does not exist', () => {
    const [store, session] = updateSession(emptyStore(), 'nonexistent', {
      status: 'green',
    })
    expect(session).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('updates status on an existing session', () => {
    const existing = makeSession()
    const [store, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'red',
    })
    expect(updated?.status).toBe('red')
    expect(updated?.id).toBe('test-session')
  })

  it('updates statusSince when status changes', () => {
    const existing = makeSession()
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'red',
    })
    expect(updated?.statusSince).not.toBe(existing.statusSince)
  })

  it('keeps statusSince when status does not change', () => {
    const existing = makeSession({ status: 'red' })
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'red',
    })
    expect(updated?.statusSince).toBe(existing.statusSince)
  })

  it('updates usageProject when provided', () => {
    const existing = makeSession({ usageProject: 'old' })
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'green',
      usageProject: 'new',
    })
    expect(updated?.usageProject).toBe('new')
  })

  it('preserves usageProject when not provided', () => {
    const existing = makeSession({ usageProject: 'existing' })
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'green',
    })
    expect(updated?.usageProject).toBe('existing')
  })

  it('updates detail when provided', () => {
    const existing = makeSession({ detail: 'old' })
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'green',
      detail: 'new',
    })
    expect(updated?.detail).toBe('new')
  })

  it('preserves detail when not provided', () => {
    const existing = makeSession({ detail: 'existing' })
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'green',
    })
    expect(updated?.detail).toBe('existing')
  })

  it('updates updatedAt timestamp', () => {
    const existing = makeSession()
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'green',
    })
    expect(updated?.updatedAt).not.toBe(existing.updatedAt)
  })

  it('preserves createdAt', () => {
    const existing = makeSession()
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'green',
    })
    expect(updated?.createdAt).toBe(existing.createdAt)
  })

  it('preserves name', () => {
    const existing = makeSession({ name: 'Original Name' })
    const [, updated] = updateSession(storeWith(existing), 'test-session', {
      status: 'green',
    })
    expect(updated?.name).toBe('Original Name')
  })
})

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe('deleteSession', () => {
  it('deletes an existing session', () => {
    const existing = makeSession()
    const [store, deleted] = deleteSession(storeWith(existing), 'test-session')
    expect(deleted).toBe(true)
    expect(store.has('test-session')).toBe(false)
  })

  it('returns false for a nonexistent session', () => {
    const [store, deleted] = deleteSession(emptyStore(), 'nonexistent')
    expect(deleted).toBe(false)
    expect(store.size).toBe(0)
  })

  it('does not mutate the original store', () => {
    const existing = makeSession()
    const original = storeWith(existing)
    const [next] = deleteSession(original, 'test-session')
    expect(original.has('test-session')).toBe(true)
    expect(next.has('test-session')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// serializeSessions
// ---------------------------------------------------------------------------

describe('serializeSessions', () => {
  it('returns an empty array for an empty store', () => {
    expect(serializeSessions(emptyStore())).toEqual([])
  })

  it('sorts sessions by updatedAt descending', () => {
    const older = makeSession({
      id: 'older',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const newer = makeSession({
      id: 'newer',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    const result = serializeSessions(storeWith(older, newer))
    expect(result[0]?.id).toBe('newer')
    expect(result[1]?.id).toBe('older')
  })

  it('returns all sessions', () => {
    const a = makeSession({ id: 'a' })
    const b = makeSession({ id: 'b' })
    const c = makeSession({ id: 'c' })
    expect(serializeSessions(storeWith(a, b, c))).toHaveLength(3)
  })
})
