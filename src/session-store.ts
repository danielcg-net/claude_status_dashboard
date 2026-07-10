import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { sessionStatuses, type Session, type SessionStore } from './domain.js'

const sessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  usageProject: z.string().nullable(),
  status: z.enum(sessionStatuses),
  detail: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  statusSince: z.string(),
})

const SESSION_FILE = 'sessions.json'

export const evictStaleSessions = (sessions: SessionStore, ttlMs: number): SessionStore => {
  const cutoff = Date.now() - ttlMs
  const entries = [...sessions.entries()].filter(([, s]) => new Date(s.updatedAt).getTime() >= cutoff)
  return new Map(entries)
}

export const loadSessions = async (dataDir: string, ttlMs: number): Promise<SessionStore> => {
  const filePath = join(dataDir, SESSION_FILE)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const entries = parsed
      .map((item) => {
        const result = sessionSchema.safeParse(item)
        return result.success ? ([result.data.id, result.data] as const) : null
      })
      .filter((entry): entry is readonly [string, Session] => entry !== null)
    return evictStaleSessions(new Map(entries), ttlMs)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to load sessions from cache:', error)
    }
    return new Map()
  }
}

export const saveSessions = async (dataDir: string, sessions: SessionStore): Promise<void> => {
  const filePath = join(dataDir, SESSION_FILE)
  const tmpPath = `${filePath}.tmp`
  try {
    await mkdir(dataDir, { recursive: true })
    await writeFile(tmpPath, JSON.stringify([...sessions.values()], null, 2), 'utf-8')
    await rename(tmpPath, filePath)
  } catch (error) {
    console.error('Failed to save sessions to cache:', error)
    await unlink(tmpPath).catch(() => undefined)
  }
}
