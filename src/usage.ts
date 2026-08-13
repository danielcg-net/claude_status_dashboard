import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type JsonRecord = Record<string, unknown>

type UsageTotals = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationTokens: number
  readonly cacheReadTokens: number
  readonly totalTokens: number
  readonly totalCost: number
}

type ModelBreakdown = {
  readonly modelName: string
  readonly cost: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationTokens: number
  readonly cacheReadTokens: number
}

type UsageDay = UsageTotals & {
  readonly date: string
  readonly modelsUsed: readonly string[]
  readonly modelBreakdowns: readonly ModelBreakdown[]
}

type UsageProject = {
  readonly project: string
  readonly totals: UsageTotals
  readonly today: UsageDay | null
  readonly days: readonly UsageDay[]
}

type UsageBlock = {
  readonly id: string
  readonly startTime: string
  readonly endTime: string
  readonly actualEndTime: string | null
  readonly isActive: boolean
  readonly totalTokens: number
  readonly totalCost: number
  readonly modelsUsed: readonly string[]
}

type UsageSession = UsageTotals & {
  readonly sessionId: string
  readonly projectPath: string
  readonly firstActivity: string
  readonly lastActivity: string
  readonly modelsUsed: readonly string[]
  readonly modelBreakdowns: readonly ModelBreakdown[]
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

const emptyTotals: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  totalCost: 0,
}

/** Maximum stdout we accept from a single ccusage invocation. The Node default
 *  (1 MB) is easily exceeded by `daily --instances` on machines with a large
 *  `~/.claude/projects` history, which used to surface as "not available".
 *  Node grows this buffer as output arrives rather than preallocating it, but
 *  four concurrent invocations still bound worst-case memory — hence 32 MB
 *  rather than something arbitrarily large. */
const ccusageMaxBuffer = 32 * 1024 * 1024

/** Wall-clock budget for a single ccusage invocation. */
const ccusageTimeoutMs = 15_000

type CcusageScript =
  | { readonly ok: true; readonly scriptPath: string }
  | { readonly ok: false; readonly error: string }

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Derives the absolute path of ccusage's CLI entry point from its own
 *  `package.json` location and `bin` field. Exported for testing. */
export const ccusageScriptPathFrom = (packageJsonPath: string, binField: unknown): string | null => {
  const relativePath =
    typeof binField === 'string'
      ? binField
      : typeof binField === 'object' && binField !== null && 'ccusage' in binField
        ? (binField as Record<string, unknown>).ccusage
        : null

  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return null
  }

  return resolve(dirname(packageJsonPath), relativePath)
}

/** Locates the ccusage CLI through Node's module resolver rather than a
 *  hardcoded `../node_modules/.bin` path. npm hoists `ccusage` to the shared
 *  root under `npx`/`npm install -g`, so this package may have no nested
 *  `node_modules` at all — the resolver handles hoisted, nested, and pnpm
 *  layouts alike. Resolution failures are captured instead of thrown so an
 *  unusable install degrades to an actionable API error, not a boot crash. */
const resolveCcusageScript = (): CcusageScript => {
  try {
    const packageJsonPath = createRequire(import.meta.url).resolve('ccusage/package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { readonly bin?: unknown }
    const scriptPath = ccusageScriptPathFrom(packageJsonPath, packageJson.bin)

    if (scriptPath === null) {
      return { ok: false, error: `ccusage package at ${packageJsonPath} declares no "bin.ccusage" entry.` }
    }

    // Report a bin entry that points nowhere directly, rather than spawning a
    // child just to read MODULE_NOT_FOUND back out of its stderr.
    return existsSync(scriptPath)
      ? { ok: true, scriptPath }
      : { ok: false, error: `ccusage CLI is missing: ${scriptPath} does not exist.` }
  } catch (error) {
    return { ok: false, error: `Unable to resolve the ccusage package: ${errorMessage(error)}` }
  }
}

const ccusageScript = resolveCcusageScript()

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asStringArray = (value: unknown): readonly string[] => asArray(value).filter((item): item is string => typeof item === 'string')

const tokenCountsFrom = (record: JsonRecord): JsonRecord =>
  isRecord(record.tokenCounts) ? record.tokenCounts : record

const readInputTokens = (record: JsonRecord): number => asNumber(tokenCountsFrom(record).inputTokens)

const readOutputTokens = (record: JsonRecord): number => asNumber(tokenCountsFrom(record).outputTokens)

const readCacheCreationTokens = (record: JsonRecord): number =>
  asNumber(tokenCountsFrom(record).cacheCreationTokens) || asNumber(tokenCountsFrom(record).cacheCreationInputTokens)

const readCacheReadTokens = (record: JsonRecord): number =>
  asNumber(tokenCountsFrom(record).cacheReadTokens) || asNumber(tokenCountsFrom(record).cacheReadInputTokens)

const totalsFrom = (record: JsonRecord): UsageTotals => {
  const inputTokens = readInputTokens(record)
  const outputTokens = readOutputTokens(record)
  const cacheCreationTokens = readCacheCreationTokens(record)
  const cacheReadTokens = readCacheReadTokens(record)
  const totalTokens = asNumber(record.totalTokens) || inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens,
    totalCost: asNumber(record.totalCost) || asNumber(record.costUSD),
  }
}

const breakdownFrom = (value: unknown): ModelBreakdown | null => {
  if (!isRecord(value)) {
    return null
  }

  return {
    modelName: asString(value.modelName),
    cost: asNumber(value.cost ?? value.costUSD),
    inputTokens: readInputTokens(value),
    outputTokens: readOutputTokens(value),
    cacheCreationTokens: readCacheCreationTokens(value),
    cacheReadTokens: readCacheReadTokens(value),
  }
}

const dayFrom = (value: unknown): UsageDay | null => {
  if (!isRecord(value)) {
    return null
  }

  return {
    ...totalsFrom(value),
    date: asString(value.date),
    modelsUsed: asStringArray(value.modelsUsed ?? value.models),
    modelBreakdowns: asArray(value.modelBreakdowns)
      .map(breakdownFrom)
      .filter((b): b is ModelBreakdown => b !== null),
  }
}

const blockFrom = (value: unknown): UsageBlock | null => {
  if (!isRecord(value)) {
    return null
  }

  return {
    id: asString(value.id),
    startTime: asString(value.startTime),
    endTime: asString(value.endTime),
    actualEndTime: asString(value.actualEndTime) || null,
    isActive: value.isActive === true,
    totalTokens: totalsFrom(value).totalTokens,
    totalCost: asNumber(value.costUSD) || asNumber(value.totalCost),
    modelsUsed: asStringArray(value.modelsUsed ?? value.models),
  }
}

const sessionFrom = (value: unknown): UsageSession | null => {
  if (!isRecord(value)) {
    return null
  }

  const totals = totalsFrom(value)

  return {
    ...totals,
    sessionId: asString(value.sessionId),
    projectPath: asString(value.projectPath),
    firstActivity: asString(value.firstActivity),
    lastActivity: asString(value.lastActivity),
    modelsUsed: asStringArray(value.modelsUsed ?? value.models),
    modelBreakdowns: asArray(value.modelBreakdowns)
      .map(breakdownFrom)
      .filter((b): b is ModelBreakdown => b !== null),
  }
}

const allSessionsFrom = (json: unknown): readonly UsageSession[] => {
  const records = isRecord(json) ? asArray(json.sessions ?? json.data) : asArray(json)
  return records.map(sessionFrom).filter((s): s is UsageSession => s !== null)
}

const parseJson = (stdout: string): unknown => JSON.parse(stdout) as unknown

/** Resolves the Claude config directory, same logic as the ccusage native binary:
 *  CLAUDE_CONFIG_DIR → CLAUDE_HOME → $HOME/.claude */
const claudeConfigDir = (): string =>
  process.env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_HOME ?? join(homedir(), '.claude')

/** `execFile` also kills the child when `maxBuffer` is exceeded, so `killed`
 *  alone cannot distinguish that from a timeout. */
const isMaxBufferFailure = (error: unknown): boolean => {
  const code = (error as { readonly code?: unknown }).code
  return (
    code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
    code === 'ENOBUFS' ||
    errorMessage(error).toLowerCase().includes('maxbuffer')
  )
}

/** `execFile` reports a timeout by killing the child, not by putting anything
 *  identifiable in the message — so the caller has to recognize it here. */
const isTimeoutFailure = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { readonly killed?: unknown }).killed === true &&
  !isMaxBufferFailure(error)

/** Runs the ccusage CLI through the current Node binary. Spawning
 *  `process.execPath` with the resolved script avoids relying on the shebang
 *  or the executable bit of the `.bin` shim, which npm does not always
 *  preserve (and which does not exist on Windows). */
const runCcusage = async (args: readonly string[]): Promise<unknown> => {
  if (!ccusageScript.ok) {
    throw new Error(ccusageScript.error)
  }

  const { stdout } = await execFileAsync(process.execPath, [ccusageScript.scriptPath, ...args], {
    timeout: ccusageTimeoutMs,
    maxBuffer: ccusageMaxBuffer,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: claudeConfigDir(),
      LOG_LEVEL: process.env.LOG_LEVEL ?? '1',
    },
  }).catch((error: unknown) => {
    throw isTimeoutFailure(error)
      ? new Error(`ccusage timed out after ${ccusageTimeoutMs}ms: ${errorMessage(error)}`)
      : error
  })

  return parseJson(stdout)
}

const runCcusageWithFallback = async (command: string, args: readonly string[] = []): Promise<unknown> => {
  try {
    return await runCcusage(['claude', command, ...args, '--json'])
  } catch {
    return runCcusage([command, ...args, '--json'])
  }
}

const latestDayFrom = (json: unknown): UsageDay | null => {
  const records = isRecord(json) ? asArray(json.daily ?? json.data) : asArray(json)
  const days = records.map(dayFrom).filter((day): day is UsageDay => day !== null)

  return days.at(-1) ?? null
}

const totalsFromDailyJson = (json: unknown, today: UsageDay | null): UsageTotals => {
  if (isRecord(json) && isRecord(json.totals)) {
    return totalsFrom(json.totals)
  }

  return today ?? emptyTotals
}

const sumTotals = (entries: readonly UsageDay[]): UsageTotals =>
  entries.reduce(
    (totals, entry) => ({
      inputTokens: totals.inputTokens + entry.inputTokens,
      outputTokens: totals.outputTokens + entry.outputTokens,
      cacheCreationTokens: totals.cacheCreationTokens + entry.cacheCreationTokens,
      cacheReadTokens: totals.cacheReadTokens + entry.cacheReadTokens,
      totalTokens: totals.totalTokens + entry.totalTokens,
      totalCost: totals.totalCost + entry.totalCost,
    }),
    emptyTotals,
  )

const projectsFromInstancesJson = (json: unknown): Readonly<Record<string, UsageProject>> => {
  if (!isRecord(json) || !isRecord(json.projects)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(json.projects)
      .map(([project, entries]) => {
        const days = asArray(entries).map(dayFrom).filter((day): day is UsageDay => day !== null)
        const today = days.at(-1) ?? null

        return [
          project,
          {
            project,
            totals: sumTotals(days),
            today,
            days,
          },
        ] as const
      })
      .filter(([, project]) => project.days.length > 0),
  )
}

const allBlocksFrom = (json: unknown): readonly UsageBlock[] => {
  const records = isRecord(json) ? asArray(json.blocks ?? json.data) : asArray(json)
  return records.map(blockFrom).filter((block): block is UsageBlock => block !== null)
}

const activeBlockFrom = (json: unknown): UsageBlock | null => {
  const blocks = allBlocksFrom(json)
  return blocks.find((block) => block.isActive) ?? null
}

export const fetchUsageSummary = async (): Promise<UsageSummary> => {
  const generatedAt = new Date().toISOString()

  try {
    const [dailyJson, instancesJson, blocksJson] = await Promise.all([
      runCcusageWithFallback('daily'),
      runCcusageWithFallback('daily', ['--instances']),
      runCcusageWithFallback('blocks'),
    ])

    // Session-level data is optional — older ccusage versions may not
    // support the `session` subcommand, so we fetch it separately and
    // gracefully degrade to an empty list on failure.
    const sessionsJson: unknown = await (async () => {
      try {
        return await runCcusageWithFallback('session')
      } catch {
        return { sessions: [] }
      }
    })()

    const today = latestDayFrom(dailyJson)

    return {
      available: true,
      generatedAt,
      totals: totalsFromDailyJson(dailyJson, today),
      today,
      projects: projectsFromInstancesJson(instancesJson),
      activeBlock: activeBlockFrom(blocksJson),
      blocks: allBlocksFrom(blocksJson),
      sessions: allSessionsFrom(sessionsJson),
      error: null,
    }
  } catch (error) {
    return {
      available: false,
      generatedAt,
      totals: emptyTotals,
      today: null,
      projects: {},
      activeBlock: null,
      blocks: [],
      sessions: [],
      error: error instanceof Error ? error.message : 'Unable to read ccusage data.',
    }
  }
}
