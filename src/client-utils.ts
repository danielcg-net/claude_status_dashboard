// Pure, browser-environment-free utilities shared between src/client.ts and tests.
// No DOM access, no window/document references — safe to import in Node test environments.

import type { SessionStatus } from './domain.js'

export type { SessionStatus }

export type Session = {
  readonly id: string
  readonly name: string
  readonly usageProject: string | null
  readonly status: SessionStatus
  readonly detail: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly statusSince: string
}

export type UsageTotals = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationTokens: number
  readonly cacheReadTokens: number
  readonly totalTokens: number
  readonly totalCost: number
}

export type ModelBreakdown = {
  readonly modelName: string
  readonly cost: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationTokens: number
  readonly cacheReadTokens: number
}

export type UsageDay = UsageTotals & {
  readonly date: string
  readonly modelsUsed: readonly string[]
  readonly modelBreakdowns: readonly ModelBreakdown[]
}

export type UsageProject = {
  readonly project: string
  readonly totals: UsageTotals
  readonly today: UsageDay | null
  readonly days: readonly UsageDay[]
}

export type UsageBlock = {
  readonly id: string
  readonly startTime: string
  readonly endTime: string
  readonly actualEndTime: string | null
  readonly isActive: boolean
  readonly totalTokens: number
  readonly totalCost: number
  readonly modelsUsed: readonly string[]
}

export type CostWindow = 'today' | '2d' | '3d' | '7d' | '14d' | '30d' | '90d' | 'all'

export const costWindowLabels: Record<CostWindow, string> = {
  today: 'Today',
  '2d': '2 days',
  '3d': '3 days',
  '7d': '7 days',
  '14d': '14 days',
  '30d': '30 days',
  '90d': '90 days',
  all: 'All',
}

// All CostWindow values except 'today' and 'all' must have an entry here.
// Using Exclude<> makes this an exhaustive record: TypeScript will error if a new
// CostWindow variant is added without a corresponding day count, eliminating the
// need for a silent fallback in daysForWindow.
export const costWindowDays: Record<Exclude<CostWindow, 'today' | 'all'>, number> = {
  '2d': 2,
  '3d': 3,
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
}

export const emptyTotals: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  totalCost: 0,
}

export const sumUsageDays = (days: readonly UsageDay[]): UsageTotals =>
  days.reduce(
    (totals, day) => ({
      inputTokens: totals.inputTokens + day.inputTokens,
      outputTokens: totals.outputTokens + day.outputTokens,
      cacheCreationTokens: totals.cacheCreationTokens + day.cacheCreationTokens,
      cacheReadTokens: totals.cacheReadTokens + day.cacheReadTokens,
      totalTokens: totals.totalTokens + day.totalTokens,
      totalCost: totals.totalCost + day.totalCost,
    }),
    emptyTotals,
  )

// ccusage day keys are always UTC dates — use UTC methods when comparing
// against them to avoid off-by-one errors for users in non-UTC timezones.
export const utcDateString = (date: Date): string => date.toISOString().slice(0, 10)

export const parseUtcDateString = (isoString: string): string | null => {
  const date = new Date(isoString)
  return Number.isNaN(date.getTime()) ? null : utcDateString(date)
}

export const filterDaysBySessionTimeRange = (session: Session, days: readonly UsageDay[]): readonly UsageDay[] => {
  const startDate = parseUtcDateString(session.createdAt)
  const endDate = parseUtcDateString(session.updatedAt)
  if (startDate === null || endDate === null) return days
  return days.filter((day) => day.date >= startDate && day.date <= endDate)
}

// ── ccusage session matching ────────────────────────────────────────────────────

export type UsageSession = UsageTotals & {
  readonly sessionId: string
  readonly projectPath: string
  readonly firstActivity: string
  readonly lastActivity: string
  readonly modelsUsed: readonly string[]
  readonly modelBreakdowns: readonly ModelBreakdown[]
}

const normalizeUsageProjectKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const sessionProjectCandidates = (session: Session): readonly string[] =>
  [session.usageProject, session.id, session.name]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, normalizeUsageProjectKey(value)])

// Match ccusage sessions to a dashboard session by project + time overlap:
// a ccusage session belongs to a dashboard session if its firstActivity falls
// within the dashboard session's [createdAt, updatedAt] range AND the project
// paths match (using the same fuzzy matching as findUsageProject).
export const matchCCUsageSessions = (
  session: Session,
  ccusageSessions: readonly UsageSession[],
): readonly UsageSession[] => {
  const candidates = new Set(sessionProjectCandidates(session))
  const sessionStartMs = Date.parse(session.createdAt)
  const sessionEndMs = Date.parse(session.updatedAt)

  if (Number.isNaN(sessionStartMs) || Number.isNaN(sessionEndMs)) {
    return []
  }

  return ccusageSessions.filter((cs) => {
    // Check project match
    const csProjectKey = normalizeUsageProjectKey(cs.projectPath)
    const projectMatch =
      candidates.has(cs.projectPath) ||
      candidates.has(csProjectKey) ||
      [...candidates].some((c) => csProjectKey.endsWith(c) || cs.projectPath.endsWith(c))

    if (!projectMatch) return false

    // Check time overlap: ccusage session's firstActivity must fall within
    // the dashboard session's time range.
    const firstActivityMs = Date.parse(cs.firstActivity)
    if (Number.isNaN(firstActivityMs)) return false

    return firstActivityMs >= sessionStartMs && firstActivityMs <= sessionEndMs
  })
}

// Aggregate totals from matched ccusage sessions. Returns null when no sessions
// matched, so the caller can fall back to the day-filtering method.
export const sumUsageSessions = (sessions: readonly UsageSession[]): UsageTotals | null => {
  if (sessions.length === 0) return null
  return sessions.reduce(
    (totals, s) => ({
      inputTokens: totals.inputTokens + s.inputTokens,
      outputTokens: totals.outputTokens + s.outputTokens,
      cacheCreationTokens: totals.cacheCreationTokens + s.cacheCreationTokens,
      cacheReadTokens: totals.cacheReadTokens + s.cacheReadTokens,
      totalTokens: totals.totalTokens + s.totalTokens,
      totalCost: totals.totalCost + s.totalCost,
    }),
    emptyTotals,
  )
}

export const daysForWindow = (days: readonly UsageDay[], costWindow: CostWindow): readonly UsageDay[] => {
  if (costWindow === 'all') return days

  if (costWindow === 'today') {
    const today = utcDateString(new Date())
    return days.filter((day) => day.date === today)
  }

  const windowDays = costWindowDays[costWindow]
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1))
  const cutoffDate = utcDateString(cutoff)
  return days.filter((day) => day.date >= cutoffDate)
}
