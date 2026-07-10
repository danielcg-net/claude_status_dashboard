import { describe, it, expect } from 'vitest'
import {
  type CostWindow,
  type Session,
  type UsageDay,
  daysForWindow,
  filterDaysBySessionTimeRange,
  parseUtcDateString,
  utcDateString,
} from '../src/client-utils.js'

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

  it('returns null for "undefined" string', () => {
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
// daysForWindow uses new Date() internally, so we inject a fixed "now" by
// temporarily overriding global Date. Vitest runs in Node, so this is safe.

const withFakeNow = <T>(isoNow: string, fn: () => T): T => {
  const RealDate = globalThis.Date
  const fakeMs = RealDate.parse(isoNow)
  // Minimal Date stub: zero-arg new Date() returns fixed instant; everything
  // else delegates to the real implementation.
  const FakeDate = new Proxy(RealDate, {
    construct(target, args) {
      return args.length === 0 ? new target(fakeMs) : new target(...(args as ConstructorParameters<typeof Date>))
    },
    get(target, prop) {
      if (prop === 'now') return () => fakeMs
      const val = Reflect.get(target, prop)
      return typeof val === 'function' ? val.bind(target) : val
    },
  })
  globalThis.Date = FakeDate as unknown as typeof Date
  try {
    return fn()
  } finally {
    globalThis.Date = RealDate
  }
}

describe('daysForWindow', () => {
  // "now" = 2026-07-10T14:00:00Z (UTC-6 local = 2026-07-10T08:00 MDT)
  const NOW_ISO = '2026-07-10T14:00:00.000Z'

  const days = [
    day('2026-07-01'),
    day('2026-07-04'),
    day('2026-07-07'),
    day('2026-07-08'),
    day('2026-07-09'),
    day('2026-07-10'),
  ]

  const w = (window: CostWindow) => withFakeNow(NOW_ISO, () => daysForWindow(days, window))

  it('"all" returns every day', () => {
    expect(w('all')).toHaveLength(6)
  })

  it('"today" returns only UTC today', () => {
    expect(w('today').map((d) => d.date)).toEqual(['2026-07-10'])
  })

  it('"2d" returns today and yesterday', () => {
    expect(w('2d').map((d) => d.date)).toEqual(['2026-07-09', '2026-07-10'])
  })

  it('"7d" returns days within last 7 UTC days', () => {
    expect(w('7d').map((d) => d.date)).toEqual(['2026-07-04', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'])
  })

  it('"3d" boundary is inclusive', () => {
    // cutoff = 2026-07-08
    expect(w('3d').map((d) => d.date)).toEqual(['2026-07-08', '2026-07-09', '2026-07-10'])
  })

  it('returns empty array when no days fall in window', () => {
    const result = withFakeNow('2026-08-01T00:00:00.000Z', () => daysForWindow(days, 'today'))
    expect(result).toHaveLength(0)
  })

  // Regression: localIsoDate() with MDT (UTC-6) would produce '2026-07-09'
  // as "today" while ccusage keys the day as '2026-07-10', hiding the repo
  // from the Today filter.
  it('regression: "today" uses UTC date, not local — matches ccusage day key at 08:00 MDT', () => {
    // 08:00 MDT = 14:00 UTC, UTC date is still 2026-07-10
    expect(w('today').map((d) => d.date)).toEqual(['2026-07-10'])
  })

  it('regression: "today" with midnight UTC does not bleed into previous day', () => {
    const result = withFakeNow('2026-07-10T00:00:00.000Z', () => daysForWindow(days, 'today'))
    expect(result.map((d) => d.date)).toEqual(['2026-07-10'])
  })
})

// ── utcDateString ─────────────────────────────────────────────────────────────

describe('utcDateString', () => {
  it('formats a UTC midnight Date as YYYY-MM-DD', () => {
    expect(utcDateString(new Date('2026-07-10T00:00:00.000Z'))).toBe('2026-07-10')
  })

  it('uses UTC date regardless of local time offset', () => {
    // 2026-07-09T23:30:00Z — still 2026-07-09 in UTC
    expect(utcDateString(new Date('2026-07-09T23:30:00.000Z'))).toBe('2026-07-09')
  })
})
