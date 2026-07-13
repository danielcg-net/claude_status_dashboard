import { z } from 'zod'

export const sessionStatuses = ['finished', 'idle', 'working', 'attention'] as const

export const sessionStatusSchema = z.enum(sessionStatuses)

export const registerSessionSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  usageProject: z.string().trim().min(1).max(260).optional(),
  status: sessionStatusSchema.default('working'),
  detail: z.string().trim().max(500).optional(),
})

export const updateSessionSchema = z.object({
  status: sessionStatusSchema,
  usageProject: z.string().trim().min(1).max(260).optional(),
  detail: z.string().trim().max(500).optional(),
})

export type SessionStatus = (typeof sessionStatuses)[number]

/** Map a semantic session status to its display color (for CSS classes, status dots, etc.). */
export const statusToColor: Record<SessionStatus, string> = {
  finished: 'green',
  idle: 'yellow',
  working: 'orange',
  attention: 'red',
}

/** Map legacy color names to semantic statuses for backward compatibility with
 *  persisted data and localStorage written by previous versions. */
const LEGACY_COLOR_TO_STATUS: Record<string, SessionStatus> = {
  green: 'finished',
  yellow: 'idle',
  orange: 'working',
  red: 'attention',
}

/** Normalize a status value that might be a legacy color name to its semantic equivalent. */
export const migrateStatus = (value: string): SessionStatus =>
  LEGACY_COLOR_TO_STATUS[value] ?? (value as SessionStatus)

export type Session = {
  readonly id: string
  readonly name: string
  readonly usageProject: string | null
  readonly status: SessionStatus
  readonly detail: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly statusSince: string
}

export type SessionStore = ReadonlyMap<string, Session>

const nowIso = (): string => new Date().toISOString()

const makeId = (): string => `session-${crypto.randomUUID()}`

const displayName = (id: string, name: string | undefined): string => name ?? id

export const serializeSessions = (sessions: SessionStore): readonly Session[] =>
  [...sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

export const registerSession = (
  sessions: SessionStore,
  input: z.infer<typeof registerSessionSchema>,
): readonly [SessionStore, Session] => {
  const id = input.id ?? makeId()
  const previous = sessions.get(id)
  const timestamp = nowIso()
  const statusChanged = previous?.status !== input.status
  const session: Session = {
    id,
    name: displayName(id, input.name ?? previous?.name),
    usageProject: input.usageProject ?? previous?.usageProject ?? null,
    status: input.status,
    detail: input.detail ?? previous?.detail ?? '',
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    statusSince: statusChanged ? timestamp : (previous?.statusSince ?? timestamp),
  }

  return [new Map(sessions).set(id, session), session]
}

export const updateSession = (
  sessions: SessionStore,
  id: string,
  input: z.infer<typeof updateSessionSchema>,
): readonly [SessionStore, Session | undefined] => {
  const previous = sessions.get(id)

  if (!previous) {
    return [sessions, undefined]
  }

  const timestamp = nowIso()
  const statusChanged = previous.status !== input.status
  const session: Session = {
    ...previous,
    status: input.status,
    usageProject: input.usageProject ?? previous.usageProject,
    detail: input.detail ?? previous.detail,
    updatedAt: timestamp,
    statusSince: statusChanged ? timestamp : previous.statusSince,
  }

  return [new Map(sessions).set(id, session), session]
}

export const deleteSession = (sessions: SessionStore, id: string): readonly [SessionStore, boolean] => {
  if (!sessions.has(id)) {
    return [sessions, false]
  }

  const next = new Map(sessions)
  next.delete(id)
  return [next, true]
}

/**
 * Sessions in these transient states may be stale if the Stop hook never
 * fired (e.g. Claude Code was killed or crashed). They are candidates for
 * automatic transition to 'idle' after the stale threshold elapses.
 */
const TRANSIENT_STATUSES: ReadonlySet<SessionStatus> = new Set(['working', 'attention'])

/**
 * Transitions sessions stuck in transient states ('working', 'attention')
 * to 'idle' when their `updatedAt` is older than `staleThresholdMs`.
 *
 * A session that hasn't been updated in that long is almost certainly a
 * zombie — the Claude Code process that owned it died without firing Stop.
 * Returns the updated store and the list of auto-transitioned sessions.
 *
 * `updatedAt` is NOT reset — it continues to reflect the last real hook
 * activity so the eviction TTL is measured from the original timestamp,
 * not from the auto-idle moment.
 */
export const transitionStaleSessions = (
  sessions: SessionStore,
  staleThresholdMs: number,
): readonly [SessionStore, Session[]] => {
  const cutoff = Date.now() - staleThresholdMs
  const autoIdled: Session[] = []
  let changed = false
  const next = new Map(sessions)

  for (const [id, session] of next) {
    if (!TRANSIENT_STATUSES.has(session.status)) continue
    if (new Date(session.updatedAt).getTime() >= cutoff) continue

    const now = new Date().toISOString()
    const transitioned: Session = {
      ...session,
      status: 'idle',
      detail: `${session.detail} (auto-idled at ${now}: no update for >${Math.round(staleThresholdMs / 60000)}min)`,
      statusSince: now,
      // updatedAt preserved — keeps the eviction clock honest
    }
    next.set(id, transitioned)
    autoIdled.push(transitioned)
    changed = true
  }

  return changed ? ([next, autoIdled] as const) : ([sessions, autoIdled] as const)
}
