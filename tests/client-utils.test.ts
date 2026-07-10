import { describe, it, expect } from 'vitest'
import {
  type Session,
  type UsageSession,
  matchCCUsageSessions,
  sumUsageSessions,
} from '../src/client-utils.js'

// These are the key pure utility functions from src/client.ts, tested in isolation.

const normalizeProjectKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const shortProjectName = (projectKey: string): string => {
  const prefixes = ['-Private-Projects-', '-Projects-']
  let best = -1
  let bestPrefix = ''
  for (const prefix of prefixes) {
    const idx = projectKey.lastIndexOf(prefix)
    if (idx > best) {
      best = idx
      bestPrefix = prefix
    }
  }
  if (best >= 0) {
    return projectKey.slice(best + bestPrefix.length)
  }
  const cleaned = projectKey.replace(/^-+/, '')
  const parts = cleaned.split('-').filter(Boolean)
  if (parts.length > 2 && (parts[0] === 'home' || parts[0] === 'Users')) {
    return parts.slice(2).join('-')
  }
  return parts[parts.length - 1] ?? projectKey
}

const projectKeyToPath = (projectKey: string): string =>
  '/' + projectKey.replace(/^-+/, '').split('-').join('/')

type UsageTotals = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationTokens: number
  readonly cacheReadTokens: number
  readonly totalTokens: number
  readonly totalCost: number
}

type UsageDay = UsageTotals & {
  readonly date: string
  readonly modelsUsed: readonly string[]
}

const sumUsageDays = (days: readonly UsageDay[]): UsageTotals =>
  days.reduce(
    (totals, day) => ({
      inputTokens: totals.inputTokens + day.inputTokens,
      outputTokens: totals.outputTokens + day.outputTokens,
      cacheCreationTokens: totals.cacheCreationTokens + day.cacheCreationTokens,
      cacheReadTokens: totals.cacheReadTokens + day.cacheReadTokens,
      totalTokens: totals.totalTokens + day.totalTokens,
      totalCost: totals.totalCost + day.totalCost,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 },
  )

const day = (overrides: Partial<UsageDay> = {}): UsageDay => ({
  date: '2026-07-01',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  modelsUsed: [],
  ...overrides,
})

describe('normalizeProjectKey', () => {
  it('lowercases and replaces non-alphanumeric with dashes', () => {
    expect(normalizeProjectKey('My Cool Project')).toBe('my-cool-project')
  })

  it('collapses multiple separators', () => {
    expect(normalizeProjectKey('foo__bar')).toBe('foo-bar')
  })

  it('strips leading and trailing dashes', () => {
    expect(normalizeProjectKey('-home-user-repo-')).toBe('home-user-repo')
  })

  it('preserves existing ccusage key format', () => {
    expect(normalizeProjectKey('-Users-dcgomes-Private-Projects-my-app')).toBe(
      'users-dcgomes-private-projects-my-app',
    )
  })
})

describe('shortProjectName', () => {
  it('extracts name after Private-Projects prefix', () => {
    expect(shortProjectName('-Users-dcgomes-Private-Projects-my-app')).toBe('my-app')
  })

  it('extracts name after Projects prefix', () => {
    expect(shortProjectName('-Users-dcgomes-Projects-my-app')).toBe('my-app')
  })

  it('handles Linux home paths', () => {
    expect(shortProjectName('-home-dcgomes-claude-status-dashboard')).toBe('claude-status-dashboard')
  })

  it('handles Linux home paths with single repo name', () => {
    expect(shortProjectName('-home-dcgomes-bizyeet')).toBe('bizyeet')
  })

  it('handles macOS Users paths', () => {
    expect(shortProjectName('-Users-janedoe-my-project')).toBe('my-project')
  })

  it('uses last segment for short paths', () => {
    expect(shortProjectName('-home-dcgomes')).toBe('dcgomes')
  })

  it('returns original key for unparseable input', () => {
    expect(shortProjectName('singleword')).toBe('singleword')
  })

  it('uses last Private-Projects match for nested paths', () => {
    expect(shortProjectName('-Users-x-Private-Projects-sub-Private-Projects-actual')).toBe('actual')
  })
})

describe('projectKeyToPath', () => {
  it('converts dash-separated key to path', () => {
    expect(projectKeyToPath('-home-dcgomes-bizyeet')).toBe('/home/dcgomes/bizyeet')
  })

  it('handles macOS style keys', () => {
    expect(projectKeyToPath('-Users-dcgomes-Private-Projects-my-app')).toBe(
      '/Users/dcgomes/Private/Projects/my/app',
    )
  })
})

describe('sumUsageDays', () => {
  it('sums totals across days', () => {
    const days = [
      day({ inputTokens: 100, outputTokens: 50, totalTokens: 150, totalCost: 0.01 }),
      day({ inputTokens: 200, outputTokens: 100, cacheReadTokens: 30, totalTokens: 330, totalCost: 0.02 }),
    ]
    expect(sumUsageDays(days)).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      cacheCreationTokens: 0,
      cacheReadTokens: 30,
      totalTokens: 480,
      totalCost: 0.03,
    })
  })

  it('returns zeros for empty array', () => {
    expect(sumUsageDays([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    })
  })

  it('handles a single day', () => {
    const days = [day({ inputTokens: 500, outputTokens: 250, totalTokens: 750, totalCost: 0.05 })]
    expect(sumUsageDays(days).totalCost).toBe(0.05)
    expect(sumUsageDays(days).totalTokens).toBe(750)
  })
})

// ── ccusage session matching ────────────────────────────────────────────────────

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-123',
  name: 'test-repo',
  createdAt: '2026-07-10T10:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
  status: 'green',
  detail: '',
  statusSince: '2026-07-10T10:00:00.000Z',
  usageProject: null,
  ...overrides,
})

const makeUsageSession = (overrides: Partial<UsageSession> = {}): UsageSession => ({
  sessionId: 'cs-1',
  projectPath: '-home-user-test-repo',
  firstActivity: '2026-07-10T10:30:00.000Z',
  lastActivity: '2026-07-10T11:00:00.000Z',
  inputTokens: 100,
  outputTokens: 50,
  cacheCreationTokens: 10,
  cacheReadTokens: 20,
  totalTokens: 180,
  totalCost: 0.005,
  modelsUsed: ['claude-sonnet-4-6'],
  modelBreakdowns: [
    { modelName: 'claude-sonnet-4-6', cost: 0.005, inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 20 },
  ],
  ...overrides,
})

describe('matchCCUsageSessions', () => {
  it('matches ccusage sessions whose firstActivity falls within the dashboard session range', () => {
    const dashSession = makeSession({
      id: 'my-session',
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
      usageProject: '-home-user-test-repo',
    })
    const csA = makeUsageSession({
      sessionId: 'cs-a',
      firstActivity: '2026-07-10T10:30:00.000Z',
      projectPath: '-home-user-test-repo',
      totalCost: 0.01,
    })
    const csB = makeUsageSession({
      sessionId: 'cs-b',
      firstActivity: '2026-07-10T11:00:00.000Z',
      projectPath: '-home-user-test-repo',
      totalCost: 0.02,
    })

    const matched = matchCCUsageSessions(dashSession, [csA, csB])
    expect(matched).toHaveLength(2)
    expect(matched[0]?.sessionId).toBe('cs-a')
    expect(matched[1]?.sessionId).toBe('cs-b')
  })

  it('excludes ccusage sessions whose firstActivity is before the dashboard session start', () => {
    const dashSession = makeSession({
      createdAt: '2026-07-10T11:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
      usageProject: '-home-user-test-repo',
    })
    const csEarly = makeUsageSession({
      sessionId: 'cs-early',
      firstActivity: '2026-07-10T10:00:00.000Z',
      projectPath: '-home-user-test-repo',
    })
    const csLate = makeUsageSession({
      sessionId: 'cs-late',
      firstActivity: '2026-07-10T12:00:00.000Z',
      projectPath: '-home-user-test-repo',
    })

    const matched = matchCCUsageSessions(dashSession, [csEarly, csLate])
    expect(matched).toHaveLength(1)
    expect(matched[0]?.sessionId).toBe('cs-late')
  })

  it('excludes ccusage sessions whose firstActivity is after the dashboard session end', () => {
    const dashSession = makeSession({
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z',
      usageProject: '-home-user-test-repo',
    })
    const csLate = makeUsageSession({
      sessionId: 'cs-late',
      firstActivity: '2026-07-10T11:00:00.000Z',
      projectPath: '-home-user-test-repo',
    })

    const matched = matchCCUsageSessions(dashSession, [csLate])
    expect(matched).toHaveLength(0)
  })

  it('separates sessions from the same repo that are close in time', () => {
    // Two dashboard sessions close together — each should only match
    // the ccusage sessions whose firstActivity falls within its own range.
    const dashA = makeSession({
      id: 'dash-a',
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T10:30:00.000Z',
    })
    const dashB = makeSession({
      id: 'dash-b',
      createdAt: '2026-07-10T11:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    })

    const csA = makeUsageSession({
      sessionId: 'cs-a',
      firstActivity: '2026-07-10T09:30:00.000Z',
      totalCost: 0.01,
    })
    const csB = makeUsageSession({
      sessionId: 'cs-b',
      firstActivity: '2026-07-10T11:30:00.000Z',
      totalCost: 0.02,
    })

    const matchedA = matchCCUsageSessions(dashA, [csA, csB])
    const matchedB = matchCCUsageSessions(dashB, [csA, csB])

    expect(matchedA).toHaveLength(1)
    expect(matchedA[0]?.sessionId).toBe('cs-a')
    expect(matchedB).toHaveLength(1)
    expect(matchedB[0]?.sessionId).toBe('cs-b')
  })

  it('matches by project path using fuzzy matching (name-based)', () => {
    const dashSession = makeSession({
      name: 'test-repo',
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
    })
    const cs = makeUsageSession({
      sessionId: 'cs-1',
      firstActivity: '2026-07-10T10:00:00.000Z',
      projectPath: '-home-user-test-repo',
    })

    const matched = matchCCUsageSessions(dashSession, [cs])
    expect(matched).toHaveLength(1)
  })

  it('matches by normalized project key', () => {
    const dashSession = makeSession({
      usageProject: '-HOME-USER_TEST-REPO',
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
    })
    const cs = makeUsageSession({
      sessionId: 'cs-1',
      firstActivity: '2026-07-10T10:00:00.000Z',
      projectPath: '-home-user-test-repo',
    })

    const matched = matchCCUsageSessions(dashSession, [cs])
    expect(matched).toHaveLength(1)
  })

  it('returns empty array when no project matches', () => {
    const dashSession = makeSession({
      id: 'session-unrelated',
      name: 'unrelated-project',
      usageProject: '-home-user-other-repo',
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
    })
    const cs = makeUsageSession({
      sessionId: 'cs-1',
      firstActivity: '2026-07-10T10:00:00.000Z',
      projectPath: '-home-user-test-repo',
    })

    const matched = matchCCUsageSessions(dashSession, [cs])
    expect(matched).toHaveLength(0)
  })

  it('returns empty array when timestamps are malformed', () => {
    const dashSession = makeSession({
      createdAt: 'bad-date',
      updatedAt: 'also-bad',
      usageProject: '-home-user-test-repo',
    })
    const cs = makeUsageSession({
      sessionId: 'cs-1',
      firstActivity: '2026-07-10T10:00:00.000Z',
      projectPath: '-home-user-test-repo',
    })

    const matched = matchCCUsageSessions(dashSession, [cs])
    expect(matched).toHaveLength(0)
  })

  it('excludes ccusage session with malformed firstActivity', () => {
    const dashSession = makeSession({
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
      usageProject: '-home-user-test-repo',
    })
    const csBad = makeUsageSession({
      sessionId: 'cs-bad',
      firstActivity: 'not-a-timestamp',
      projectPath: '-home-user-test-repo',
    })

    const matched = matchCCUsageSessions(dashSession, [csBad])
    expect(matched).toHaveLength(0)
  })
})

describe('sumUsageSessions', () => {
  it('sums costs and tokens across multiple sessions', () => {
    const sessions = [
      makeUsageSession({ totalCost: 0.01, totalTokens: 100, inputTokens: 60, outputTokens: 40 }),
      makeUsageSession({ totalCost: 0.02, totalTokens: 200, inputTokens: 120, outputTokens: 80 }),
    ]
    const result = sumUsageSessions(sessions)
    expect(result?.totalCost).toBe(0.03)
    expect(result?.totalTokens).toBe(300)
    expect(result?.inputTokens).toBe(180)
    expect(result?.outputTokens).toBe(120)
  })

  it('returns null for empty array (signals fallback)', () => {
    expect(sumUsageSessions([])).toBeNull()
  })

  it('handles a single session', () => {
    const sessions = [makeUsageSession({ totalCost: 0.015, totalTokens: 500 })]
    const result = sumUsageSessions(sessions)
    expect(result?.totalCost).toBe(0.015)
    expect(result?.totalTokens).toBe(500)
  })
})
