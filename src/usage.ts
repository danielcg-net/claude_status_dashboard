import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

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

type UsageDay = UsageTotals & {
  readonly date: string
  readonly modelsUsed: readonly string[]
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

export type UsageSummary = {
  readonly available: boolean
  readonly generatedAt: string
  readonly totals: UsageTotals
  readonly today: UsageDay | null
  readonly activeBlock: UsageBlock | null
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

const ccusageBin = fileURLToPath(new URL('../node_modules/.bin/ccusage', import.meta.url))

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

const dayFrom = (value: unknown): UsageDay | null => {
  if (!isRecord(value)) {
    return null
  }

  return {
    ...totalsFrom(value),
    date: asString(value.date),
    modelsUsed: asStringArray(value.modelsUsed ?? value.models),
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

const parseJson = (stdout: string): unknown => JSON.parse(stdout) as unknown

const runCcusage = async (args: readonly string[]): Promise<unknown> => {
  const { stdout } = await execFileAsync(ccusageBin, [...args], {
    timeout: 15_000,
    env: {
      ...process.env,
      LOG_LEVEL: process.env.LOG_LEVEL ?? '1',
    },
  })

  return parseJson(stdout)
}

const runCcusageWithFallback = async (command: string): Promise<unknown> => {
  try {
    return await runCcusage(['claude', command, '--json'])
  } catch {
    return runCcusage([command, '--json'])
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

const activeBlockFrom = (json: unknown): UsageBlock | null => {
  const records = isRecord(json) ? asArray(json.blocks ?? json.data) : asArray(json)
  const blocks = records.map(blockFrom).filter((block): block is UsageBlock => block !== null)

  return blocks.find((block) => block.isActive) ?? null
}

export const fetchUsageSummary = async (): Promise<UsageSummary> => {
  const generatedAt = new Date().toISOString()

  try {
    const [dailyJson, blocksJson] = await Promise.all([
      runCcusageWithFallback('daily'),
      runCcusageWithFallback('blocks'),
    ])
    const today = latestDayFrom(dailyJson)

    return {
      available: true,
      generatedAt,
      totals: totalsFromDailyJson(dailyJson, today),
      today,
      activeBlock: activeBlockFrom(blocksJson),
      error: null,
    }
  } catch (error) {
    return {
      available: false,
      generatedAt,
      totals: emptyTotals,
      today: null,
      activeBlock: null,
      error: error instanceof Error ? error.message : 'Unable to read ccusage data.',
    }
  }
}
