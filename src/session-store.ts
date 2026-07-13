import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { migrateStatus, sessionStatuses, type Session, type SessionStore } from './domain.js'

const sessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  usageProject: z.string().nullable(),
  status: z.enum(sessionStatuses),
  detail: z.string(),
  summary: z.string().catch(''),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  statusSince: z.string().datetime(),
})

const SESSION_FILE = 'sessions.json'

export const evictStaleSessions = (sessions: SessionStore, ttlMs: number): SessionStore => {
  const cutoff = Date.now() - ttlMs
  const entries = [...sessions.entries()].filter(([, s]) => new Date(s.updatedAt).getTime() >= cutoff)
  return new Map(entries)
}

export const loadSessions = async (dataDir: string, ttlMs: number): Promise<SessionStore> => {
  const filePath = join(resolve(dataDir), SESSION_FILE)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn(`Session cache at ${filePath} is not an array — discarding.`)
      return new Map()
    }
    const entries = parsed
      .map((item: unknown) => {
        // Migrate legacy color statuses to semantic names (v0.4.x → v0.5.0).
        if (typeof item === 'object' && item !== null && 'status' in item) {
          const record = item as Record<string, unknown>
          if (typeof record.status === 'string') {
            return { ...record, status: migrateStatus(record.status) }
          }
        }
        return item
      })
      .map((item, index) => {
        const result = sessionSchema.safeParse(item)
        if (!result.success) {
          console.warn(`Skipping invalid session entry at index ${index} in ${filePath}`)
          return null
        }
        return [result.data.id, result.data] as const
      })
      .filter((entry): entry is readonly [string, Session] => entry !== null)
    return evictStaleSessions(new Map(entries), ttlMs)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to load sessions from cache (${filePath}):`, error)
    }
    return new Map()
  }
}

export const saveSessions = async (dataDir: string, sessions: SessionStore): Promise<void> => {
  const dir = resolve(dataDir)
  const filePath = join(dir, SESSION_FILE)
  const tmpPath = `${filePath}.tmp`
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    console.error(`Failed to create session cache directory (${dir}):`, error)
    return
  }
  try {
    await writeFile(tmpPath, JSON.stringify([...sessions.values()], null, 2), 'utf-8')
    await rename(tmpPath, filePath)
  } catch (error) {
    console.error(`Failed to save sessions to cache (${filePath}):`, error)
    await unlink(tmpPath).catch(() => undefined)
  }
}
