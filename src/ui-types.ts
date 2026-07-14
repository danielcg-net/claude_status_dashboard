// Shared types and constants for the browser client UI.
// No DOM access, no runtime side effects — safe to import from any module.

import type {
  CostWindow,
  Session,
  SessionStatus,
  UsageBlock,
  UsageDay,
  UsageProject,
  UsageSession,
  UsageTotals,
} from './client-utils.js'

export type {
  CostWindow,
  Session,
  SessionStatus,
  UsageBlock,
  UsageDay,
  UsageProject,
  UsageSession,
  UsageTotals,
}

export { costWindowLabels } from './client-utils.js'

export type ApiState = {
  readonly sessions: readonly Session[]
  readonly redAlertAfterMs: number
}

export type UsageSummary = {
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

export type VersionInfo = {
  readonly version: string
  readonly latestVersion: string | null
  readonly updateAvailable: boolean
}

export type UpdateResult = {
  readonly success: boolean
  readonly mode: 'npm' | 'docker'
  readonly message: string
  readonly requiresRestart: boolean
}

export type NotifySettingsUI = {
  readonly enabled: boolean
  readonly webhookUrl: string
  readonly format: string
  readonly events: readonly string[]
  readonly pushoverToken: string
  readonly pushoverUser: string
  readonly headers: Readonly<Record<string, string>>
}

export type BeepSettingsUI = {
  readonly enabled: boolean
  readonly alertAfterMs: number | null
  readonly maxBeeps: number | null
  readonly events: readonly string[]
}

export type HooksSettingsUI = {
  readonly installed: boolean
  readonly configLocation: 'global' | 'project' | 'both' | 'none'
  readonly scriptExists: boolean
  readonly scriptPath: string
  readonly scriptVersion: string | null
  readonly events: readonly string[]
  readonly error: string | null
}

export type SortMode = 'status' | 'updatedAt-desc' | 'updatedAt-asc'

export type AppState = ApiState & {
  readonly audioEnabled: boolean
  readonly lastBeepAt: number
  readonly beepCount: number
  readonly redAlertAfterOverrideMs: number | null
  readonly maxBeeps: number | null
  readonly usage: UsageSummary | null
  readonly costWindow: CostWindow
  readonly selectedRepo: string | null
  readonly excludedRepos: ReadonlySet<string>
  readonly excludedStates: ReadonlySet<SessionStatus>
  readonly updateAvailable: boolean
  readonly latestVersion: string | null
  readonly updateInProgress: boolean
  readonly deploymentMessage: string | null
  readonly notifySettings: NotifySettingsUI | null
  readonly notifySettingsOpen: boolean
  readonly beepSettings: BeepSettingsUI | null
  readonly beepSettingsOpen: boolean
  readonly hooksSettings: HooksSettingsUI | null
  readonly hooksSettingsOpen: boolean
  readonly seenSessionIds: ReadonlySet<string>
  readonly sortMode: SortMode
  readonly pageSize: number
  readonly pageIndex: number
}

export const statusLabels: Record<SessionStatus, string> = {
  finished: 'Finished',
  idle: 'Idle',
  working: 'Running',
  attention: 'Waiting',
}

export const statusDetails: Record<SessionStatus, string> = {
  finished: 'Claude has finished running something.',
  idle: 'Claude is idle at the prompt, waiting for your input.',
  working: 'Claude is thinking and doing stuff.',
  attention: 'Claude is paused for an approval or decision.',
}

/** Map semantic status → CSS color name (e.g. 'finished' → 'green').
 *  CSS classes remain color-based; this bridges the two naming schemes. */
export const statusToColor: Record<SessionStatus, string> = {
  finished: 'green',
  idle: 'yellow',
  working: 'orange',
  attention: 'red',
}

export const statusSortOrder: Record<SessionStatus, number> = {
  attention: 0,
  working: 1,
  idle: 2,
  finished: 3,
}

export const MODEL_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#38bdf8', '#f87171'] as const

export const costWindowOrder = ['today', '2d', '3d', '7d', '14d', '30d', '90d', 'all'] as const

export const booleanAttrs = new Set(['checked', 'disabled', 'selected', 'readonly', 'multiple', 'hidden'])

export const notifyFormatOptions = ['generic', 'pushover', 'teams', 'slack', 'discord'] as const

export const notifyEventOptions = ['started', 'finished', 'idle', 'working', 'attention'] as const

export const beepEventOptions = ['started', 'finished', 'idle', 'working', 'attention'] as const
