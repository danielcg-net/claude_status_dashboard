import { describe, it, expect } from 'vitest'

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
