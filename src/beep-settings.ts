import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const beepEvents = ['started', 'finished', 'idle', 'working', 'attention'] as const

export const beepSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  alertAfterMs: z.number().nullable().default(null),
  maxBeeps: z.number().nullable().default(null),
  events: z.array(z.enum(beepEvents)).default(['attention']),
})

export type BeepSettings = z.infer<typeof beepSettingsSchema>

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const SETTINGS_FILE = 'beep-settings.json'

/** Load persisted beep settings. Returns `null` when no file exists. */
export const loadBeepSettings = async (dataDir: string): Promise<BeepSettings | null> => {
  const filePath = join(resolve(dataDir), SETTINGS_FILE)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    return beepSettingsSchema.parse(parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    console.error(`Failed to load beep settings (${filePath}):`, error)
    // Rename corrupt file so it doesn't block future starts.
    await rename(filePath, `${filePath}.corrupt`).catch((err) =>
      console.warn(`Failed to rename corrupt beep settings:`, err),
    )
    return null
  }
}

/** Persist beep settings to disk. Atomic write via .tmp + rename(). */
export const saveBeepSettings = async (dataDir: string, settings: BeepSettings): Promise<void> => {
  const dir = resolve(dataDir)
  const filePath = join(dir, SETTINGS_FILE)
  const tmpPath = `${filePath}.tmp`
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    console.error(`Failed to create beep settings directory (${dir}):`, error)
    return
  }
  try {
    await writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf-8')
    await rename(tmpPath, filePath)
  } catch (error) {
    console.error(`Failed to save beep settings (${filePath}):`, error)
    await unlink(tmpPath).catch(() => undefined)
  }
}
