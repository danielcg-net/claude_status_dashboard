import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * The user's actual home directory. Prefers `$HOME` (set by Docker / sudo)
 * over `os.homedir()` which returns `/root` when running as root.
 */
const userHome = (): string => process.env.HOME ?? homedir()

/**
 * Install directory for the hook script.
 * Matches install.sh: CLAUDE_DASHBOARD_DIR defaults to $HOME/.claude-status-dashboard.
 */
const hooksInstallDir = (): string => {
  const base = process.env.CLAUDE_DASHBOARD_DIR ?? join(userHome(), '.claude-status-dashboard')
  return join(base, 'hooks')
}

const HOOK_SCRIPT_NAME = 'claude-status-dashboard.sh'

/**
 * Prefix used to detect dashboard hooks in settings.json commands.
 * Matches both the manual script (claude-status-dashboard.sh) and the
 * plugin script (claude-status-dashboard-hook.sh).
 */
const HOOK_SCRIPT_MATCHER = 'claude-status-dashboard'

/**
 * The 10 Claude Code lifecycle events the dashboard hooks into.
 * Must match the events listed in hooks/settings.global.example.json.
 */
export const hookEvents = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'PermissionRequest',
  'Elicitation',
  'Stop',
  'StopFailure',
  'SubagentStop',
] as const

/**
 * Base URL for downloading the hook script from a GitHub release.
 * Override HOOKS_REPO to use a fork: e.g. "my-org/my-fork".
 */
const HOOKS_REPO = process.env.HOOKS_REPO ?? 'danielcg-net/claude_status_dashboard'
const RAW_URL = `https://raw.githubusercontent.com/${HOOKS_REPO}`

/**
 * Claude config directory. Respects CLAUDE_CONFIG_DIR (used in Docker
 * compose.yml) and CLAUDE_HOME. Falls back to ~/.claude.
 */
const claudeHomeDir = (): string => {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR
  if (process.env.CLAUDE_HOME) return process.env.CLAUDE_HOME
  return join(userHome(), '.claude')
}

/**
 * Replace the user's home directory prefix with ~ for display.
 */
const prettyPath = (p: string): string => {
  const home = userHome()
  if (p.startsWith(home)) return p.replace(home, '~')
  return p
}

/** Path to the project's .claude directory (for project-level hooks). */
const projectClaudeDir = (): string => {
  if (process.env.CLAUDE_PROJECT_CONFIG_DIR) return process.env.CLAUDE_PROJECT_CONFIG_DIR
  return join(resolve('.'), '.claude')
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const configLocationValues = ['global', 'project', 'both', 'none'] as const

export const hookSettingsSchema = z.object({
  installed: z.boolean(),
  configLocation: z.enum(configLocationValues),
  scriptExists: z.boolean(),
  scriptPath: z.string(),
  scriptVersion: z.string().nullable(),
  events: z.array(z.string()),
  error: z.string().nullable(),
})

export type HookSettings = z.infer<typeof hookSettingsSchema>

/** Schema for the PUT /api/settings/hooks request body. */
export const hookActionSchema = z.object({
  action: z.enum(['install', 'delete']),
  scope: z.enum(['global', 'project']).default('global'),
})

export type HookAction = z.infer<typeof hookActionSchema>

// ---------------------------------------------------------------------------
// Hook script download
// ---------------------------------------------------------------------------

/**
 * Downloads the hook script from a GitHub release tag (or main branch as
 * fallback). Writes it to the standard install directory. Returns the
 * absolute path to the installed script.
 */
export const downloadHookScript = async (version: string): Promise<string> => {
  // Only allow safe characters to prevent path traversal in GitHub raw URLs.
  // Allows alphanumeric, dots, underscores, hyphens, and forward slashes
  // (for branch names like feat/hooks-setup-panel). Rejects ".." segments.
  if (!/^[a-zA-Z0-9._/-]+$/.test(version) || version.includes('..')) {
    throw new Error(`Invalid version string: ${JSON.stringify(version)}`)
  }

  const dir = hooksInstallDir()
  const scriptPath = join(dir, HOOK_SCRIPT_NAME)

  // `version` is a raw git ref (e.g. 'main', 'v0.5.1', 'feature-branch').
  // Try it directly first; fall back to main.
  const urls = [
    `${RAW_URL}/${version}/hooks/${HOOK_SCRIPT_NAME}`,
    `${RAW_URL}/main/hooks/${HOOK_SCRIPT_NAME}`,
  ]

  let lastError: Error | undefined

  for (const url of urls) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) {
      lastError = new Error(`HTTP ${response.status} from ${url}`)
      continue
    }

    const content = await response.text()
    if (!content.trim()) {
      lastError = new Error(`Empty response from ${url}`)
      continue
    }

    await mkdir(dir, { recursive: true })
    await writeFile(scriptPath, content, 'utf-8')
    await chmod(scriptPath, 0o755)
    return scriptPath
  }

  throw new Error(`Failed to download hook script. Last error: ${lastError?.message}`)
}

// ---------------------------------------------------------------------------
// settings.json helpers
// ---------------------------------------------------------------------------

/** Returns the path to a scope's .claude/settings.json. */
const settingsPath = (scope: 'global' | 'project'): string =>
  join(scope === 'global' ? claudeHomeDir() : projectClaudeDir(), 'settings.json')

/**
 * Reads and parses a settings.json file. Returns `null` when the file does not
 * exist or cannot be parsed.
 */
const readSettingsJson = async (filePath: string): Promise<Record<string, unknown> | null> => {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Atomic write of a settings object to disk: write to .tmp, then rename.
 * Creates parent directories as needed.
 */
const writeSettingsJson = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  const tmpPath = `${filePath}.tmp`
  await mkdir(join(filePath, '..'), { recursive: true }).catch(() => undefined)
  try {
    await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    await rename(tmpPath, filePath)
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Build hook entry for settings.json
// ---------------------------------------------------------------------------

/** Build a single event's hook configuration entry. */
const buildHookEntry = (scriptPath: string) => [
  {
    matcher: '.*',
    hooks: [
      {
        type: 'command',
        command: `bash ${scriptPath}`,
        timeout: 5,
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Status detection
// ---------------------------------------------------------------------------

/**
 * Checks whether a settings.json file contains the dashboard hooks.
 * Looks for any hook event whose command references the dashboard script
 * (claude-status-dashboard.sh), regardless of how many events are configured.
 */
const checkClaudeSettingsForHooks = async (
  filePath: string,
  logLabel?: string,
): Promise<boolean> => {
  const label = logLabel ?? filePath
  const settings = await readSettingsJson(filePath)
  if (!settings) {
    console.warn(`checkHooks(${label}): file missing or unreadable`)
    return false
  }

  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    console.warn(`checkHooks(${label}): no hooks object found (type=${typeof hooks}, isArray=${Array.isArray(hooks)})`)
    return false
  }

  const hooksObj = hooks as Record<string, unknown>
  const eventNames = Object.keys(hooksObj)
  if (eventNames.length === 0) {
    console.warn(`checkHooks(${label}): hooks object is empty`)
    return false
  }

  // Walk every event and every matcher/hook entry looking for a command
  // that references our script. This catches partial installs (e.g. only
  // SessionStart + Stop) as well as full 10-event installs.
  const commandsSeen: string[] = []
  for (const event of eventNames) {
    const matchers = hooksObj[event]
    if (!Array.isArray(matchers)) continue
    for (const matcher of matchers) {
      if (typeof matcher !== 'object' || matcher === null) continue
      const entry = matcher as Record<string, unknown>
      const hookList = entry.hooks
      if (!Array.isArray(hookList)) continue
      for (const hook of hookList) {
        if (typeof hook !== 'object' || hook === null) continue
        const h = hook as Record<string, unknown>
        if (typeof h.command === 'string') {
          commandsSeen.push(h.command)
          if (h.command.includes(HOOK_SCRIPT_MATCHER)) {
            return true
          }
        }
      }
    }
  }

  console.warn(
    `checkHooks(${label}): ${eventNames.length} event(s) with ${commandsSeen.length} command(s), ` +
    `none matching "${HOOK_SCRIPT_MATCHER}". Commands: ${JSON.stringify(commandsSeen.slice(0, 5))}`,
  )
  return false
}

/**
 * Reads a settings.json file and returns the list of hook event names that
 * reference the dashboard script. Returns an empty array if the file doesn't
 * exist or has no matching hooks.
 */
const readHookEventNames = async (filePath: string): Promise<string[]> => {
  const settings = await readSettingsJson(filePath)
  if (!settings?.hooks || typeof settings.hooks !== 'object') return []

  const hooksObj = settings.hooks as Record<string, unknown>
  const found: string[] = []
  for (const [event, matchers] of Object.entries(hooksObj)) {
    if (!Array.isArray(matchers)) continue
    for (const matcher of matchers) {
      if (typeof matcher !== 'object' || matcher === null) continue
      const entry = matcher as Record<string, unknown>
      const hookList = entry.hooks
      if (!Array.isArray(hookList)) continue
      for (const hook of hookList) {
        if (typeof hook !== 'object' || hook === null) continue
        const h = hook as Record<string, unknown>
        if (typeof h.command === 'string' && h.command.includes(HOOK_SCRIPT_MATCHER)) {
          found.push(event)
        }
      }
    }
  }

  // Sort to put known lifecycle events first, then any custom ones
  const knownOrder = hookEvents as readonly string[]
  found.sort((a, b) => {
    const ai = knownOrder.indexOf(a)
    const bi = knownOrder.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return found
}

/** Merge and deduplicate two event lists, preserving the order of `a`. */
const mergeEventLists = (a: string[], b: string[]): string[] => {
  const seen = new Set(a)
  for (const item of b) {
    if (!seen.has(item)) {
      a.push(item)
      seen.add(item)
    }
  }
  return a
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inspects the filesystem and returns the current hook installation status.
 *
 * Checks:
 * 1. Whether the hook script exists at the install location
 * 2. Whether a global ~/.claude/settings.json has the dashboard hooks
 * 3. Whether a project .claude/settings.json has the dashboard hooks
 *
 * When hooks exist in both locations (configLocation = 'both'), events from
 * both sources are merged so the user sees the full picture.
 */
export const detectHookStatus = async (version: string): Promise<HookSettings> => {
  const realScriptPath = join(hooksInstallDir(), HOOK_SCRIPT_NAME)
  const base: HookSettings = {
    installed: false,
    configLocation: 'none',
    scriptExists: false,
    scriptPath: prettyPath(realScriptPath),
    scriptVersion: null,
    events: [],
    error: null,
  }

  try {
    // Check if the hook script exists on disk (use real path, not ~/...)
    try {
      await access(realScriptPath, 0 /* F_OK */)
      base.scriptExists = true
    } catch {
      base.scriptExists = false
    }

    // Check global settings
    const globalPath = settingsPath('global')
    const globalHasHooks = await checkClaudeSettingsForHooks(globalPath, 'global')

    // Check project settings
    const projectPath = settingsPath('project')
    const projectHasHooks = await checkClaudeSettingsForHooks(projectPath, 'project')

    if (globalHasHooks && projectHasHooks) {
      base.configLocation = 'both'
      base.installed = true
    } else if (globalHasHooks) {
      base.configLocation = 'global'
      base.installed = true
    } else if (projectHasHooks) {
      base.configLocation = 'project'
      base.installed = true
    } else {
      console.warn(
        'detectHookStatus: hooks not found in any settings. ' +
        `global=${prettyPath(globalPath)} (found=${globalHasHooks}), ` +
        `project=${prettyPath(projectPath)} (found=${projectHasHooks}), ` +
        `script=${prettyPath(realScriptPath)} (exists=${base.scriptExists})`,
      )
    }

    // Populate events list — merge from both locations when hooks exist in both.
    // Wrapped in its own try/catch: an error reading events should not flip
    // `installed` back to false — we already confirmed hooks exist above.
    try {
      if (base.configLocation === 'both') {
        const globalEvents = await readHookEventNames(globalPath)
        const projectEvents = await readHookEventNames(projectPath)
        base.events = mergeEventLists(globalEvents, projectEvents)
      } else if (base.configLocation === 'global') {
        base.events = await readHookEventNames(globalPath)
      } else if (base.configLocation === 'project') {
        base.events = await readHookEventNames(projectPath)
      }
    } catch (eventError) {
      const message = eventError instanceof Error ? eventError.message : String(eventError)
      console.error('detectHookStatus: error reading hook events:', message)
      base.error = message
      // Keep `installed` and `configLocation` as determined above.
    }

    base.scriptVersion = base.installed ? version : null

    return base
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('detectHookStatus: error during detection:', message)
    base.error = message
    return base
  }
}

/**
 * Downloads the hook script and installs (or updates) the dashboard hook
 * entries into the chosen scope's settings.json.
 *
 * Preserves any non-hook settings and any non-dashboard hooks already present.
 */
export const installHooks = async (
  scope: 'global' | 'project',
  version: string,
): Promise<void> => {
  // 1. Download the hook script from the GitHub release
  const scriptPath = await downloadHookScript(version)

  // 2. Build the hook entries for all events
  const hookEntry = buildHookEntry(scriptPath)
  const newHooks: Record<string, unknown> = {}
  for (const event of hookEvents) {
    newHooks[event] = hookEntry
  }

  // 3. Read existing settings (or start fresh)
  const targetPath = settingsPath(scope)
  const existing = (await readSettingsJson(targetPath)) ?? {}

  // 4. Merge: for each lifecycle event, add the dashboard matcher alongside
  //    any existing matchers. This preserves non-dashboard hooks (e.g. Claude
  //    Code's own cleanup hooks) that happen to use the same event names.
  const existingHooks =
    existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
      ? (existing.hooks as Record<string, unknown>)
      : {}

  for (const event of hookEvents) {
    const existingMatchers: unknown[] = Array.isArray(existingHooks[event])
      ? [...(existingHooks[event] as unknown[])]
      : []

    // Remove any previous dashboard matchers from this event to avoid
    // duplicates on re-install (identified by command referencing our script).
    const withoutDashboard = existingMatchers.filter((matcher) => {
      if (typeof matcher !== 'object' || matcher === null) return true
      const entry = matcher as Record<string, unknown>
      const hookList = entry.hooks
      if (!Array.isArray(hookList)) return true
      return !hookList.some((hook) => {
        if (typeof hook !== 'object' || hook === null) return false
        const h = hook as Record<string, unknown>
        return typeof h.command === 'string' && (h.command as string).includes(HOOK_SCRIPT_MATCHER)
      })
    })

    // Add the fresh dashboard matcher alongside any existing ones
    existingHooks[event] = [...withoutDashboard, ...(newHooks[event] as unknown[])]
  }

  const mergedHooks = { ...existingHooks }
  const merged = { ...existing, hooks: mergedHooks }

  // 5. Write atomically
  await writeSettingsJson(targetPath, merged)
}

/**
 * Removes the dashboard hook entries from the chosen scope's settings.json.
 * Scans ALL hook events (not just the 10 predefined lifecycle events) and
 * removes any whose command references the dashboard script. This catches
 * custom event names that users may have added manually.
 * Leaves other hook entries and non-hook settings intact.
 * If the hooks map becomes empty after removal, the `hooks` key is removed.
 * If the file doesn't exist, this is a no-op.
 */
export const deleteHooks = async (scope: 'global' | 'project'): Promise<void> => {
  const targetPath = settingsPath(scope)
  const existing = await readSettingsJson(targetPath)

  if (!existing) return // nothing to delete

  const existingHooks =
    existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
      ? (existing.hooks as Record<string, unknown>)
      : {}

  // Remove any hook entry whose command references the dashboard script,
  // regardless of the event name it's registered under.
  for (const [event, matchers] of Object.entries(existingHooks)) {
    if (!Array.isArray(matchers)) continue
    // For each matcher, strip dashboard hooks and keep it only if non-dashboard
    // hooks remain. When a matcher has mixed hooks (dashboard + user hooks),
    // the matcher is kept but its hooks array is updated to exclude the
    // dashboard entries.
    const filtered = matchers.reduce<unknown[]>((kept, matcher) => {
      if (typeof matcher !== 'object' || matcher === null) {
        kept.push(matcher)
        return kept
      }
      const entry = matcher as Record<string, unknown>
      const hookList = entry.hooks
      if (!Array.isArray(hookList)) {
        kept.push(matcher) // keep unknown structures
        return kept
      }
      // Strip dashboard hooks from the hooks array
      const nonDashboard = hookList.filter((hook) => {
        if (typeof hook !== 'object' || hook === null) return true // keep unknown hooks
        const h = hook as Record<string, unknown>
        if (typeof h.command !== 'string') return true // keep non-command hooks
        return !(h.command as string).includes(HOOK_SCRIPT_MATCHER)
      })
      if (nonDashboard.length === 0) return kept // all hooks were dashboard — skip matcher
      // Replace hooks with only the non-dashboard entries
      kept.push({ ...entry, hooks: nonDashboard })
      return kept
    }, [])
    if (filtered.length === 0) {
      delete existingHooks[event]
    } else {
      existingHooks[event] = filtered
    }
  }

  const remainingKeys = Object.keys(existingHooks)
  const merged = { ...existing }

  if (remainingKeys.length === 0) {
    delete merged.hooks
  } else {
    merged.hooks = existingHooks
  }

  await writeSettingsJson(targetPath, merged)
}
