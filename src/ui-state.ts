// Shared mutable UI state singleton. All rendering modules import `ui` to
// read/write the application state. The state object is replaced on each
// render cycle — never mutated in place.

import type { AppState } from './ui-types.js'
import { loadExcludedRepos, loadExcludedStates, loadToolbarPrefs } from './ui-storage.js'

const toolbarPrefs = loadToolbarPrefs()

export const initialState: AppState = {
  sessions: [],
  redAlertAfterMs: 300_000,
  persistError: null,
  audioEnabled: false,
  lastBeepAt: 0,
  beepCount: 0,
  redAlertAfterOverrideMs: null,
  maxBeeps: null,
  usage: null,
  costWindow: 'today',
  selectedRepo: null,
  excludedRepos: loadExcludedRepos(),
  excludedStates: loadExcludedStates(),
  updateAvailable: false,
  latestVersion: null,
  notifySettings: null,
  notifySettingsOpen: false,
  beepSettings: null,
  beepSettingsOpen: false,
  hooksSettings: null,
  hooksSettingsOpen: false,
  seenSessionIds: new Set<string>(),
  updateInProgress: false,
  deploymentMessage: null,
  sortMode: toolbarPrefs.sortMode as AppState['sortMode'],
  pageSize: toolbarPrefs.pageSize,
  pageIndex: 0,
  cardsPerLine: toolbarPrefs.cardsPerLine,
}

export const ui = { state: initialState }
