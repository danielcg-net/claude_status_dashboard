import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const notifyFormats = ['generic', 'pushover', 'teams', 'slack', 'discord'] as const
export const notifyEvents = ['started', 'finished', 'idle', 'working', 'attention'] as const

export const notifySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  webhookUrl: z.string().default(''),
  format: z.enum(notifyFormats).default('generic'),
  events: z.array(z.enum(notifyEvents)).default([...notifyEvents]),
  pushoverToken: z.string().default(''),
  pushoverUser: z.string().default(''),
  headers: z.record(z.string(), z.string()).default({}),
})

export type NotifySettings = z.infer<typeof notifySettingsSchema>

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const SETTINGS_FILE = 'notify-settings.json'

/** Load persisted notify settings. Returns `null` when no file exists
 *  (first run — caller should use env-var defaults). */
export const loadNotifySettings = async (dataDir: string): Promise<NotifySettings | null> => {
  const filePath = join(resolve(dataDir), SETTINGS_FILE)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    return notifySettingsSchema.parse(parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    console.error(`Failed to load notify settings (${filePath}):`, error)
    return null
  }
}

/** Persist notify settings to disk. Atomic write via .tmp + rename(). */
export const saveNotifySettings = async (dataDir: string, settings: NotifySettings): Promise<void> => {
  const dir = resolve(dataDir)
  const filePath = join(dir, SETTINGS_FILE)
  const tmpPath = `${filePath}.tmp`
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    console.error(`Failed to create notify settings directory (${dir}):`, error)
    return
  }
  try {
    await writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf-8')
    await rename(tmpPath, filePath)
  } catch (error) {
    console.error(`Failed to save notify settings (${filePath}):`, error)
    await unlink(tmpPath).catch(() => undefined)
  }
}
