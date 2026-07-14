// Alert state machine — audio beeps, title flashing, window focus.
// Manages the beep count, seen-session tracking, and alert threshold logic.

import type { AppState } from './ui-types.js'

const originalTitle = document.title

export const redAlertAfterMs = (appState: AppState): number =>
  appState.redAlertAfterOverrideMs ?? appState.redAlertAfterMs

export const redAlertAfterSeconds = (appState: AppState): number =>
  Math.round(redAlertAfterMs(appState) / 1000)

export const redSessionsPastThreshold = (appState: AppState): readonly { readonly status: string; readonly statusSince: string }[] =>
  appState.sessions.filter((session) => {
    if (session.status !== 'attention') return false
    const utcMs = Date.parse(session.statusSince)
    if (isNaN(utcMs)) return false
    return Date.now() - utcMs >= redAlertAfterMs(appState)
  })

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

export const handleAlertState = (appState: AppState): AppState => {
  const events = appState.beepSettings?.events ?? ['attention']
  const thresholdMs = redAlertAfterMs(appState)
  const now = Date.now()

  // Detect sessions whose status maps to a selected event
  const matchingSessions = appState.sessions.filter((session) => {
    if (!events.includes(session.status)) return false
    const utcMs = Date.parse(session.statusSince)
    return !isNaN(utcMs) && (now - utcMs) >= thresholdMs
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
