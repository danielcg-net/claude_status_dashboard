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
