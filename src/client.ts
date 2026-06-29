type SessionStatus = 'green' | 'orange' | 'red'

type Session = {
  readonly id: string
  readonly name: string
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

type AppState = ApiState & {
  readonly audioEnabled: boolean
  readonly lastBeepAt: number
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

const renderSession = (session: Session): HTMLElement => {
  const ageMs = millisecondsSince(session.statusSince)
  const overdue = session.status === 'red' && ageMs >= state.redAlertAfterMs
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

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

render()
void refresh()
window.setInterval(() => void refresh(), 2_000)
