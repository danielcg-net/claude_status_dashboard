import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecFileAsync = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:util', () => ({
  promisify: vi.fn(() => mockExecFileAsync),
}))

import { fetchUsageSummary } from '../src/usage.js'

beforeEach(() => {
  mockExecFileAsync.mockReset()
})

const makeDailyJson = (overrides: Record<string, unknown> = {}) => ({
  daily: [
    {
      date: '2026-06-01',
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 200,
      cacheReadTokens: 300,
      totalTokens: 2000,
      totalCost: 0.05,
      modelsUsed: ['claude-sonnet-4-5-20250929'],
      ...overrides,
    },
  ],
  totals: {
    inputTokens: 10000,
    outputTokens: 5000,
    cacheCreationTokens: 2000,
    cacheReadTokens: 3000,
    totalTokens: 20000,
    totalCost: 0.5,
  },
})

const makeInstancesJson = () => ({
  projects: {
    '-Users-test-Private-Projects-my-app': [
      {
        date: '2026-06-01',
        inputTokens: 800,
        outputTokens: 400,
        cacheCreationTokens: 100,
        cacheReadTokens: 200,
        totalTokens: 1500,
        totalCost: 0.03,
        modelsUsed: ['claude-sonnet-4-5-20250929'],
      },
      {
        date: '2026-06-02',
        inputTokens: 200,
        outputTokens: 100,
        cacheCreationTokens: 50,
        cacheReadTokens: 100,
        totalTokens: 450,
        totalCost: 0.01,
        modelsUsed: ['claude-sonnet-4-5-20250929'],
      },
    ],
    '-Users-test-Private-Projects-other': [
      {
        date: '2026-06-01',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 150,
        totalCost: 0.005,
        modelsUsed: ['claude-sonnet-4-5-20250929'],
      },
    ],
  },
})

const makeBlocksJson = () => ({
  blocks: [
    {
      id: 'block-1',
      startTime: '2026-06-01T10:00:00Z',
      endTime: '2026-06-01T10:30:00Z',
      actualEndTime: '2026-06-01T10:30:00Z',
      isActive: false,
      totalTokens: 500,
      costUSD: 0.02,
      modelsUsed: ['claude-sonnet-4-5-20250929'],
    },
    {
      id: 'block-2',
      startTime: '2026-06-01T11:00:00Z',
      endTime: '2026-06-01T11:15:00Z',
      actualEndTime: null,
      isActive: true,
      totalTokens: 200,
      costUSD: 0.01,
      modelsUsed: ['claude-sonnet-4-5-20250929'],
    },
  ],
})

describe('fetchUsageSummary', () => {
  it('returns available summary with projects and active block', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeDailyJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeInstancesJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeBlocksJson()) })

    const result = await fetchUsageSummary()

    expect(result.available).toBe(true)
    expect(result.error).toBeNull()
    expect(result.totals.totalCost).toBe(0.5)
    expect(result.totals.totalTokens).toBe(20000)
    expect(result.today).not.toBeNull()
    expect(result.today?.date).toBe('2026-06-01')
    expect(Object.keys(result.projects)).toHaveLength(2)

    const myApp = result.projects['-Users-test-Private-Projects-my-app']
    expect(myApp?.totals.totalCost).toBe(0.04)
    expect(myApp?.totals.totalTokens).toBe(1950)
    expect(myApp?.days).toHaveLength(2)

    expect(result.activeBlock).not.toBeNull()
    expect(result.activeBlock?.isActive).toBe(true)
    expect(result.activeBlock?.totalCost).toBe(0.01)
  })

  it('handles ccusage failure gracefully', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('ccusage not found'))
    const result = await fetchUsageSummary()
    expect(result.available).toBe(false)
    expect(result.error).toContain('ccusage not found')
    expect(result.totals.totalCost).toBe(0)
    expect(result.projects).toEqual({})
    expect(result.activeBlock).toBeNull()
    expect(result.today).toBeNull()
  })

  it('handles empty projects gracefully', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeDailyJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ projects: {} }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ blocks: [] }) })
    const result = await fetchUsageSummary()
    expect(result.available).toBe(true)
    expect(Object.keys(result.projects)).toHaveLength(0)
    expect(result.activeBlock).toBeNull()
  })

  it('handles missing daily data gracefully', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify({}) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeInstancesJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeBlocksJson()) })
    const result = await fetchUsageSummary()
    expect(result.available).toBe(true)
    expect(result.today).toBeNull()
    expect(result.totals.totalCost).toBe(0)
  })

  it('handles malformed JSON from ccusage', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'not json' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeInstancesJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeBlocksJson()) })
    const result = await fetchUsageSummary()
    expect(result.available).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('handles tokenCounts nested structure', async () => {
    const dailyWithTokenCounts = {
      daily: [{
        date: '2026-06-01',
        tokenCounts: { inputTokens: 500, outputTokens: 250, cacheCreationTokens: 100, cacheReadTokens: 150 },
        totalTokens: 1000,
        totalCost: 0.025,
        modelsUsed: ['claude-sonnet-4-5-20250929'],
      }],
      totals: {
        tokenCounts: { inputTokens: 5000, outputTokens: 2500, cacheCreationTokens: 1000, cacheReadTokens: 1500 },
        totalTokens: 10000,
        totalCost: 0.25,
      },
    }
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(dailyWithTokenCounts) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeInstancesJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeBlocksJson()) })
    const result = await fetchUsageSummary()
    expect(result.available).toBe(true)
    expect(result.totals.inputTokens).toBe(5000)
    expect(result.today?.inputTokens).toBe(500)
  })

  it('handles cacheCreationInputTokens fallback', async () => {
    const json = {
      daily: [{
        date: '2026-06-01',
        inputTokens: 100, outputTokens: 50,
        cacheCreationInputTokens: 30, cacheReadInputTokens: 20,
        totalTokens: 200, totalCost: 0.01,
        modelsUsed: ['claude-sonnet-4-5-20250929'],
      }],
    }
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(json) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ projects: {} }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ blocks: [] }) })
    const result = await fetchUsageSummary()
    expect(result.today?.cacheCreationTokens).toBe(30)
    expect(result.today?.cacheReadTokens).toBe(20)
  })

  it('handles costUSD fallback', async () => {
    const json = {
      daily: [{
        date: '2026-06-01',
        inputTokens: 100, outputTokens: 50,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        totalTokens: 150, costUSD: 0.008,
        modelsUsed: ['claude-sonnet-4-5-20250929'],
      }],
    }
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(json) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ projects: {} }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ blocks: [] }) })
    const result = await fetchUsageSummary()
    expect(result.today?.totalCost).toBe(0.008)
  })

  it('handles blocks with costUSD field', async () => {
    const blocksJson = {
      blocks: [{
        id: 'block-1', startTime: '2026-06-01T10:00:00Z', endTime: '2026-06-01T10:30:00Z',
        actualEndTime: null, isActive: true, totalTokens: 300, costUSD: 0.015,
        modelsUsed: ['claude-sonnet-4-5-20250929'],
      }],
    }
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeDailyJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ projects: {} }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(blocksJson) })
    const result = await fetchUsageSummary()
    expect(result.activeBlock?.totalCost).toBe(0.015)
  })

  it('handles blocks with totalCost field', async () => {
    const blocksJson = {
      blocks: [{
        id: 'block-1', startTime: '2026-06-01T10:00:00Z', endTime: '2026-06-01T10:30:00Z',
        actualEndTime: null, isActive: true, totalTokens: 300, totalCost: 0.015,
        modelsUsed: ['claude-sonnet-4-5-20250929'],
      }],
    }
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeDailyJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ projects: {} }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(blocksJson) })
    const result = await fetchUsageSummary()
    expect(result.activeBlock?.totalCost).toBe(0.015)
  })
})
