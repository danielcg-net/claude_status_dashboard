type SessionStatus = 'green' | 'yellow' | 'orange' | 'red'

type Session = {
  readonly id: string
  readonly name: string
  readonly usageProject: string | null
  readonly status: SessionStatus
  readonly detail: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly statusSince: string
}

type ApiState = {
  readonly sessions: readonly Session[]
  readonly redAlertAfterMs: number
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
}

type UsageProject = {
  readonly project: string
  readonly totals: UsageTotals
  readonly today: UsageDay | null
  readonly days: readonly UsageDay[]
}

type UsageBlock = {
  readonly id: string
  readonly startTime: string
  readonly endTime: string
  readonly actualEndTime: string | null
  readonly isActive: boolean
  readonly totalTokens: number
  readonly totalCost: number
  readonly modelsUsed: readonly string[]
}

type UsageSummary = {
  readonly available: boolean
  readonly generatedAt: string
  readonly totals: UsageTotals
  readonly today: UsageDay | null
  readonly projects: Readonly<Record<string, UsageProject>>
  readonly activeBlock: UsageBlock | null
  readonly error: string | null
}

type CostWindow = 'today' | '2d' | '3d' | '7d' | '14d' | '30d' | '90d' | 'all'

type AppState = ApiState & {
  readonly audioEnabled: boolean
  readonly lastBeepAt: number
  readonly usage: UsageSummary | null
  readonly costWindow: CostWindow
  readonly selectedRepo: string | null
  readonly excludedRepos: ReadonlySet<string>
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
  usage: null,
  costWindow: 'today',
  selectedRepo: null,
  excludedRepos: loadExcludedRepos(),
}

const costWindowLabels: Record<CostWindow, string> = {
  today: 'Today',
  '2d': '2 days',
  '3d': '3 days',
  '7d': '7 days',
  '14d': '14 days',
  '30d': '30 days',
  '90d': '90 days',
  all: 'All',
}

const costWindowOrder = Object.keys(costWindowLabels) as readonly CostWindow[]

const costWindowDays: Partial<Record<CostWindow, number>> = {
  '2d': 2,
  '3d': 3,
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
}

const emptyTotals: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  totalCost: 0,
}

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
    return ms !== null && ms >= appState.redAlertAfterMs
  })

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
  const hasRed = redSessionsPastThreshold(appState).length > 0

  if (!appState.audioEnabled || !hasRed) {
    document.title = originalTitle
    return appState
  }

  const shouldAlert = Date.now() - appState.lastBeepAt > 3_000

  if (!shouldAlert) {
    // Between alerts: keep title at WAITING to maintain visibility
    document.title = 'WAITING!'
    return appState
  }

  flashTitle()
  tryFocus()
  beep()
  return { ...appState, lastBeepAt: Date.now() }
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

const createElement = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  attributes: Record<string, string> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tagName)

  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value)
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

const localIsoDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const daysForWindow = (days: readonly UsageDay[], costWindow: CostWindow): readonly UsageDay[] => {
  if (costWindow === 'all') {
    return days
  }

  if (costWindow === 'today') {
    const today = localIsoDate(new Date())
    return days.filter((day) => day.date === today)
  }

  const windowDays = costWindowDays[costWindow] ?? 1
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (windowDays - 1))
  const cutoffDate = localIsoDate(cutoff)

  return days.filter((day) => day.date >= cutoffDate)
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
    emptyTotals,
  )

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

const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/

const formatDayLabel = (date: string): string => {
  // date is "YYYY-MM-DD" from ccusage. Parse parts to avoid UTC-to-local date shifts
  // (e.g. "2026-06-28" as UTC midnight becomes June 27 in negative-offset timezones).
  if (!dateStringRegex.test(date)) {
    console.warn('formatDayLabel: unexpected date format', date)
    return date
  }
  const parts = date.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
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
  // Fallback: take the last segment (works for simple cases like -Users-name-repo)
  const parts = projectKey.split('-').filter(Boolean)
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

const renderSessionUsage = (usageProject: UsageProject | null): HTMLElement => {
  if (!usageProject) {
    return createElement('div', { class: 'session-card__usage session-card__usage--empty' }, [
      createElement('span', {}, ['No ccusage project match']),
    ])
  }

  const windowDays = daysForWindow(usageProject.days, state.costWindow)
  const totals = sumUsageDays(windowDays)
  const recentDays = recentUsageDays(windowDays)
  const maxCost = Math.max(...recentDays.map((day) => day.totalCost), 0)

  return createElement('div', { class: 'session-card__cost' }, [
    createElement('div', { class: 'session-card__usage' }, [
        createElement('div', {}, [
          createElement('span', {}, [`Cost · ${costWindowLabels[state.costWindow]}`]),
          createElement('strong', {}, [formatMoney(totals.totalCost)]),
        ]),
        createElement('div', {}, [
          createElement('span', {}, ['Tokens']),
          createElement('strong', {}, [formatNumber(totals.totalTokens)]),
        ]),
      ]),
    recentDays.length === 0
      ? createElement('div', { class: 'session-card__daily-empty' }, ['No usage in this window'])
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
    renderSessionUsage(usageProject),
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
            )} · ${formatNumber(activeBlock.totalTokens)} tokens`
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
                day.modelsUsed.length > 0
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

const render = (): void => {
  root.replaceChildren(
    createElement('main', { class: 'shell' }, [
      createElement('header', { class: 'header' }, [
        createElement('div', {}, [
          createElement('p', { class: 'eyebrow' }, ['Local Claude Code monitor']),
          createElement('h1', {}, ['Claude Session Dashboard']),
        ]),
        createElement('button', { id: 'audio-toggle', class: 'audio-toggle', type: 'button' }, [
          state.audioEnabled ? 'Mute beeps' : 'Enable beeps',
        ]),
      ]),
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
              // Hide sessions whose usageProject or matched project is excluded
              if (state.excludedRepos.size > 0 && isSessionExcluded(session)) return false
              // When a repo is selected, only count sessions for that repo
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
            createElement('p', {}, ['Send a POST request to /api/sessions to add the first Claude Code session.']),
          ])
        : createElement('section', { class: 'grid', 'aria-label': 'Claude Code sessions' }, state.sessions
            .filter((session) => {
              // Hide sessions whose usageProject or matched project is excluded
              if (state.excludedRepos.size > 0 && isSessionExcluded(session)) return false
              // When a repo is selected, only show sessions for that repo
              if (state.selectedRepo) {
                const project = findUsageProject(session, state.usage)
                return project?.project === state.selectedRepo
              }
              return true
            })
            .map(renderSession)),
    ]),
  )

  document.querySelector('#audio-toggle')?.addEventListener('click', () => {
    state = { ...state, audioEnabled: !state.audioEnabled }
    render()
  })

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

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

render()
void refresh()
void refreshUsage()
window.setInterval(() => void refresh(), 2_000)
window.setInterval(() => void refreshUsage(), 30_000)
