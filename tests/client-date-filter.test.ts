import { describe, it, expect } from 'vitest'

// Pure utility functions inlined from src/client.ts for isolated unit testing.
// Keep these in sync with the source — if you rename/change them, update here too.

// ── helpers under test ────────────────────────────────────────────────────────

const utcDateString = (date: Date): string => date.toISOString().slice(0, 10)

const parseUtcDateString = (isoString: string): string | null => {
  const date = new Date(isoString)
  return Number.isNaN(date.getTime()) ? null : utcDateString(date)
}

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
  readonly modelBreakdowns: readonly unknown[]
}

type Session = {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly status: string
  readonly detail: string
  readonly statusSince: string
  readonly usageProject: string | null
}

type CostWindow = 'today' | '2days' | '3days' | '7days' | '14days' | '30days' | '90days' | 'all'

const costWindowDays: Partial<Record<CostWindow, number>> = {
  '2days': 2,
  '3days': 3,
  '7days': 7,
  '14days': 14,
  '30days': 30,
  '90days': 90,
}

const filterDaysBySessionTimeRange = (session: Session, days: readonly UsageDay[]): readonly UsageDay[] => {
  const startDate = parseUtcDateString(session.createdAt)
  const endDate = parseUtcDateString(session.updatedAt)
  if (startDate === null || endDate === null) return days
  return days.filter((day) => day.date >= startDate && day.date <= endDate)
}

const daysForWindow = (days: readonly UsageDay[], costWindow: CostWindow, now: Date): readonly UsageDay[] => {
  if (costWindow === 'all') return days

  if (costWindow === 'today') {
    const today = utcDateString(now)
    return days.filter((day) => day.date === today)
  }

  const windowDays = costWindowDays[costWindow] ?? 1
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1))
  const cutoffDate = utcDateString(cutoff)
  return days.filter((day) => day.date >= cutoffDate)
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const day = (date: string, totalCost = 1.0): UsageDay => ({
  date,
  inputTokens: 10,
  outputTokens: 10,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 20,
  totalCost,
  modelsUsed: ['claude-sonnet-4-6'],
  modelBreakdowns: [],
})

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'test-session',
  name: 'test',
  createdAt: '2026-07-10T04:00:00.000Z',
  updatedAt: '2026-07-10T05:00:00.000Z',
  status: 'green',
  detail: '',
  statusSince: '2026-07-10T04:00:00.000Z',
  usageProject: null,
  ...overrides,
})

// ── parseUtcDateString ────────────────────────────────────────────────────────

describe('parseUtcDateString', () => {
  it('extracts the UTC date from a Z-terminated ISO string', () => {
    expect(parseUtcDateString('2026-07-10T04:55:45.832Z')).toBe('2026-07-10')
  })

  it('extracts UTC date from a positive offset — local date may differ', () => {
    // +05:00 means UTC is 5h behind, so 2026-07-10T01:00+05:00 = 2026-07-09T20:00Z
    expect(parseUtcDateString('2026-07-10T01:00:00.000+05:00')).toBe('2026-07-09')
  })

  it('extracts UTC date from a negative offset', () => {
    // -06:00 (MDT): 2026-07-10T22:00-06:00 = 2026-07-11T04:00Z
    expect(parseUtcDateString('2026-07-10T22:00:00.000-06:00')).toBe('2026-07-11')
  })

  it('returns null for an empty string', () => {
    expect(parseUtcDateString('')).toBeNull()
  })

  it('returns null for a malformed string', () => {
    expect(parseUtcDateString('not-a-date')).toBeNull()
  })

  it('returns null for a random string that Date happens to parse weirdly', () => {
    expect(parseUtcDateString('undefined')).toBeNull()
  })
})

// ── filterDaysBySessionTimeRange ──────────────────────────────────────────────

describe('filterDaysBySessionTimeRange', () => {
  const days = [
    day('2026-07-08'),
    day('2026-07-09'),
    day('2026-07-10'),
    day('2026-07-11'),
  ]

  it('returns only days within the session UTC date range', () => {
    const s = session({
      createdAt: '2026-07-09T12:00:00.000Z',
      updatedAt: '2026-07-10T18:00:00.000Z',
    })
    const result = filterDaysBySessionTimeRange(s, days)
    expect(result.map((d) => d.date)).toEqual(['2026-07-09', '2026-07-10'])
  })

  it('returns all days when session spans the full range', () => {
    const s = session({
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-11T23:59:59.000Z',
    })
    expect(filterDaysBySessionTimeRange(s, days)).toHaveLength(4)
  })

  it('returns a single day when session starts and ends on the same UTC date', () => {
    const s = session({
      createdAt: '2026-07-10T01:00:00.000Z',
      updatedAt: '2026-07-10T23:00:00.000Z',
    })
    const result = filterDaysBySessionTimeRange(s, days)
    expect(result.map((d) => d.date)).toEqual(['2026-07-10'])
  })

  it('returns all days when createdAt is malformed', () => {
    const s = session({ createdAt: 'bad-date' })
    expect(filterDaysBySessionTimeRange(s, days)).toHaveLength(4)
  })

  it('returns all days when updatedAt is malformed', () => {
    const s = session({ updatedAt: 'bad-date' })
    expect(filterDaysBySessionTimeRange(s, days)).toHaveLength(4)
  })

  it('returns empty array when session range matches no days', () => {
    const s = session({
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T23:59:59.000Z',
    })
    expect(filterDaysBySessionTimeRange(s, days)).toHaveLength(0)
  })

  // Regression: UTC-negative timezone (e.g. MDT UTC-6) used to shift
  // session timestamps back one local date, causing a mismatch with
  // ccusage UTC day keys and showing $0.00 on session cards.
  it('regression: session at 04:55 UTC is treated as 2026-07-10 not 2026-07-09', () => {
    const s = session({
      // 04:55 UTC = 22:55 MDT (previous day locally) — must still match 2026-07-10
      createdAt: '2026-07-10T04:55:45.832Z',
      updatedAt: '2026-07-10T05:07:37.205Z',
    })
    const result = filterDaysBySessionTimeRange(s, [day('2026-07-09'), day('2026-07-10')])
    expect(result.map((d) => d.date)).toEqual(['2026-07-10'])
  })
})

// ── daysForWindow ─────────────────────────────────────────────────────────────

describe('daysForWindow', () => {
  // Simulate "now" as 2026-07-10T14:00:00Z (UTC-6 local = 2026-07-10T08:00 MDT)
  const NOW = new Date('2026-07-10T14:00:00.000Z')

  const days = [
    day('2026-07-01'),
    day('2026-07-04'),
    day('2026-07-07'),
    day('2026-07-08'),
    day('2026-07-09'),
    day('2026-07-10'),
  ]

  it('"all" returns every day', () => {
    expect(daysForWindow(days, 'all', NOW)).toHaveLength(6)
  })

  it('"today" returns only UTC today', () => {
    const result = daysForWindow(days, 'today', NOW)
    expect(result.map((d) => d.date)).toEqual(['2026-07-10'])
  })

  it('"2days" returns today and yesterday', () => {
    const result = daysForWindow(days, '2days', NOW)
    expect(result.map((d) => d.date)).toEqual(['2026-07-09', '2026-07-10'])
  })

  it('"7days" returns days within last 7 UTC days', () => {
    const result = daysForWindow(days, '7days', NOW)
    expect(result.map((d) => d.date)).toEqual(['2026-07-04', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'])
  })

  it('"3days" boundary is inclusive', () => {
    const result = daysForWindow(days, '3days', NOW)
    // 2026-07-08, 2026-07-09, 2026-07-10
    expect(result.map((d) => d.date)).toEqual(['2026-07-08', '2026-07-09', '2026-07-10'])
  })

  it('returns empty array when no days fall in window', () => {
    const future = new Date('2026-08-01T00:00:00.000Z')
    expect(daysForWindow(days, 'today', future)).toHaveLength(0)
  })

  // Regression: localIsoDate() with MDT (UTC-6) would produce '2026-07-09'
  // as "today" while ccusage keys the day as '2026-07-10', hiding the repo
  // from the Today filter.
  it('regression: "today" uses UTC date, not local — matches ccusage day key at 08:00 MDT', () => {
    // 08:00 MDT = 14:00 UTC — UTC date is still 2026-07-10
    const result = daysForWindow(days, 'today', NOW)
    expect(result.map((d) => d.date)).toEqual(['2026-07-10'])
  })

  it('regression: "today" with midnight UTC boundary does not bleed into previous day', () => {
    // Exactly midnight UTC — still 2026-07-10
    const midnight = new Date('2026-07-10T00:00:00.000Z')
    const result = daysForWindow(days, 'today', midnight)
    expect(result.map((d) => d.date)).toEqual(['2026-07-10'])
  })
})
