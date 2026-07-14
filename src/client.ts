// ── App shell — state initialisation, API polling, bootstrap ──────────
// Rendering lives in ui-render.ts; utilities in ui-format / ui-storage / ui-api;
// panels in ui-panel-*.ts; types in ui-types.ts; DOM helpers in ui-dom.ts.

import { loadState, loadUsage, loadVersion, loadNotifySettings, loadBeepSettings, loadHookSettings } from './ui-api.js'
import { render } from './ui-render.js'
import { ui } from './ui-state.js'
import { handleAlertState } from './ui-alerts.js'

declare const __VERSION__: string

// ── Polling ──────────────────────────────────────────────────────────

const refresh = async (): Promise<void> => {
  try {
    const nextState = await loadState()
    ui.state = handleAlertState({ ...ui.state, ...nextState })
    render()
  } catch (error) {
    console.error(error)
  }
}

const refreshUsage = async (): Promise<void> => {
  try {
    const usage = await loadUsage()
    ui.state = { ...ui.state, usage }
    render()
  } catch (error) {
    console.error(error)
  }
}

const refreshVersion = async (): Promise<void> => {
  try {
    const info = await loadVersion()
    if (info.latestVersion !== ui.state.latestVersion) {
      ui.state = { ...ui.state, updateAvailable: info.updateAvailable, latestVersion: info.latestVersion }
      render()
    }
  } catch (error) {
    console.error(error)
  }
}

const refreshHooks = async (): Promise<void> => {
  try {
    const settings = await loadHookSettings()
    if (JSON.stringify(settings) !== JSON.stringify(ui.state.hooksSettings)) {
      ui.state = { ...ui.state, hooksSettings: settings }
      render()
    }
  } catch (error) {
    console.error('Failed to refresh hooks status:', error)
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

Promise.all([
  loadNotifySettings().then(settings => {
    ui.state = { ...ui.state, notifySettings: settings }
  }),
  loadBeepSettings().then(settings => {
    ui.state = {
      ...ui.state,
      beepSettings: settings,
      audioEnabled: false, // always start muted — browsers require user gesture for AudioContext
      redAlertAfterOverrideMs: settings.alertAfterMs,
      maxBeeps: settings.maxBeeps,
    }
  }),
  // Hooks status is loaded optimistically — failures (e.g. Docker without
  // filesystem access) are surfaced in the UI via the error field.
  loadHookSettings().then(settings => {
    ui.state = { ...ui.state, hooksSettings: settings }
  }).catch(() => {
    ui.state = {
      ...ui.state,
      hooksSettings: {
        installed: false,
        configLocation: 'none',
        scriptExists: false,
        scriptPath: '',
        scriptVersion: null,
        events: [],
        error: 'Failed to load hooks status. Is the filesystem accessible?',
      },
    }
  }),
]).then(() => render()).catch(() => { render() })
void refresh()
void refreshUsage()
void refreshVersion()
window.setInterval(() => void refresh(), 2_000)
window.setInterval(() => void refreshUsage(), 30_000)
window.setInterval(() => void refreshHooks(), 30_000)
window.setInterval(() => void refreshVersion(), 1_800_000)
