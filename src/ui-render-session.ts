// Session card rendering — cards, usage sub-section, toolbar with sort/pagination.

import {
  aggregateModelBreakdowns,
  filterDaysBySessionTimeRange,
  matchCCUsageSessions,
  normalizeProjectKey,
  projectCandidatesFor,
  recentUsageDays,
  shortProjectName,
  sumUsageDays,
  sumUsageSessions,
} from './client-utils.js'
import type { SessionStatus } from './domain.js'
import { createElement } from './ui-dom.js'
import { formatDayLabel, formatLocalTime, formatMoney, formatNumber, formatRelative, millisecondsSince } from './ui-format.js'
import { redAlertAfterMs } from './ui-alerts.js'
import { ui } from './ui-state.js'
import type { AppState, Session, SortMode, UsageProject, UsageSummary } from './ui-types.js'
import { statusDetails, statusLabels, statusSortOrder, statusToColor } from './ui-types.js'

// ── Project lookup cache ───────────────────────────────────────────────────────

const projectLookup = { cache: null as { readonly usageKey: string; readonly map: ReadonlyMap<string, UsageProject> } | null }

const buildProjectLookup = (usage: UsageSummary): ReadonlyMap<string, UsageProject> => {
  const cacheKey = Object.keys(usage.projects).sort().join(',')
  if (projectLookup.cache?.usageKey === cacheKey) return projectLookup.cache.map
  const map = new Map<string, UsageProject>()
  Object.values(usage.projects).forEach((project) => {
    map.set(project.project, project)
    map.set(normalizeProjectKey(project.project), project)
  })
  projectLookup.cache = { usageKey: cacheKey, map }
  return map
}

export const findUsageProjectUnfiltered = (session: Session, usage: UsageSummary): UsageProject | null => {
  const lookup = buildProjectLookup(usage)
  const candidates = projectCandidatesFor(session)
  const directMatch = candidates
    .map((candidate): UsageProject | undefined => lookup.get(candidate))
    .find((m): m is UsageProject => m !== undefined)
  if (directMatch) return directMatch
  // Fallback: suffix match
  return candidates
    .flatMap((candidate) =>
      [...lookup.keys()]
        .filter((key) => key.endsWith(candidate))
        .map((key) => lookup.get(key))
        .filter((p): p is UsageProject => p !== null && p !== undefined),
    )[0] ?? null
}

export const isSessionExcluded = (session: Session): boolean => {
  // Use unfiltered project lookup so excluded repos are still findable
  if (ui.state.usage?.available) {
    const project = findUsageProjectUnfiltered(session, ui.state.usage)
    if (project && ui.state.excludedRepos.has(project.project)) return true
  }
  // Fallback: match session.usageProject against excluded keys by exact match only
  if (session.usageProject && ui.state.excludedRepos.has(session.usageProject)) return true
  return false
}

export const isSessionStateExcluded = (session: Session): boolean =>
  ui.state.excludedStates.size > 0 && ui.state.excludedStates.has(session.status)

export const findUsageProject = (session: Session, usage: UsageSummary | null): UsageProject | null => {
  if (!usage?.available) {
    return null
  }

  const projects = ui.state.excludedRepos.size === 0
    ? Object.values(usage.projects)
    : Object.values(usage.projects).filter((p) => !ui.state.excludedRepos.has(p.project))
  const candidates = new Set(projectCandidatesFor(session))

  return (
    projects.find((project) => candidates.has(project.project) || candidates.has(normalizeProjectKey(project.project))) ??
    projects.find((project) =>
      [...candidates].some((candidate) => normalizeProjectKey(project.project).endsWith(candidate)),
    ) ??
    null
  )
}

// ── Session sorting and pagination ─────────────────────────────────────────────

export const sortSessions = (sessions: readonly Session[], mode: SortMode): readonly Session[] => {
  const sorted = [...sessions]
  switch (mode) {
    case 'status':
      return sorted.sort((a, b) => {
        const orderDiff = statusSortOrder[a.status] - statusSortOrder[b.status]
        if (orderDiff !== 0) return orderDiff
        // Secondary sort: newest first within same status
        return b.updatedAt.localeCompare(a.updatedAt)
      })
    case 'updatedAt-asc':
      return sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    case 'updatedAt-desc':
    default:
      return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}

export const paginateSessions = (
  sessions: readonly Session[],
  pageSize: number,
  pageIndex: number,
): { page: readonly Session[]; totalPages: number; currentPage: number } => {
  const totalPages = Math.max(1, Math.ceil(sessions.length / pageSize))
  const safeIndex = Math.max(0, Math.min(pageIndex, totalPages - 1))
  const start = safeIndex * pageSize
  return {
    page: sessions.slice(start, start + pageSize),
    totalPages,
    currentPage: safeIndex + 1,
  }
}

// ── Session usage rendering ────────────────────────────────────────────────────

const renderSessionUsage = (session: Session, usageProject: UsageProject | null): HTMLElement => {
  if (!usageProject) {
    return createElement('div', { class: 'session-card__usage session-card__usage--empty' }, [
      createElement('span', {}, ['No ccusage project match']),
    ])
  }

  // Prefer ccusage session-level data when available: match individual
  // conversation sessions by project + time overlap for precise per-session
  // costs. Fall back to day-level filtering when ccusage session data is
  // unavailable or no sessions match.
  const ccusageSessions = ui.state.usage?.sessions ?? []
  const matchedSessions = ccusageSessions.length > 0
    ? matchCCUsageSessions(session, ccusageSessions)
    : []
  const sessionTotals = sumUsageSessions(matchedSessions)

  // Day-level fallback (used when session matching yields nothing, or for the
  // daily bar chart which always shows day-level context).
  const sessionDays = filterDaysBySessionTimeRange(session, usageProject.days)
  const dayTotals = sumUsageDays(sessionDays)
  const totals = sessionTotals ?? dayTotals
  const recentDays = recentUsageDays(sessionDays)
  const maxCost = Math.max(...recentDays.map((day) => day.totalCost), 0)

  // Model breakdown: prefer from matched sessions, fall back to day aggregates.
  const sessionModels = (() => {
    if (matchedSessions.length === 0) return null
    const byModel = matchedSessions
      .flatMap((cs) => cs.modelBreakdowns)
      .reduce((map, b) => {
        map.set(b.modelName, (map.get(b.modelName) ?? 0) + b.cost)
        return map
      }, new Map<string, number>())
    const breakdowns = [...byModel.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([modelName, cost]) => ({ modelName, cost }))
    return breakdowns.length > 0 ? breakdowns : null
  })()
  const models = sessionModels ?? aggregateModelBreakdowns(sessionDays, 'all')

  return createElement('div', { class: 'session-card__cost' }, [
    createElement('div', { class: 'session-card__usage' }, [
        createElement('div', {}, [
          createElement('span', {}, ['Cost']),
          createElement('strong', {}, [formatMoney(totals.totalCost)]),
        ]),
        createElement('div', {}, [
          createElement('span', {}, ['Tokens']),
          createElement('strong', {}, [formatNumber(totals.totalTokens)]),
        ]),
      ]),
    ...(() => {
      if (models.length === 0) return [] as HTMLElement[]
      return [createElement('div', { class: 'session-card__models' },
        models.map((m) =>
          createElement('span', { class: 'session-card__model-tag' }, [
            `${m.modelName} ${formatMoney(m.cost)}`,
          ]),
        ),
      )]
    })(),
    recentDays.length === 0
      ? createElement('div', { class: 'session-card__daily-empty' }, ['No usage data'])
      : createElement(
          'div',
          { class: 'session-card__daily', 'aria-label': `Daily ${shortProjectName(usageProject.project)} usage` },
          recentDays.map((day) =>
            createElement('div', { class: 'session-card__daily-row' }, [
              createElement('span', { class: 'session-card__daily-date' }, [formatDayLabel(day.date)]),
              createElement('span', {
                class: 'session-card__daily-bar',
                style: `--bar-width: ${maxCost > 0 ? Math.max(4, Math.round((day.totalCost / maxCost) * 100)) : 0}%`,
              }),
              createElement('span', { class: 'session-card__daily-cost' }, [formatMoney(day.totalCost)]),
            ]),
          ),
        ),
  ])
}

// ── Session card ───────────────────────────────────────────────────────────────

export const renderSession = (session: Session): HTMLElement => {
  const ageMs = millisecondsSince(session.statusSince)
  const overdue = session.status === 'attention' && ageMs !== null && ageMs >= redAlertAfterMs(ui.state)
  const usageProject = findUsageProject(session, ui.state.usage)
  const card = createElement('article', {
    class: `session-card session-card--${statusToColor[session.status]}${overdue ? ' session-card--overdue' : ''}`,
  })

  card.append(
    createElement('div', { class: 'session-card__topline' }, [
      createElement('span', { class: 'status-dot', title: statusLabels[session.status] }),
      createElement('span', { class: 'session-card__status' }, [statusLabels[session.status]]),
    ]),
    createElement('h2', {}, [session.name]),
    session.summary &&
      createElement('p', { class: 'session-card__summary', title: session.summary }, [session.summary]),
    createElement('p', { class: 'session-card__detail' }, [session.detail || statusDetails[session.status]]),
    renderSessionUsage(session, usageProject),
    createElement('dl', { class: 'session-card__meta' }, [
      createElement('div', {}, [
        createElement('dt', {}, ['Status since']),
        createElement('dd', (() => {
          const t = formatLocalTime(session.statusSince)
          return t !== null ? { title: t } : {}
        })(), [formatRelative(session.statusSince)]),
      ]),
      createElement('div', {}, [
        createElement('dt', {}, ['Updated']),
        createElement('dd', (() => {
          const t = formatLocalTime(session.updatedAt)
          return t !== null ? { title: t } : {}
        })(), [formatRelative(session.updatedAt)]),
      ]),
    ]),
  )

  return card
}

// ── Session toolbar (sort, page size, pagination) ──────────────────────────────

export const renderSessionToolbar = (sessionCount: number): HTMLElement | null => {
  if (sessionCount === 0) return null

  const totalPages = Math.max(1, Math.ceil(sessionCount / ui.state.pageSize))
  const safeIndex = Math.min(ui.state.pageIndex, totalPages - 1)
  const currentPage = safeIndex + 1

  return createElement('div', { class: 'session-toolbar' }, [
    // ── Sort group ──
    createElement('div', { class: 'session-toolbar__group', role: 'group', 'aria-label': 'Sort sessions' }, [
      createElement('span', { class: 'session-toolbar__label' }, ['Sort']),
      createElement('button', {
        class: `session-toolbar__btn${ui.state.sortMode === 'status' ? ' session-toolbar__btn--active' : ''}`,
        type: 'button',
        'data-sort': 'status',
      }, ['State']),
      createElement('button', {
        class: `session-toolbar__btn${ui.state.sortMode === 'updatedAt-desc' ? ' session-toolbar__btn--active' : ''}`,
        type: 'button',
        'data-sort': 'updatedAt-desc',
      }, ['Newest']),
      createElement('button', {
        class: `session-toolbar__btn${ui.state.sortMode === 'updatedAt-asc' ? ' session-toolbar__btn--active' : ''}`,
        type: 'button',
        'data-sort': 'updatedAt-asc',
      }, ['Oldest']),
    ]),
    // ── Page size group ──
    createElement('div', { class: 'session-toolbar__group', role: 'group', 'aria-label': 'Sessions per page' }, [
      createElement('span', { class: 'session-toolbar__label' }, ['Show']),
      ...([10, 20, 50, 100] as const).map((size) =>
        createElement('button', {
          class: `session-toolbar__btn${ui.state.pageSize === size ? ' session-toolbar__btn--active' : ''}`,
          type: 'button',
          'data-page-size': String(size),
        }, [String(size)]),
      ),
    ]),
    // ── Page navigation (only when multi-page) ──
    ...(totalPages > 1
      ? [createElement('div', { class: 'session-toolbar__nav' }, [
          createElement('span', { class: 'session-toolbar__page-info' }, [
            `Page ${currentPage} of ${totalPages}`,
          ]),
          createElement('button', {
            class: 'session-toolbar__btn',
            type: 'button',
            'data-page': 'prev',
            disabled: ui.state.pageIndex === 0 ? 'true' : undefined,
          }, ['← Prev']),
          createElement('button', {
            class: 'session-toolbar__btn',
            type: 'button',
            'data-page': 'next',
            disabled: ui.state.pageIndex >= totalPages - 1 ? 'true' : undefined,
          }, ['Next →']),
        ])]
      : []),
  ])
}
