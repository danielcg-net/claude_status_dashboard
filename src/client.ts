import {
  type CostWindow,
  type Session,
  type SessionStatus,
  type UsageBlock,
  type UsageDay,
  type UsageProject,
  type UsageSession,
  type UsageTotals,
  costWindowDays,
  costWindowLabels,
  daysForWindow,
  emptyTotals,
  filterDaysBySessionTimeRange,
  matchCCUsageSessions,
  parseUtcDateString,
  sumUsageDays,
  sumUsageSessions,
  utcDateString,
} from './client-utils.js'

declare const __VERSION__: string

type ApiState = {
  readonly sessions: readonly Session[]
  readonly redAlertAfterMs: number
}

type UsageSummary = {
  readonly available: boolean
  readonly generatedAt: string
  readonly totals: UsageTotals
  readonly today: UsageDay | null
  readonly projects: Readonly<Record<string, UsageProject>>
  readonly activeBlock: UsageBlock | null
  readonly blocks: readonly UsageBlock[]
  readonly sessions: readonly UsageSession[]
  readonly error: string | null
}

type VersionInfo = {
  readonly version: string
  readonly latestVersion: string | null
  readonly updateAvailable: boolean
}

type NotifySettingsUI = {
  readonly enabled: boolean
  readonly webhookUrl: string
  readonly format: string
  readonly events: readonly string[]
  readonly pushoverToken: string
  readonly pushoverUser: string
  readonly headers: Readonly<Record<string, string>>
}

type BeepSettingsUI = {
  readonly enabled: boolean
  readonly alertAfterMs: number | null
  readonly maxBeeps: number | null
  readonly events: readonly string[]
}

type AppState = ApiState & {
  readonly audioEnabled: boolean
  readonly lastBeepAt: number
  readonly beepCount: number
  readonly redAlertAfterOverrideMs: number | null
  readonly maxBeeps: number | null
  readonly usage: UsageSummary | null
  readonly costWindow: CostWindow
  readonly selectedRepo: string | null
  readonly excludedRepos: ReadonlySet<string>
  readonly updateAvailable: boolean
  readonly latestVersion: string | null
  readonly notifySettings: NotifySettingsUI | null
  readonly notifySettingsOpen: boolean
  readonly beepSettings: BeepSettingsUI | null
  readonly beepSettingsOpen: boolean
  readonly seenSessionIds: ReadonlySet<string>
}

const statusLabels: Record<SessionStatus, string> = {
  green: 'Finished',
  yellow: 'Idle',
  orange: 'Running',
  red: 'Waiting',
}

const statusDetails: Record<SessionStatus, string> = {
  green: 'Claude has finished running something.',
  yellow: 'Claude is idle at the prompt, waiting for your input.',
  orange: 'Claude is thinking and doing stuff.',
  red: 'Claude is paused for an approval or decision.',
}

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing #app root element.')
}

const loadExcludedRepos = (): ReadonlySet<string> => {
  try {
    const raw = localStorage.getItem('excludedRepos')
    if (raw === null) return new Set<string>()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set<string>(parsed.filter((item): item is string => typeof item === 'string'))
  } catch (error) {
    console.warn('Could not load excluded repos from localStorage:', error)
    return new Set<string>()
  }
}

const saveExcludedRepos = (excluded: ReadonlySet<string>): void => {
  try {
    localStorage.setItem('excludedRepos', JSON.stringify([...excluded]))
  } catch (error) {
    console.warn('Could not save excluded repos to localStorage:', error)
  }
}

const initialState: AppState = {
  sessions: [],
  redAlertAfterMs: 300_000,
  audioEnabled: false,
  lastBeepAt: 0,
  beepCount: 0,
  redAlertAfterOverrideMs: null,
  maxBeeps: null,
  usage: null,
  costWindow: 'today',
  selectedRepo: null,
  excludedRepos: loadExcludedRepos(),
  updateAvailable: false,
  latestVersion: null,
  notifySettings: null,
  notifySettingsOpen: false,
  beepSettings: null,
  beepSettingsOpen: false,
  seenSessionIds: new Set<string>(),
}

const costWindowOrder = Object.keys(costWindowLabels) as readonly CostWindow[]

const MODEL_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#38bdf8', '#f87171'] as const

let state = initialState

// Parse a UTC ISO string and return the epoch ms, or null if invalid.
const parseIso = (isoDate: string): number | null => {
  const utcMs = Date.parse(isoDate)
  if (isNaN(utcMs)) {
    console.warn('parseIso: invalid ISO date string', isoDate)
    return null
  }
  return utcMs
}

const millisecondsSince = (isoDate: string): number | null => {
  const utcMs = parseIso(isoDate)
  return utcMs === null ? null : Date.now() - utcMs
}

const formatRelative = (isoDate: string): string => {
  const utcMs = parseIso(isoDate)
  if (utcMs === null) return 'unknown'

  const seconds = Math.max(0, Math.floor((Date.now() - utcMs) / 1000))
  const minutes = Math.floor(seconds / 60)

  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
  }

  if (minutes >= 1) {
    return `${minutes}m ${seconds % 60}s ago`
  }

  return `${seconds}s ago`
}

// Format a UTC ISO timestamp as a local time string for tooltips / absolute display.
const formatLocalTime = (isoDate: string): string | null => {
  const utcMs = parseIso(isoDate)
  if (utcMs === null) return null
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(utcMs))
}

const redSessionsPastThreshold = (appState: AppState): readonly Session[] =>
  appState.sessions.filter((session) => {
    if (session.status !== 'red') return false
    const ms = millisecondsSince(session.statusSince)
    return ms !== null && ms >= redAlertAfterMs(appState)
  })

const redAlertAfterMs = (appState: AppState): number =>
  appState.redAlertAfterOverrideMs ?? appState.redAlertAfterMs

const redAlertAfterSeconds = (appState: AppState): number =>
  Math.round(redAlertAfterMs(appState) / 1000)

const originalTitle = document.title

const beep = (): void => {
  const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext
  const audioContext = new AudioContextCtor()
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()

  oscillator.type = 'square'
  oscillator.frequency.value = 440
  gain.gain.value = 0.15
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start()
  oscillator.stop(audioContext.currentTime + 0.35)
}

const flashTitle = (): void => {
  document.title = document.title === originalTitle ? 'WAITING!' : originalTitle
}

const tryFocus = (): void => {
  try {
    window.focus()
  } catch (error) {
    console.debug('Could not focus dashboard tab:', error)
  }
}

const handleAlertState = (appState: AppState): AppState => {
  const events = appState.beepSettings?.events ?? ['attention']
  const thresholdMs = redAlertAfterMs(appState)
  const now = Date.now()

  // Detect sessions whose status maps to a selected event
  const matchingSessions = appState.sessions.filter((session) => {
    const event = statusToEvent[session.status]
    if (!events.includes(event)) return false
    const ms = millisecondsSince(session.statusSince)
    return ms !== null && ms >= thresholdMs
  })

  // Detect started events — sessions we haven't seen before
  const newSessions = appState.sessions.filter(
    (s) => events.includes('started') && !appState.seenSessionIds.has(s.id),
  )

  const hasTrigger = matchingSessions.length > 0 || newSessions.length > 0

  // Update seen-session set — build fresh from current sessions to prune evicted ones
  const nextSeenIds = new Set(appState.sessions.map((s) => s.id))

  if (!appState.audioEnabled || !hasTrigger) {
    document.title = originalTitle
    const next = appState.beepCount === 0 ? appState : { ...appState, beepCount: 0 }
    return next.seenSessionIds === nextSeenIds ? next : { ...next, seenSessionIds: nextSeenIds }
  }

  if (appState.maxBeeps !== null && appState.beepCount >= appState.maxBeeps) {
    document.title = 'WAITING!'
    return { ...appState, seenSessionIds: nextSeenIds }
  }

  const shouldAlert = now - appState.lastBeepAt > 3_000

  if (!shouldAlert) {
    document.title = 'WAITING!'
    return { ...appState, seenSessionIds: nextSeenIds }
  }

  flashTitle()
  tryFocus()
  beep()
  return { ...appState, lastBeepAt: now, beepCount: appState.beepCount + 1, seenSessionIds: nextSeenIds }
}

const apiFetch = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

const loadState = async (): Promise<ApiState> => apiFetch<ApiState>('/api/sessions')

const loadUsage = async (): Promise<UsageSummary> => apiFetch<UsageSummary>('/api/usage')

const loadVersion = async (): Promise<VersionInfo> => apiFetch<VersionInfo>('/api/version')

const loadNotifySettings = async (): Promise<NotifySettingsUI> =>
  apiFetch<NotifySettingsUI>('/api/settings/notify')

const saveNotifySettings = async (settings: Record<string, unknown>): Promise<NotifySettingsUI> =>
  apiFetch<NotifySettingsUI>('/api/settings/notify', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })

const loadBeepSettings = async (): Promise<BeepSettingsUI> =>
  apiFetch<BeepSettingsUI>('/api/settings/beep')

const saveBeepSettings = async (settings: Record<string, unknown>): Promise<BeepSettingsUI> =>
  apiFetch<BeepSettingsUI>('/api/settings/beep', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })

const notifyFormatOptions = ['generic', 'pushover', 'teams', 'slack', 'discord'] as const

const notifyEventOptions = ['started', 'finished', 'idle', 'working', 'attention'] as const

const beepEventOptions = ['started', 'finished', 'idle', 'working', 'attention'] as const

const statusToEvent: Record<SessionStatus, string> = {
  green: 'finished',
  yellow: 'idle',
  orange: 'working',
  red: 'attention',
}

const booleanAttrs = new Set(['checked', 'disabled', 'selected', 'readonly', 'multiple', 'hidden'])

const createElement = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  attributes: Record<string, string | undefined> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tagName)

  Object.entries(attributes).forEach(([key, value]) => {
    if (value === undefined) return
    if (booleanAttrs.has(key)) {
      ;(element as Record<string, unknown>)[key] = value === 'true'
    } else {
      element.setAttribute(key, value)
    }
  })

  children.forEach((child) => {
    element.append(child instanceof Node ? child : document.createTextNode(child))
  })

  return element
}

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)

const formatMoney = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)

const usageDaysForWindow = (usage: UsageSummary, costWindow: CostWindow): readonly UsageDay[] =>
  daysForWindow(
    Object.values(usage.projects)
      .filter((project) => !state.excludedRepos.has(project.project))
      .flatMap((project) => project.days),
    costWindow,
  )

const recentUsageDays = (days: readonly UsageDay[]): readonly UsageDay[] =>
  [...days]
    .filter((day) => day.totalCost > 0 || day.totalTokens > 0)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5)

const aggregateModelBreakdowns = (
  days: readonly UsageDay[],
  costWindow: CostWindow,
): readonly { modelName: string; cost: number }[] => {
  const windowDays = daysForWindow(days, costWindow)
  const byModel = new Map<string, number>()
  for (const day of windowDays) {
    for (const breakdown of day.modelBreakdowns) {
      byModel.set(breakdown.modelName, (byModel.get(breakdown.modelName) ?? 0) + breakdown.cost)
    }
  }
  return [...byModel.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([modelName, cost]) => ({ modelName, cost }))
}

const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/

const formatDayLabel = (date: string): string => {
  // date is "YYYY-MM-DD" from ccusage. Append T00:00:00Z and use timeZone:'UTC'
  // to avoid UTC-to-local date shifts (e.g. "2026-06-28" as UTC midnight becomes
  // June 27 in negative-offset timezones).
  if (!dateStringRegex.test(date)) {
    console.warn('formatDayLabel: unexpected date format', date)
    return date
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T00:00:00Z'))
}

const normalizeProjectKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const shortProjectName = (projectKey: string): string => {
  // ccusage keys look like: -Users-name-Private-Projects-dir-name
  // or -Users-name-dir-name. Find the last known path prefix and
  // take everything after it. This preserves dashes in dir names.
  // Only use long, specific prefixes to avoid false positives.
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
  // Fallback: for Linux/macOS paths like -home-user-repo or -Users-name-repo,
  // skip the system dir and username, take the rest.
  const cleaned = projectKey.replace(/^-+/, '')
  const parts = cleaned.split('-').filter(Boolean)
  if (parts.length > 2 && (parts[0] === 'home' || parts[0] === 'Users')) {
    return parts.slice(2).join('-')
  }
  return parts[parts.length - 1] ?? projectKey
}

const projectKeyToPath = (projectKey: string): string =>
  '/' + projectKey.replace(/^-+/, '').split('-').join('/')

const projectCandidatesFor = (session: Session): readonly string[] =>
  [session.usageProject, session.id, session.name]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, normalizeProjectKey(value)])

// Build a lookup map from session candidates to project for the current usage data.
// Used by both isSessionExcluded and findUsageProject to avoid O(sessions x projects).
let projectLookupCache: { readonly usageKey: string; readonly map: ReadonlyMap<string, UsageProject> } | null = null

const buildProjectLookup = (usage: UsageSummary): ReadonlyMap<string, UsageProject> => {
  const cacheKey = Object.keys(usage.projects).sort().join(',')
  if (projectLookupCache?.usageKey === cacheKey) return projectLookupCache.map
  const map = new Map<string, UsageProject>()
  for (const project of Object.values(usage.projects)) {
    map.set(project.project, project)
    map.set(normalizeProjectKey(project.project), project)
  }
  projectLookupCache = { usageKey: cacheKey, map }
  return map
}

const findUsageProjectUnfiltered = (session: Session, usage: UsageSummary): UsageProject | null => {
  const lookup = buildProjectLookup(usage)
  const candidates = projectCandidatesFor(session)
  for (const candidate of candidates) {
    const match = lookup.get(candidate)
    if (match) return match
  }
  // Fallback: suffix match
  for (const candidate of candidates) {
    for (const key of lookup.keys()) {
      if (key.endsWith(candidate)) return lookup.get(key) ?? null
    }
  }
  return null
}

const isSessionExcluded = (session: Session): boolean => {
  // Use unfiltered project lookup so excluded repos are still findable
  if (state.usage?.available) {
    const project = findUsageProjectUnfiltered(session, state.usage)
    if (project && state.excludedRepos.has(project.project)) return true
  }
  // Fallback: match session.usageProject against excluded keys by exact match only
  if (session.usageProject && state.excludedRepos.has(session.usageProject)) return true
  return false
}

const findUsageProject = (session: Session, usage: UsageSummary | null): UsageProject | null => {
  if (!usage?.available) {
    return null
  }

  const projects = state.excludedRepos.size === 0
    ? Object.values(usage.projects)
    : Object.values(usage.projects).filter((p) => !state.excludedRepos.has(p.project))
  const candidates = new Set(projectCandidatesFor(session))

  return (
    projects.find((project) => candidates.has(project.project) || candidates.has(normalizeProjectKey(project.project))) ??
    projects.find((project) =>
      [...candidates].some((candidate) => normalizeProjectKey(project.project).endsWith(candidate)),
    ) ??
    null
  )
}

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
  const ccusageSessions = state.usage?.sessions ?? []
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
    const byModel = new Map<string, number>()
    for (const cs of matchedSessions) {
      for (const b of cs.modelBreakdowns) {
        byModel.set(b.modelName, (byModel.get(b.modelName) ?? 0) + b.cost)
      }
    }
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

const renderSession = (session: Session): HTMLElement => {
  const ageMs = millisecondsSince(session.statusSince)
  const overdue = session.status === 'red' && ageMs !== null && ageMs >= state.redAlertAfterMs
  const usageProject = findUsageProject(session, state.usage)
  const card = createElement('article', {
    class: `session-card session-card--${session.status}${overdue ? ' session-card--overdue' : ''}`,
  })

  card.append(
    createElement('div', { class: 'session-card__topline' }, [
      createElement('span', { class: 'status-dot', title: statusLabels[session.status] }),
      createElement('span', { class: 'session-card__status' }, [statusLabels[session.status]]),
    ]),
    createElement('h2', {}, [session.name]),
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

const formatDateLabel = (isoDate: string): string => {
  if (!isoDate) {
    return 'No active block'
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoDate))
}

const usageMetric = (label: string, value: string): HTMLElement =>
  createElement('div', { class: 'usage__metric' }, [
    createElement('span', {}, [label]),
    createElement('strong', {}, [value]),
  ])

const renderCostWindowControls = (): HTMLElement =>
  createElement('div', { class: 'usage__windows', role: 'group', 'aria-label': 'Cost timeframe' }, [
    ...costWindowOrder.map((costWindow) =>
      createElement(
        'button',
        {
          class: `usage__window${state.costWindow === costWindow ? ' usage__window--active' : ''}`,
          type: 'button',
          'data-cost-window': costWindow,
        },
        [costWindowLabels[costWindow]],
      ),
    ),
  ])

const renderUsage = (usage: UsageSummary | null): HTMLElement => {
  if (!usage) {
    return createElement('section', { class: 'usage usage--loading', 'aria-label': 'Claude usage' }, [
      createElement('h2', {}, ['Claude usage']),
      createElement('p', {}, ['Loading ccusage data...']),
    ])
  }

  if (!usage.available) {
    return createElement('section', { class: 'usage usage--unavailable', 'aria-label': 'Claude usage' }, [
      createElement('h2', {}, ['Claude usage']),
      createElement('p', {}, ['ccusage data is not available. Mount Claude Code logs or set CLAUDE_CONFIG_DIR.']),
    ])
  }

  const activeBlock = usage.activeBlock
  const windowTotals = sumUsageDays(usageDaysForWindow(usage, state.costWindow))

  return createElement('section', { class: 'usage', 'aria-label': 'Claude usage' }, [
    createElement('div', { class: 'usage__header' }, [
      createElement('div', {}, [
        createElement('p', { class: 'usage__eyebrow' }, ['ccusage']),
        createElement('h2', {}, ['Claude usage']),
      ]),
      createElement('div', { class: 'usage__actions' }, [
        renderCostWindowControls(),
        createElement('span', { class: 'usage__freshness', ...(() => {
          const t = formatLocalTime(usage.generatedAt)
          return t !== null ? { title: t } : {}
        })() }, [`Updated ${formatRelative(usage.generatedAt)}`]),
      ]),
    ]),
    createElement('div', { class: 'usage__metrics' }, [
      usageMetric(`Cost · ${costWindowLabels[state.costWindow]}`, formatMoney(windowTotals.totalCost)),
      usageMetric(`Tokens · ${costWindowLabels[state.costWindow]}`, formatNumber(windowTotals.totalTokens)),
      usageMetric(
        'Matched repos',
        (() => {
          const total = Object.keys(usage.projects).length
          if (state.excludedRepos.size === 0) return formatNumber(total)
          const activeExclusions = [...state.excludedRepos].filter((k) => k in usage.projects).length
          return `${formatNumber(total - activeExclusions)}/${formatNumber(total)}`
        })(),
      ),
      usageMetric('Active block', activeBlock ? formatMoney(activeBlock.totalCost) : 'None'),
    ]),
    createElement('div', { class: 'usage__block' }, [
      createElement('span', { class: activeBlock ? 'usage__block-dot usage__block-dot--active' : 'usage__block-dot' }),
      createElement('span', {}, [
        activeBlock
          ? `Active block ${formatDateLabel(activeBlock.startTime)}-${formatDateLabel(activeBlock.endTime)} · ${formatMoney(
              activeBlock.totalCost,
            )} · ${formatNumber(activeBlock.totalTokens)} tokens` +
            (activeBlock.modelsUsed.length > 0 ? ` · ${activeBlock.modelsUsed.join(', ')}` : '')
          : 'No active usage block reported',
      ]),
    ]),
    ...(() => { const s = renderExcludedReposSection(usage); return s ? [s] : [] })(),
  ])
}

const renderRepoCard = (project: UsageProject): HTMLElement => {
  const windowDays = daysForWindow(project.days, state.costWindow)
  const totals = sumUsageDays(windowDays)
  const recentDays = recentUsageDays(windowDays)
  const maxCost = Math.max(...recentDays.map((day) => day.totalCost), 0)
  const isSelected = state.selectedRepo === project.project

  return createElement('article', {
    class: `repo-card${isSelected ? ' repo-card--selected' : ''}`,
    'data-repo': project.project,
  }, [
    createElement('div', { class: 'repo-card__header' }, [
      createElement('h3', { class: 'repo-card__name', title: projectKeyToPath(project.project) }, [shortProjectName(project.project)]),
      createElement('span', { class: 'repo-card__cost' }, [formatMoney(totals.totalCost)]),
      createElement('button', {
        class: 'repo-card__exclude',
        type: 'button',
        'data-exclude-repo': project.project,
        'aria-label': `Exclude ${shortProjectName(project.project)}`,
        title: 'Exclude this repo from the dashboard',
      }, ['✕']),
    ]),
    createElement('div', { class: 'repo-card__metrics' }, [
      createElement('div', {}, [
        createElement('span', {}, ['Tokens']),
        createElement('strong', {}, [formatNumber(totals.totalTokens)]),
      ]),
      createElement('div', {}, [
        createElement('span', {}, ['Days']),
        createElement('strong', {}, [String(windowDays.length)]),
      ]),
      createElement('div', {}, [
        createElement('span', {}, ['Input']),
        createElement('strong', {}, [formatNumber(totals.inputTokens)]),
      ]),
      createElement('div', {}, [
        createElement('span', {}, ['Output']),
        createElement('strong', {}, [formatNumber(totals.outputTokens)]),
      ]),
    ]),
    ...(() => {
      const models = aggregateModelBreakdowns(project.days, state.costWindow)
      if (models.length === 0) return [] as HTMLElement[]
      const maxModelCost = Math.max(...models.map((m) => m.cost), 0)
      return [createElement('div', { class: 'model-breakdown' }, [
        createElement('div', { class: 'model-breakdown__bars' },
          models.map((m, i) =>
            createElement('div', { class: 'model-breakdown__bar' }, [
              createElement('span', { class: 'model-breakdown__label' }, [m.modelName]),
              createElement('span', { class: 'model-breakdown__cost' }, [formatMoney(m.cost)]),
              createElement('span', { class: 'model-breakdown__bar-fill', style: `--bar-width: ${maxModelCost > 0 ? Math.max(4, Math.round((m.cost / maxModelCost) * 100)) : 0}%; --bar-color: ${MODEL_COLORS[i % MODEL_COLORS.length]}` }),
            ]),
          ),
        ),
      ])]
    })(),
    recentDays.length === 0
      ? createElement('div', { class: 'repo-card__daily-empty' }, ['No usage in this window'])
      : createElement(
          'div',
          { class: 'repo-card__daily', 'aria-label': `Daily ${project.project} usage` },
          recentDays.map((day) =>
            createElement('div', { class: 'repo-card__daily-row' }, [
              createElement('span', { class: 'repo-card__daily-date' }, [formatDayLabel(day.date)]),
              createElement('span', {
                class: 'repo-card__daily-bar',
                style: `--bar-width: ${maxCost > 0 ? Math.max(4, Math.round((day.totalCost / maxCost) * 100)) : 0}%`,
              }),
              createElement('span', { class: 'repo-card__daily-cost' }, [formatMoney(day.totalCost)]),
            ]),
          ),
        ),
  ])
}

const renderRepoDetail = (project: UsageProject): HTMLElement => {
  const windowDays = daysForWindow(project.days, state.costWindow)
  const totals = sumUsageDays(windowDays)
  const allDays = [...windowDays]
    .filter((day) => day.totalCost > 0 || day.totalTokens > 0)
    .sort((left, right) => right.date.localeCompare(left.date))
  const maxCost = Math.max(...allDays.map((day) => day.totalCost), 0)

  return createElement('section', { class: 'repo-detail', 'aria-label': `${project.project} cost detail` }, [
    createElement('div', { class: 'repo-detail__header' }, [
      createElement('button', {
        class: 'repo-detail__back',
        type: 'button',
        'data-repo-back': '',
      }, ['← All repos']),
      createElement('div', {}, [
        createElement('h2', {}, [shortProjectName(project.project)]),
        createElement('p', { class: 'repo-detail__path' }, [projectKeyToPath(project.project)]),
        createElement('p', { class: 'repo-detail__subtitle' }, [
          `${formatMoney(totals.totalCost)} · ${formatNumber(totals.totalTokens)} tokens · ${allDays.length} days`,
        ]),
      ]),
    ]),
    createElement('div', { class: 'repo-detail__metrics' }, [
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, [`Cost · ${costWindowLabels[state.costWindow]}`]),
        createElement('strong', {}, [formatMoney(totals.totalCost)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Input tokens']),
        createElement('strong', {}, [formatNumber(totals.inputTokens)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Output tokens']),
        createElement('strong', {}, [formatNumber(totals.outputTokens)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Cache creation']),
        createElement('strong', {}, [formatNumber(totals.cacheCreationTokens)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Cache read']),
        createElement('strong', {}, [formatNumber(totals.cacheReadTokens)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Total tokens']),
        createElement('strong', {}, [formatNumber(totals.totalTokens)]),
      ]),
    ]),
    allDays.length === 0
      ? createElement('p', { class: 'repo-detail__empty' }, ['No usage in this window'])
      : createElement(
          'div',
          { class: 'repo-detail__days', 'aria-label': `Daily breakdown for ${project.project}` },
          allDays.map((day) =>
            createElement('div', { class: 'repo-detail__day' }, [
              createElement('div', { class: 'repo-detail__day-header' }, [
                createElement('span', { class: 'repo-detail__day-date' }, [formatDayLabel(day.date)]),
                createElement('span', { class: 'repo-detail__day-cost' }, [formatMoney(day.totalCost)]),
              ]),
              createElement('div', {
                class: 'repo-detail__day-bar',
                style: `--bar-width: ${maxCost > 0 ? Math.max(2, Math.round((day.totalCost / maxCost) * 100)) : 0}%`,
              }),
              createElement('div', { class: 'repo-detail__day-metrics' }, [
                createElement('span', {}, [`${formatNumber(day.totalTokens)} tokens`]),
                createElement('span', {}, [`${formatNumber(day.inputTokens)} in / ${formatNumber(day.outputTokens)} out`]),
                day.modelBreakdowns.length > 0
                  ? createElement('span', {}, [day.modelBreakdowns.map((b) => `${b.modelName} ${formatMoney(b.cost)}`).join(', ')])
                  : day.modelsUsed.length > 0
                    ? createElement('span', {}, [day.modelsUsed.join(', ')])
                    : createElement('span', {}, ['—']),
              ]),
            ]),
          ),
        ),
  ])
}

const renderExcludedReposSection = (usage: UsageSummary): HTMLElement | null => {
  if (state.excludedRepos.size === 0) return null

  const tags = [...state.excludedRepos]
    .filter((key) => key in usage.projects)
    .map((key) => ({
      key,
      display: shortProjectName(key),
    }))
    .sort((a, b) => a.display.localeCompare(b.display))

  if (tags.length === 0) return null

  return createElement('details', { class: 'excluded-details' }, [
    createElement('summary', { class: 'excluded-details__summary' }, [
      `Excluded repos (${tags.length}) — click to manage`,
    ]),
    createElement('div', { class: 'excluded-details__tags' }, [
      ...tags.map(({ key, display }) =>
        createElement('span', { class: 'excluded-details__tag' }, [
          createElement('span', {}, [display]),
          createElement('button', {
            type: 'button',
            'data-unexclude-repo': key,
            'aria-label': `Include ${display} again`,
            title: `Include ${display} again`,
          }, ['✕']),
        ]),
      ),
    ]),
  ])
}

const renderRepoExplorer = (usage: UsageSummary): HTMLElement => {
  const allProjects = Object.values(usage.projects)
    .filter((project) => {
      const windowDays = daysForWindow(project.days, state.costWindow)
      return windowDays.some((day) => day.totalCost > 0 || day.totalTokens > 0)
    })
    .sort((left, right) => {
      const leftTotals = sumUsageDays(daysForWindow(left.days, state.costWindow))
      const rightTotals = sumUsageDays(daysForWindow(right.days, state.costWindow))
      return rightTotals.totalCost - leftTotals.totalCost
    })

  const projects = allProjects.filter((p) => !state.excludedRepos.has(p.project))

  if (allProjects.length === 0) {
    return createElement('section', { class: 'repo-explorer repo-explorer--empty', 'aria-label': 'Repo cost explorer' }, [
      createElement('h2', {}, ['Costs by repo']),
      createElement('p', {}, ['No repo usage data available for the selected window.']),
    ])
  }

  // If a repo is selected, show its detail view
  if (state.selectedRepo) {
    const selected = projects.find((p) => p.project === state.selectedRepo)
    if (selected) {
      return createElement('section', { class: 'repo-explorer', 'aria-label': 'Repo cost explorer' }, [
        renderRepoDetail(selected),
      ])
    }
  }

  const activeExclusions = [...state.excludedRepos].filter((k) => k in usage.projects).length

  return createElement('section', { class: 'repo-explorer', 'aria-label': 'Repo cost explorer' }, [
    createElement('div', { class: 'repo-explorer__header' }, [
      createElement('h2', {}, ['Costs by repo']),
      createElement('span', { class: 'repo-explorer__count' }, [
        `${projects.length} repo${projects.length === 1 ? '' : 's'}${activeExclusions > 0 ? ` (${activeExclusions} excluded)` : ''}`,
      ]),
    ]),
    projects.length === 0
      ? createElement('p', { class: 'repo-explorer__all-excluded' }, ['All repos with usage data in this window are excluded. Include some from the ccusage card above to see them.'])
      : createElement('div', { class: 'repo-explorer__grid' }, projects.map(renderRepoCard)),
  ])
}

// ── Persistent alert controls (never destroyed, updated in-place) ──
// The full-DOM rebuild every 2s destroys <select> dropdowns and clears text
// selections.  We keep the alert-controls container alive and only mutate
// properties of its children so interactive state (open dropdowns, focus,
// selections) survives refreshes.

let alertControlsRoot: HTMLElement | null = null
let notifyPanelEl: HTMLElement | null = null
let beepPanelEl: HTMLElement | null = null
let alertControlsLive = false

// Helper: sync an input's value only when it is NOT focused (user is not
// actively editing it), avoiding clobbering in-progress typing.
const syncTextLike = (el: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string): void => {
  if (!el || document.activeElement === el) return
  if (el.value !== value) el.value = value
}

const syncCheckbox = (el: HTMLInputElement | null | undefined, checked: boolean): void => {
  if (!el) return
  if (el.checked !== checked) el.checked = checked
}

const syncDisabled = (el: HTMLElement | null | undefined, disabled: boolean): void => {
  if (!el) return
  if (disabled) el.setAttribute('disabled', 'true')
  else el.removeAttribute('disabled')
}

const buildNotifyPanel = (s: NotifySettingsUI): HTMLElement =>
  createElement('div', { class: 'alert-controls__notify-panel' }, [
    // Header
    createElement('div', { class: 'notify-panel__header' }, [
      createElement('h3', {}, ['Notification Settings']),
      createElement('button', {
        class: 'notify-panel__close',
        type: 'button',
        'aria-label': 'Close notification settings',
      }, ['✕']),
    ]),
    // Enable toggle
    createElement('label', { class: 'notify-panel__toggle' }, [
      createElement('input', {
        id: 'notify-enabled',
        type: 'checkbox',
        checked: s.enabled ? 'true' : undefined,
      }),
      createElement('span', {}, ['Enable webhook notifications']),
    ]),
    // Webhook URL
    createElement('div', { class: 'notify-panel__field' }, [
      createElement('label', { for: 'notify-webhook-url' }, ['Webhook URL']),
      createElement('input', {
        id: 'notify-webhook-url',
        type: 'url',
        value: s.webhookUrl,
        placeholder: 'https://api.pushover.net/1/messages.json',
        disabled: s.enabled ? undefined : 'true',
      }),
    ]),
    // Format + Events row (events get extra width to avoid stacking)
    createElement('div', { class: 'notify-panel__row notify-panel__row--events' }, [
      createElement('div', { class: 'notify-panel__field' }, [
        createElement('label', { for: 'notify-format' }, ['Format']),
        createElement('select', {
          id: 'notify-format',
          disabled: s.enabled ? undefined : 'true',
        }, notifyFormatOptions.map(f =>
          createElement('option', { value: f, selected: s.format === f ? 'true' : undefined }, [f]),
        )),
      ]),
      createElement('fieldset', { class: 'notify-panel__events', disabled: s.enabled ? undefined : 'true' }, [
        createElement('legend', {}, ['Events']),
        createElement('div', { class: 'notify-panel__events-content' },
          notifyEventOptions.map(event =>
            createElement('label', {}, [
              createElement('input', {
                type: 'checkbox',
                value: event,
                checked: s.events.includes(event) ? 'true' : undefined,
                disabled: s.enabled ? undefined : 'true',
              }),
              event,
            ]),
          ),
        ),
      ]),
    ]),
    // Pushover API token
    createElement('div', { class: 'notify-panel__field' }, [
      createElement('label', { for: 'notify-pushover-token' }, ['Pushover API token']),
      createElement('input', {
        id: 'notify-pushover-token',
        type: 'password',
        placeholder: s.pushoverToken || '(not set)',
        disabled: s.enabled ? undefined : 'true',
      }),
    ]),
    // Pushover user key
    createElement('div', { class: 'notify-panel__field' }, [
      createElement('label', { for: 'notify-pushover-user' }, ['Pushover user key']),
      createElement('input', {
        id: 'notify-pushover-user',
        type: 'password',
        placeholder: s.pushoverUser || '(not set)',
        disabled: s.enabled ? undefined : 'true',
      }),
    ]),
    // Custom headers
    createElement('div', { class: 'notify-panel__field' }, [
      createElement('label', { for: 'notify-headers' }, ['Custom headers (JSON)']),
      createElement('textarea', {
        id: 'notify-headers',
        rows: '2',
        disabled: s.enabled ? undefined : 'true',
      }, [JSON.stringify(s.headers, null, 2)]),
    ]),
    // Save
    createElement('button', { id: 'notify-save', type: 'button' }, ['Save Settings']),
  ])

const syncNotifyPanelFields = (panel: HTMLElement, s: NotifySettingsUI): void => {
  const enabled = s.enabled
  syncCheckbox(panel.querySelector<HTMLInputElement>('#notify-enabled'), enabled)
  syncTextLike(panel.querySelector<HTMLInputElement>('#notify-webhook-url'), s.webhookUrl)
  syncDisabled(panel.querySelector<HTMLInputElement>('#notify-webhook-url'), !enabled)

  // Format select: update selected option
  const formatSel = panel.querySelector<HTMLSelectElement>('#notify-format')
  if (formatSel) {
    if (formatSel.value !== s.format) formatSel.value = s.format
    syncDisabled(formatSel, !enabled)
  }

  // Event checkboxes
  panel.querySelectorAll<HTMLInputElement>('.notify-panel__events input[type="checkbox"]').forEach(cb => {
    syncCheckbox(cb, s.events.includes(cb.value))
    syncDisabled(cb, !enabled)
  })
  const fieldset = panel.querySelector<HTMLFieldSetElement>('.notify-panel__events')
  syncDisabled(fieldset, !enabled)

  // Pushover fields (password — placeholder shows masked value, sync only when not focused)
  const tokenInput = panel.querySelector<HTMLInputElement>('#notify-pushover-token')
  if (tokenInput) {
    tokenInput.placeholder = s.pushoverToken || '(not set)'
    syncDisabled(tokenInput, !enabled)
  }
  const userInput = panel.querySelector<HTMLInputElement>('#notify-pushover-user')
  if (userInput) {
    userInput.placeholder = s.pushoverUser || '(not set)'
    syncDisabled(userInput, !enabled)
  }

  // Headers textarea
  syncTextLike(panel.querySelector<HTMLTextAreaElement>('#notify-headers'), JSON.stringify(s.headers, null, 2))
  syncDisabled(panel.querySelector<HTMLTextAreaElement>('#notify-headers'), !enabled)

  // Save button
  syncDisabled(panel.querySelector<HTMLButtonElement>('#notify-save'), !enabled)
}

const syncAlertControlsInPlace = (): void => {
  if (!alertControlsRoot) return

  // Beep toggle active class
  const beepToggle = alertControlsRoot.querySelector<HTMLButtonElement>('#beep-toggle')
  if (beepToggle) {
    beepToggle.classList.toggle('audio-toggle--active', state.beepSettingsOpen)
  }

  // Notify toggle active class
  const notifyToggle = alertControlsRoot.querySelector<HTMLButtonElement>('#notify-toggle')
  if (notifyToggle) {
    notifyToggle.classList.toggle('audio-toggle--active', state.notifySettingsOpen)
  }

  // ── Beep panel visibility transitions ──
  {
    const s = state.beepSettings
    const shouldShow = state.beepSettingsOpen && s !== null

    if (shouldShow && !beepPanelEl) {
      beepPanelEl = buildBeepPanel(s)
      alertControlsRoot.append(beepPanelEl)
      attachBeepPanelEvents()
    } else if (shouldShow && beepPanelEl) {
      syncBeepPanelFields(beepPanelEl, s)
    } else if (!shouldShow && beepPanelEl) {
      beepPanelEl.remove()
      beepPanelEl = null
    }
  }

  // ── Notify panel visibility transitions ──
  {
    const s = state.notifySettings
    const shouldShow = state.notifySettingsOpen && s !== null

    if (shouldShow && !notifyPanelEl) {
      notifyPanelEl = buildNotifyPanel(s)
      alertControlsRoot.append(notifyPanelEl)
      attachNotifyPanelEvents()
    } else if (shouldShow && notifyPanelEl) {
      syncNotifyPanelFields(notifyPanelEl, s)
    } else if (!shouldShow && notifyPanelEl) {
      notifyPanelEl.remove()
      notifyPanelEl = null
    }
  }
}

// ── Build the initial alert controls DOM (first render only) ──

const buildAlertControls = (): HTMLElement => {
  const children: HTMLElement[] = [
    createElement('button', {
      id: 'beep-toggle',
      class: `audio-toggle${state.beepSettingsOpen ? ' audio-toggle--active' : ''}`,
      type: 'button',
    }, ['Beeps']),
    createElement('button', {
      id: 'notify-toggle',
      class: `audio-toggle${state.notifySettingsOpen ? ' audio-toggle--active' : ''}`,
      type: 'button',
    }, ['Notifications']),
  ]

  return createElement('div', { class: 'alert-controls', 'aria-label': 'Alert and notification controls' }, children)
}

// ── One-time event listeners for alert controls (never re-attached) ──

const attachAlertControlEvents = (): void => {
  if (alertControlsLive) return
  alertControlsLive = true

  // Beep toggle: open/close settings panel
  document.querySelector<HTMLButtonElement>('#beep-toggle')?.addEventListener('click', () => {
    state = { ...state, beepSettingsOpen: !state.beepSettingsOpen }
    render()
  })

  // Notify toggle: open/close settings panel
  document.querySelector<HTMLButtonElement>('#notify-toggle')?.addEventListener('click', () => {
    state = { ...state, notifySettingsOpen: !state.notifySettingsOpen }
    render()
  })
}

const attachNotifyPanelEvents = (): void => {
  // Close button
  document.querySelector('.notify-panel__close')?.addEventListener('click', () => {
    state = { ...state, notifySettingsOpen: false }
    render()
  })

  // Notify settings: enable/disable toggle (saves immediately)
  document.querySelector<HTMLInputElement>('#notify-enabled')?.addEventListener('change', async (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked
    try {
      const updated = await saveNotifySettings({ enabled: checked })
      state = { ...state, notifySettings: updated }
    } catch { /* ignore */ }
    render()
  })

  // Notify settings: save button
  document.querySelector<HTMLButtonElement>('#notify-save')?.addEventListener('click', async () => {
    const body: Record<string, unknown> = {
      webhookUrl: document.querySelector<HTMLInputElement>('#notify-webhook-url')?.value ?? '',
      format: (document.querySelector<HTMLSelectElement>('#notify-format')?.value) ?? 'generic',
      events: [...document.querySelectorAll<HTMLInputElement>('.notify-panel__events input[type="checkbox"]:checked')]
        .map(el => el.value),
      headers: (() => {
        const raw = document.querySelector<HTMLTextAreaElement>('#notify-headers')?.value ?? ''
        if (!raw.trim()) return {}
        try { const p = JSON.parse(raw); return typeof p === 'object' && p !== null && !Array.isArray(p) ? p as Record<string, string> : {} } catch { return {} }
      })(),
    }
    const tokenInput = document.querySelector<HTMLInputElement>('#notify-pushover-token')
    if (tokenInput?.value) body.pushoverToken = tokenInput.value
    const userInput = document.querySelector<HTMLInputElement>('#notify-pushover-user')
    if (userInput?.value) body.pushoverUser = userInput.value

    try {
      const updated = await saveNotifySettings(body)
      state = { ...state, notifySettings: updated }
    } catch (err) {
      console.error('Failed to save notify settings:', err)
    }
    render()
  })
}

// ── Beep settings floating panel ──────────────────────────────────────

const buildBeepPanel = (s: BeepSettingsUI): HTMLElement =>
  createElement('div', { class: 'alert-controls__beep-panel' }, [
    // Header
    createElement('div', { class: 'beep-panel__header' }, [
      createElement('h3', {}, ['Beep Settings']),
      createElement('button', {
        class: 'beep-panel__close',
        type: 'button',
        'aria-label': 'Close beep settings',
      }, ['✕']),
    ]),
    // Enable toggle
    createElement('label', { class: 'beep-panel__toggle' }, [
      createElement('input', {
        id: 'beep-enabled',
        type: 'checkbox',
        checked: s.enabled ? 'true' : undefined,
      }),
      createElement('span', {}, ['Enable audio alerts']),
    ]),
    // Alert after + Max beeps row
    createElement('div', { class: 'beep-panel__row' }, [
      createElement('div', { class: 'beep-panel__field' }, [
        createElement('label', { for: 'alert-after-seconds' }, ['Wait (seconds)']),
        createElement('input', {
          id: 'alert-after-seconds',
          type: 'number',
          min: '0',
          step: '1',
          inputmode: 'numeric',
          value: String(s.alertAfterMs !== null ? Math.round(s.alertAfterMs / 1000) : Math.round(redAlertAfterMs(state) / 1000)),
          disabled: s.enabled ? undefined : 'true',
        }),
      ]),
      createElement('div', { class: 'beep-panel__field' }, [
        createElement('label', { class: 'beep-panel__check-row' }, [
          createElement('input', {
            id: 'limit-beeps',
            type: 'checkbox',
            checked: s.maxBeeps !== null ? 'true' : undefined,
            disabled: s.enabled ? undefined : 'true',
          }),
          createElement('span', {}, ['Limit to']),
        ]),
        createElement('input', {
          id: 'max-beeps',
          type: 'number',
          step: '1',
          inputmode: 'numeric',
          value: s.maxBeeps !== null ? String(s.maxBeeps) : '',
          placeholder: String(s.maxBeeps ?? 5),
          disabled: s.maxBeeps === null || !s.enabled ? 'true' : undefined,
        }),
      ]),
    ]),
    // Events
    createElement('fieldset', { class: 'beep-panel__events', disabled: s.enabled ? undefined : 'true' }, [
      createElement('legend', {}, ['Events']),
      createElement('div', { class: 'beep-panel__events-content' },
        beepEventOptions.map(event =>
          createElement('label', {}, [
            createElement('input', {
              type: 'checkbox',
              value: event,
              checked: s.events.includes(event) ? 'true' : undefined,
              disabled: s.enabled ? undefined : 'true',
            }),
            event,
          ]),
        ),
      ),
    ]),
    // Save
    createElement('button', { id: 'beep-save', type: 'button' }, ['Save Settings']),
  ])

const syncBeepPanelFields = (panel: HTMLElement, s: BeepSettingsUI): void => {
  const enabled = s.enabled
  syncCheckbox(panel.querySelector<HTMLInputElement>('#beep-enabled'), enabled)
  syncTextLike(
    panel.querySelector<HTMLInputElement>('#alert-after-seconds'),
    String(s.alertAfterMs !== null ? Math.round(s.alertAfterMs / 1000) : Math.round(redAlertAfterMs(state) / 1000)),
  )
  syncDisabled(panel.querySelector<HTMLInputElement>('#alert-after-seconds'), !enabled)
  syncCheckbox(panel.querySelector<HTMLInputElement>('#limit-beeps'), s.maxBeeps !== null)
  syncDisabled(panel.querySelector<HTMLInputElement>('#limit-beeps'), !enabled)
  const maxBeepsInput = panel.querySelector<HTMLInputElement>('#max-beeps')
  if (maxBeepsInput) {
    const val = s.maxBeeps !== null ? String(s.maxBeeps) : ''
    syncTextLike(maxBeepsInput, val)
    syncDisabled(maxBeepsInput, s.maxBeeps === null || !enabled)
    maxBeepsInput.placeholder = String(s.maxBeeps ?? 5)
  }
  // Event checkboxes
  panel.querySelectorAll<HTMLInputElement>('.beep-panel__events input[type="checkbox"]').forEach(cb => {
    syncCheckbox(cb, s.events.includes(cb.value))
    syncDisabled(cb, !enabled)
  })
  const fieldset = panel.querySelector<HTMLFieldSetElement>('.beep-panel__events')
  syncDisabled(fieldset, !enabled)
  syncDisabled(panel.querySelector<HTMLButtonElement>('#beep-save'), !enabled)
}

const attachBeepPanelEvents = (): void => {
  // Close button
  document.querySelector('.beep-panel__close')?.addEventListener('click', () => {
    state = { ...state, beepSettingsOpen: false }
    render()
  })

  // Limit checkbox — toggle max-beeps input disabled state
  document.querySelector<HTMLInputElement>('#limit-beeps')?.addEventListener('change', (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked
    const maxBeepsInput = document.querySelector<HTMLInputElement>('#max-beeps')
    if (maxBeepsInput) {
      syncDisabled(maxBeepsInput, !checked)
      if (!checked) maxBeepsInput.value = ''
    }
  })

  // Enable toggle (saves all panel values immediately)
  document.querySelector<HTMLInputElement>('#beep-enabled')?.addEventListener('change', async (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked

    const alertAfterInput = document.querySelector<HTMLInputElement>('#alert-after-seconds')
    const seconds = alertAfterInput ? Math.max(0, Math.floor(alertAfterInput.valueAsNumber)) : Math.round(redAlertAfterMs(state) / 1000)
    const alertAfterMs = Number.isFinite(seconds) ? seconds * 1000 : null

    const limitChecked = document.querySelector<HTMLInputElement>('#limit-beeps')?.checked ?? false
    const maxBeepsInput = document.querySelector<HTMLInputElement>('#max-beeps')
    const maxBeeps: number | null = (() => {
      if (!limitChecked) return null
      if (!maxBeepsInput || !maxBeepsInput.value.trim()) return null
      const raw = maxBeepsInput.valueAsNumber
      if (Number.isNaN(raw)) return state.beepSettings?.maxBeeps ?? 5
      return Math.max(1, Math.floor(raw))
    })()

    const events = [...document.querySelectorAll<HTMLInputElement>('.beep-panel__events input[type="checkbox"]:checked')]
      .map(el => el.value)

    try {
      const updated = await saveBeepSettings({ enabled, alertAfterMs, maxBeeps, events })
      state = {
        ...state,
        beepSettings: updated,
        audioEnabled: enabled,
        redAlertAfterOverrideMs: updated.alertAfterMs,
        maxBeeps: updated.maxBeeps,
      }
    } catch { /* ignore */ }
    render()
  })

  // Save button
  document.querySelector<HTMLButtonElement>('#beep-save')?.addEventListener('click', async () => {
    const alertAfterInput = document.querySelector<HTMLInputElement>('#alert-after-seconds')
    const seconds = alertAfterInput ? Math.max(0, Math.floor(alertAfterInput.valueAsNumber)) : Math.round(redAlertAfterMs(state) / 1000)
    const alertAfterMs = Number.isFinite(seconds) ? seconds * 1000 : null

    const limitChecked = document.querySelector<HTMLInputElement>('#limit-beeps')?.checked ?? false
    const maxBeepsInput = document.querySelector<HTMLInputElement>('#max-beeps')
    const maxBeeps: number | null = (() => {
      if (!limitChecked) return null
      if (!maxBeepsInput || !maxBeepsInput.value.trim()) return null
      const raw = maxBeepsInput.valueAsNumber
      if (Number.isNaN(raw)) return state.beepSettings?.maxBeeps ?? 5
      return Math.max(1, Math.floor(raw))
    })()

    const events = [...document.querySelectorAll<HTMLInputElement>('.beep-panel__events input[type="checkbox"]:checked')]
      .map(el => el.value)

    const body: Record<string, unknown> = {
      enabled: document.querySelector<HTMLInputElement>('#beep-enabled')?.checked ?? state.beepSettings?.enabled ?? false,
      alertAfterMs,
      maxBeeps,
      events,
    }

    try {
      const updated = await saveBeepSettings(body)
      state = {
        ...state,
        beepSettings: updated,
        audioEnabled: updated.enabled,
        redAlertAfterOverrideMs: updated.alertAfterMs,
        maxBeeps: updated.maxBeeps,
        lastBeepAt: 0,
        beepCount: 0,
      }
    } catch (err) {
      console.error('Failed to save beep settings:', err)
    }
    render()
  })
}

const versionBannerDismissedKey = 'version-banner-dismissed'

// ── Persistent UI containers (survive refresh cycles) ──
// The shell, header, and alert-controls are created once and never detached.
// Only #app-body is replaced on each 2s cycle so interactive state (open
// <select> dropdowns, text selections, focus) is preserved.
let shellEl: HTMLElement | null = null
let headerEl: HTMLElement | null = null
let bodyWrapper: HTMLElement | null = null
let bannerWrapper: HTMLElement | null = null
let firstRender = true

const renderUpdateBanner = (): HTMLElement | null => {
  if (!state.updateAvailable) return null
  if (sessionStorage.getItem(versionBannerDismissedKey) === state.latestVersion) return null

  const latest = state.latestVersion ?? 'unknown'
  const current = __VERSION__

  return createElement('aside', { class: 'update-banner', role: 'status', 'aria-label': 'Update available' }, [
    createElement('div', { class: 'update-banner__body' }, [
      createElement('span', { class: 'update-banner__icon' }, ['↑']),
      createElement('span', {}, [
        `A new version is available: `,
        createElement('strong', {}, [`v${latest}`]),
        ` (you are on v${current}). `,
        createElement(
          'a',
          {
            href: 'https://github.com/danielcg-net/claude_status_dashboard/releases',
            target: '_blank',
            rel: 'noopener',
          },
          ['View releases'],
        ),
      ]),
    ]),
    createElement('button', {
      class: 'update-banner__dismiss',
      type: 'button',
      'aria-label': 'Dismiss update notification',
      title: 'Dismiss',
    }, ['✕']),
  ])
}

const dismissBanner = (): void => {
  if (state.latestVersion) {
    sessionStorage.setItem(versionBannerDismissedKey, state.latestVersion)
  }
  state = { ...state, updateAvailable: false }
  render()
}

const attachBannerDismiss = (container: HTMLElement): void => {
  container.querySelector('.update-banner__dismiss')?.addEventListener('click', dismissBanner)
}

const syncBanner = (): void => {
  if (!bannerWrapper) return
  const newBanner = renderUpdateBanner()
  const existingBanner = bannerWrapper.querySelector('.update-banner')

  if (!newBanner && existingBanner) {
    existingBanner.remove()
  } else if (newBanner && !existingBanner) {
    bannerWrapper.replaceChildren(newBanner)
    attachBannerDismiss(bannerWrapper)
  } else if (newBanner && existingBanner) {
    const newStrong = newBanner.querySelector('strong')?.textContent
    const oldStrong = existingBanner.querySelector('strong')?.textContent
    if (newStrong && newStrong !== oldStrong) {
      bannerWrapper.replaceChildren(newBanner)
      attachBannerDismiss(bannerWrapper)
    }
  }
}

// Build the body content (everything below the header).  This is the part
// that gets rebuilt on each 2s refresh cycle.
const buildBodyContent = (): ReadonlyArray<HTMLElement> => [
  renderUsage(state.usage),
  state.usage?.available ? renderRepoExplorer(state.usage) : createElement('section', { class: 'repo-explorer repo-explorer--empty', 'aria-label': 'Repo cost explorer' }, [
    createElement('h2', {}, ['Costs by repo']),
    createElement('p', {}, ['ccusage data is not available.']),
  ]),
  createElement('section', { class: 'summary', 'aria-label': 'Status summary' }, [
    ...(['green', 'yellow', 'orange', 'red'] as const).map((status) =>
      createElement('div', { class: `summary__item summary__item--${status}` }, [
        createElement('span', {}, [statusLabels[status]]),
        createElement('strong', {}, [String(state.sessions.filter((session) => {
          if (session.status !== status) return false
          if (state.excludedRepos.size > 0 && isSessionExcluded(session)) return false
          if (state.selectedRepo) {
            const project = findUsageProject(session, state.usage)
            return project?.project === state.selectedRepo
          }
          return true
        }).length)]),
      ]),
    ),
  ]),
  state.sessions.length === 0
    ? createElement('section', { class: 'empty' }, [
        createElement('h2', {}, ['No sessions registered']),
        createElement('p', {}, ['Add the dashboard hook to ', createElement('code', {}, ['~/.claude/settings.json']), ':']),
        createElement('pre', { class: 'empty__snippet' }, [
          '{\n',
          '  "hooks": {\n',
          '    "SessionStart": [{ "matcher": ".*", "hooks": [{\n',
          '      "type": "command",\n',
          '      "command": "bash <repo>/hooks/claude-status-dashboard.sh",\n',
          '      "timeout": 5\n',
          '    }] }],\n',
          '    "Stop": [{ "matcher": ".*", "hooks": [{\n',
          '      "type": "command",\n',
          '      "command": "bash <repo>/hooks/claude-status-dashboard.sh",\n',
          '      "timeout": 5\n',
          '    }] }]\n',
          '  }\n',
          '}',
        ]),
        createElement('p', {}, ['Replace ', createElement('code', {}, ['<repo>']), ' with the path to this project.']),
        createElement('p', {}, ['Or test with curl:']),
        createElement('pre', { class: 'empty__snippet' }, [
          'curl -X POST http://localhost:8787/api/sessions \\\n',
          '  -H "Content-Type: application/json" \\\n',
          `  -d '{"name":"test","status":"orange"}'`,
        ]),
      ])
    : createElement('section', { class: 'grid', 'aria-label': 'Claude Code sessions' }, state.sessions
        .filter((session) => {
          if (state.excludedRepos.size > 0 && isSessionExcluded(session)) return false
          if (state.selectedRepo) {
            const project = findUsageProject(session, state.usage)
            return project?.project === state.selectedRepo
          }
          return true
        })
        .map(renderSession)),
]

// Attach event listeners for body content (re-attached after each rebuild).
const attachBodyEvents = (): void => {
  document.querySelectorAll<HTMLButtonElement>('[data-cost-window]').forEach((button) => {
    button.addEventListener('click', () => {
      state = { ...state, costWindow: button.dataset.costWindow as CostWindow, selectedRepo: null }
      render()
    })
  })

  document.querySelectorAll<HTMLElement>('[data-repo]').forEach((card) => {
    card.addEventListener('click', () => {
      state = { ...state, selectedRepo: card.dataset.repo ?? null }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-repo-back]').forEach((button) => {
    button.addEventListener('click', () => {
      state = { ...state, selectedRepo: null }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-exclude-repo]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const repo = button.dataset.excludeRepo
      if (!repo) return
      const next = new Set(state.excludedRepos)
      next.add(repo)
      saveExcludedRepos(next)
      state = {
        ...state,
        excludedRepos: next,
        selectedRepo: state.selectedRepo === repo ? null : state.selectedRepo,
      }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-unexclude-repo]').forEach((button) => {
    button.addEventListener('click', () => {
      const fullKey = button.dataset.unexcludeRepo
      if (!fullKey || !state.excludedRepos.has(fullKey)) return
      const next = new Set(state.excludedRepos)
      next.delete(fullKey)
      saveExcludedRepos(next)
      state = { ...state, excludedRepos: next }
      render()
    })
  })

}

const render = (): void => {
  if (firstRender) {
    // ── First render: create persistent containers ──
    bannerWrapper = createElement('div', { id: 'app-banner' })
    shellEl = createElement('main', { class: 'shell' })
    headerEl = createElement('header', { class: 'header' })
    bodyWrapper = createElement('div', { id: 'app-body' })

    // Build header content
    const banner = renderUpdateBanner()
    if (banner) {
      bannerWrapper.append(banner)
      attachBannerDismiss(bannerWrapper)
    }

    alertControlsRoot = buildAlertControls()
    headerEl.append(
      createElement('div', {}, [
        createElement('p', { class: 'eyebrow' }, ['Local Claude Code monitor']),
        createElement('h1', {}, ['Claude Session Dashboard', createElement('span', { class: 'version-badge' }, [`v${__VERSION__}`])]),
      ]),
      alertControlsRoot,
    )

    shellEl.append(headerEl, bodyWrapper)
    root.replaceChildren(...[bannerWrapper, shellEl].filter((el): el is HTMLElement => el !== null))

    // Initial body content
    bodyWrapper.replaceChildren(...buildBodyContent())

    // One-time alert-control event listeners
    attachAlertControlEvents()

    // Body event listeners
    attachBodyEvents()

    // Show notify panel if already open at startup
    if (state.notifySettingsOpen && state.notifySettings) {
      notifyPanelEl = buildNotifyPanel(state.notifySettings)
      alertControlsRoot.append(notifyPanelEl)
      attachNotifyPanelEvents()
    }

    // Show beep panel if already open at startup
    if (state.beepSettingsOpen && state.beepSettings) {
      beepPanelEl = buildBeepPanel(state.beepSettings)
      alertControlsRoot.append(beepPanelEl)
      attachBeepPanelEvents()
    }

    firstRender = false
    return
  }

  // ── Subsequent renders: sync persistent sections, rebuild body ──
  syncBanner()
  syncAlertControlsInPlace()
  bodyWrapper!.replaceChildren(...buildBodyContent())
  attachBodyEvents()
}

const refresh = async (): Promise<void> => {
  try {
    const nextState = await loadState()
    state = handleAlertState({ ...state, ...nextState })
    render()
  } catch (error) {
    console.error(error)
  }
}

const refreshUsage = async (): Promise<void> => {
  try {
    const usage = await loadUsage()
    state = { ...state, usage }
    render()
  } catch (error) {
    console.error(error)
  }
}

const refreshVersion = async (): Promise<void> => {
  try {
    const info = await loadVersion()
    if (info.latestVersion !== state.latestVersion) {
      state = { ...state, updateAvailable: info.updateAvailable, latestVersion: info.latestVersion }
      render()
    }
  } catch (error) {
    console.error(error)
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

Promise.all([
  loadNotifySettings().then(settings => {
    state = { ...state, notifySettings: settings }
  }),
  loadBeepSettings().then(settings => {
    state = {
      ...state,
      beepSettings: settings,
      audioEnabled: false, // always start muted — browsers require user gesture for AudioContext
      redAlertAfterOverrideMs: settings.alertAfterMs,
      maxBeeps: settings.maxBeeps,
    }
  }),
]).then(() => render()).catch(() => { render() })
void refresh()
void refreshUsage()
void refreshVersion()
window.setInterval(() => void refresh(), 2_000)
window.setInterval(() => void refreshUsage(), 30_000)
window.setInterval(() => void refreshVersion(), 1_800_000)
