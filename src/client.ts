type SessionStatus = 'green' | 'orange' | 'red'

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
}

const statusLabels: Record<SessionStatus, string> = {
  green: 'Finished',
  orange: 'Running',
  red: 'Waiting',
}

const statusDetails: Record<SessionStatus, string> = {
  green: 'Claude has finished running something.',
  orange: 'Claude is thinking and doing stuff.',
  red: 'Claude is paused for an approval or decision.',
}

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing #app root element.')
}

const initialState: AppState = {
  sessions: [],
  redAlertAfterMs: 300_000,
  audioEnabled: false,
  lastBeepAt: 0,
  usage: null,
  costWindow: 'today',
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

const millisecondsSince = (isoDate: string): number => Date.now() - new Date(isoDate).getTime()

const formatRelative = (isoDate: string): string => {
  const seconds = Math.max(0, Math.floor(millisecondsSince(isoDate) / 1000))
  const minutes = Math.floor(seconds / 60)

  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
  }

  if (minutes >= 1) {
    return `${minutes}m ${seconds % 60}s ago`
  }

  return `${seconds}s ago`
}

const redSessionsPastThreshold = (appState: AppState): readonly Session[] =>
  appState.sessions.filter(
    (session) => session.status === 'red' && millisecondsSince(session.statusSince) >= appState.redAlertAfterMs,
  )

const beep = (): void => {
  const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext
  const audioContext = new AudioContextCtor()
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.value = 220
  gain.gain.value = 0.05
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start()
  oscillator.stop(audioContext.currentTime + 0.18)
}

const maybeBeep = (appState: AppState): AppState => {
  const shouldBeep =
    appState.audioEnabled &&
    redSessionsPastThreshold(appState).length > 0 &&
    Date.now() - appState.lastBeepAt > 15_000

  if (!shouldBeep) {
    return appState
  }

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

const recentUsageDays = (days: readonly UsageDay[]): readonly UsageDay[] =>
  [...days]
    .filter((day) => day.totalCost > 0 || day.totalTokens > 0)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5)

const formatDayLabel = (date: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00`))

const normalizeProjectKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const projectCandidatesFor = (session: Session): readonly string[] =>
  [session.usageProject, session.id, session.name]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, normalizeProjectKey(value)])

const findUsageProject = (session: Session, usage: UsageSummary | null): UsageProject | null => {
  if (!usage?.available) {
    return null
  }

  const projects = Object.values(usage.projects)
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
          { class: 'session-card__daily', 'aria-label': `Daily ${usageProject.project} usage` },
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
  const overdue = session.status === 'red' && ageMs >= state.redAlertAfterMs
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
        createElement('dd', {}, [formatRelative(session.statusSince)]),
      ]),
      createElement('div', {}, [
        createElement('dt', {}, ['Updated']),
        createElement('dd', {}, [formatRelative(session.updatedAt)]),
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

  return createElement('section', { class: 'usage', 'aria-label': 'Claude usage' }, [
    createElement('div', { class: 'usage__header' }, [
      createElement('div', {}, [
        createElement('p', { class: 'usage__eyebrow' }, ['ccusage']),
        createElement('h2', {}, ['Claude usage']),
      ]),
      createElement('div', { class: 'usage__actions' }, [
        renderCostWindowControls(),
        createElement('span', { class: 'usage__freshness' }, [`Updated ${formatRelative(usage.generatedAt)}`]),
      ]),
    ]),
    createElement('div', { class: 'usage__metrics' }, [
      usageMetric('Today cost', formatMoney(usage.today?.totalCost ?? 0)),
      usageMetric('Today tokens', formatNumber(usage.today?.totalTokens ?? 0)),
      usageMetric('Total cost', formatMoney(usage.totals.totalCost)),
      usageMetric('Total tokens', formatNumber(usage.totals.totalTokens)),
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
      createElement('section', { class: 'summary', 'aria-label': 'Status summary' }, [
        ...(['green', 'orange', 'red'] as const).map((status) =>
          createElement('div', { class: `summary__item summary__item--${status}` }, [
            createElement('span', {}, [statusLabels[status]]),
            createElement('strong', {}, [String(state.sessions.filter((session) => session.status === status).length)]),
          ]),
        ),
      ]),
      state.sessions.length === 0
        ? createElement('section', { class: 'empty' }, [
            createElement('h2', {}, ['No sessions registered']),
            createElement('p', {}, ['Send a POST request to /api/sessions to add the first Claude Code session.']),
          ])
        : createElement('section', { class: 'grid', 'aria-label': 'Claude Code sessions' }, state.sessions.map(renderSession)),
    ]),
  )

  document.querySelector('#audio-toggle')?.addEventListener('click', () => {
    state = { ...state, audioEnabled: !state.audioEnabled }
    render()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-cost-window]').forEach((button) => {
    button.addEventListener('click', () => {
      state = { ...state, costWindow: button.dataset.costWindow as CostWindow }
      render()
    })
  })
}

const refresh = async (): Promise<void> => {
  try {
    const nextState = await loadState()
    state = maybeBeep({ ...state, ...nextState })
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
