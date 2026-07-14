// Shared mutable UI state singleton. All rendering modules import `ui` to
// read/write the application state. The state object is replaced on each
// render cycle — never mutated in place.

import type { AppState } from './ui-types.js'
import { loadExcludedRepos, loadExcludedStates } from './ui-storage.js'

export const initialState: AppState = {
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
  sortMode: 'updatedAt-desc',
  pageSize: 10,
  pageIndex: 0,
}

export const ui = { state: initialState }
