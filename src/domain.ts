import { z } from 'zod'

export const sessionStatuses = ['green', 'orange', 'red'] as const

export const sessionStatusSchema = z.enum(sessionStatuses)

export const registerSessionSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  usageProject: z.string().trim().min(1).max(260).optional(),
  status: sessionStatusSchema.default('orange'),
  detail: z.string().trim().max(500).optional(),
})

export const updateSessionSchema = z.object({
  status: sessionStatusSchema,
  usageProject: z.string().trim().min(1).max(260).optional(),
  detail: z.string().trim().max(500).optional(),
})

export type SessionStatus = (typeof sessionStatuses)[number]

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
