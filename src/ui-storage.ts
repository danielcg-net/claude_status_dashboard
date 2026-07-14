// LocalStorage helpers for persisting UI preferences (excluded repos, excluded states).
// Pure functions — no DOM access beyond localStorage, safe to test with jsdom.

import type { SessionStatus } from './domain.js'

const EXCLUDED_STATES_LEGACY_MAP: Record<string, SessionStatus> = {
  green: 'finished',
  yellow: 'idle',
  orange: 'working',
  red: 'attention',
}

export const loadExcludedRepos = (): ReadonlySet<string> => {
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

export const saveExcludedRepos = (excluded: ReadonlySet<string>): void => {
  try {
    localStorage.setItem('excludedRepos', JSON.stringify([...excluded]))
  } catch (error) {
    console.warn('Could not save excluded repos to localStorage:', error)
  }
}

export const loadExcludedStates = (): ReadonlySet<SessionStatus> => {
  try {
    const raw = localStorage.getItem('excludedStates')
    if (raw === null) return new Set<SessionStatus>()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set<SessionStatus>()
    const migrated = parsed
      .map((item: string) => EXCLUDED_STATES_LEGACY_MAP[item] ?? item)
      .filter((item): item is SessionStatus =>
        typeof item === 'string' && ['finished', 'idle', 'working', 'attention'].includes(item),
      )
    const result = new Set<SessionStatus>(migrated)
    // Persist migrated values so subsequent reads don't re-migrate
    if (migrated.length > 0) {
      try { localStorage.setItem('excludedStates', JSON.stringify([...result])) } catch { /* ignore */ }
    }
    return result
  } catch (error) {
    console.warn('Could not load excluded states from localStorage:', error)
    return new Set<SessionStatus>()
  }
}

export const saveExcludedStates = (excluded: ReadonlySet<SessionStatus>): void => {
  try {
    localStorage.setItem('excludedStates', JSON.stringify([...excluded]))
  } catch (error) {
    console.warn('Could not save excluded states to localStorage:', error)
  }
}

// ── Toolbar preferences ─────────────────────────────────────────────────────

export type ToolbarPrefs = {
  readonly sortMode: string
  readonly pageSize: number
  readonly cardsPerLine: number
}

const DEFAULT_TOOLBAR_PREFS: ToolbarPrefs = {
  sortMode: 'updatedAt-desc',
  pageSize: 10,
  cardsPerLine: 0,
}

const VALID_SORT_MODES = new Set(['status', 'updatedAt-desc', 'updatedAt-asc'])

export const loadToolbarPrefs = (): ToolbarPrefs => {
  try {
    const raw = localStorage.getItem('toolbarPrefs')
    if (raw === null) return DEFAULT_TOOLBAR_PREFS
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_TOOLBAR_PREFS
    return {
      sortMode: typeof parsed.sortMode === 'string' && VALID_SORT_MODES.has(parsed.sortMode)
        ? parsed.sortMode
        : DEFAULT_TOOLBAR_PREFS.sortMode,
      pageSize: typeof parsed.pageSize === 'number' && Number.isFinite(parsed.pageSize) && parsed.pageSize > 0
        ? parsed.pageSize
        : DEFAULT_TOOLBAR_PREFS.pageSize,
      cardsPerLine: typeof parsed.cardsPerLine === 'number' && Number.isFinite(parsed.cardsPerLine) && parsed.cardsPerLine >= 0
        ? parsed.cardsPerLine
        : DEFAULT_TOOLBAR_PREFS.cardsPerLine,
    }
  } catch (error) {
    console.warn('Could not load toolbar prefs from localStorage:', error)
    return DEFAULT_TOOLBAR_PREFS
  }
}

export const saveToolbarPrefs = (prefs: ToolbarPrefs): void => {
  try {
    localStorage.setItem('toolbarPrefs', JSON.stringify(prefs))
  } catch (error) {
    console.warn('Could not save toolbar prefs to localStorage:', error)
  }
}
