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
      modelBreakdowns: [
        { modelName: 'claude-sonnet-4-5-20250929', cost: 0.05, inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 200, cacheReadTokens: 300 },
      ],
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
        modelBreakdowns: [
          { modelName: 'claude-sonnet-4-5-20250929', cost: 0.03, inputTokens: 800, outputTokens: 400, cacheCreationTokens: 100, cacheReadTokens: 200 },
        ],
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
        modelBreakdowns: [
          { modelName: 'claude-sonnet-4-5-20250929', cost: 0.01, inputTokens: 200, outputTokens: 100, cacheCreationTokens: 50, cacheReadTokens: 100 },
        ],
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
        modelBreakdowns: [
          { modelName: 'claude-sonnet-4-5-20250929', cost: 0.005, inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
        ],
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

const makeSessionsJson = () => ({
  sessions: [
    {
      sessionId: 'session-aaa',
      projectPath: '-Users-test-Private-Projects-my-app',
      firstActivity: '2026-06-01T10:05:00Z',
      lastActivity: '2026-06-01T10:25:00Z',
      inputTokens: 400,
      outputTokens: 200,
      cacheCreationTokens: 50,
      cacheReadTokens: 100,
      totalTokens: 750,
      totalCost: 0.015,
      modelsUsed: ['claude-sonnet-4-5-20250929'],
      modelBreakdowns: [
        { modelName: 'claude-sonnet-4-5-20250929', cost: 0.015, inputTokens: 400, outputTokens: 200, cacheCreationTokens: 50, cacheReadTokens: 100 },
      ],
    },
    {
      sessionId: 'session-bbb',
      projectPath: '-Users-test-Private-Projects-my-app',
      firstActivity: '2026-06-01T14:00:00Z',
      lastActivity: '2026-06-01T14:30:00Z',
      inputTokens: 200,
      outputTokens: 100,
      cacheCreationTokens: 25,
      cacheReadTokens: 50,
      totalTokens: 375,
      totalCost: 0.008,
      modelsUsed: ['claude-sonnet-4-5-20250929'],
      modelBreakdowns: [
        { modelName: 'claude-sonnet-4-5-20250929', cost: 0.008, inputTokens: 200, outputTokens: 100, cacheCreationTokens: 25, cacheReadTokens: 50 },
      ],
    },
  ],
})

describe('fetchUsageSummary', () => {
  it('returns available summary with projects, blocks, and sessions', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeDailyJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeInstancesJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeBlocksJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeSessionsJson()) })

    const result = await fetchUsageSummary()

    expect(result.available).toBe(true)
    expect(result.error).toBeNull()
    expect(result.totals.totalCost).toBe(0.5)
    expect(result.totals.totalTokens).toBe(20000)
    expect(result.today).not.toBeNull()
    expect(result.today?.date).toBe('2026-06-01')
    expect(result.today?.modelBreakdowns).toHaveLength(1)
    expect(result.today?.modelBreakdowns[0]?.modelName).toBe('claude-sonnet-4-5-20250929')
    expect(result.today?.modelBreakdowns[0]?.cost).toBe(0.05)
    expect(Object.keys(result.projects)).toHaveLength(2)

    const myApp = result.projects['-Users-test-Private-Projects-my-app']
    expect(myApp?.totals.totalCost).toBe(0.04)
    expect(myApp?.totals.totalTokens).toBe(1950)
    expect(myApp?.days).toHaveLength(2)

    expect(result.activeBlock).not.toBeNull()
    expect(result.activeBlock?.isActive).toBe(true)
    expect(result.activeBlock?.totalCost).toBe(0.01)
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]?.id).toBe('block-1')
    expect(result.blocks[0]?.isActive).toBe(false)
    expect(result.blocks[1]?.id).toBe('block-2')
    expect(result.blocks[1]?.isActive).toBe(true)

    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0]?.sessionId).toBe('session-aaa')
    expect(result.sessions[0]?.totalCost).toBe(0.015)
    expect(result.sessions[0]?.projectPath).toBe('-Users-test-Private-Projects-my-app')
    expect(result.sessions[0]?.firstActivity).toBe('2026-06-01T10:05:00Z')
    expect(result.sessions[1]?.sessionId).toBe('session-bbb')
    expect(result.sessions[1]?.totalCost).toBe(0.008)
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
    expect(result.sessions).toEqual([])
  })

  it('handles empty projects gracefully', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeDailyJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ projects: {} }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ blocks: [] }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ sessions: [] }) })
    const result = await fetchUsageSummary()
    expect(result.available).toBe(true)
    expect(Object.keys(result.projects)).toHaveLength(0)
    expect(result.activeBlock).toBeNull()
    expect(result.sessions).toHaveLength(0)
  })

  it('handles missing daily data gracefully', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify({}) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeInstancesJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeBlocksJson()) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeSessionsJson()) })
    const result = await fetchUsageSummary()
    expect(result.available).toBe(true)
    expect(result.today).toBeNull()
    expect(result.totals.totalCost).toBe(0)
  })

  it('handles malformed JSON from ccusage', async () => {
    // Reject the first execFileAsync call so Promise.all fails before
    // the fallback retry can consume extra mock slots.
    mockExecFileAsync.mockRejectedValueOnce(new Error('ccusage crashed'))
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
      .mockResolvedValueOnce({ stdout: JSON.stringify(makeSessionsJson()) })
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
      .mockResolvedValueOnce({ stdout: JSON.stringify({ sessions: [] }) })
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
      .mockResolvedValueOnce({ stdout: JSON.stringify({ sessions: [] }) })
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
      .mockResolvedValueOnce({ stdout: JSON.stringify({ sessions: [] }) })
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
      .mockResolvedValueOnce({ stdout: JSON.stringify({ sessions: [] }) })
    const result = await fetchUsageSummary()
    expect(result.activeBlock?.totalCost).toBe(0.015)
  })

  it('handles modelBreakdowns with zero cost correctly', async () => {
    const dailyWithZeroCost = {
      daily: [{
        date: '2026-06-01',
        inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
        totalTokens: 0, totalCost: 0, modelsUsed: [],
        modelBreakdowns: [
          { modelName: 'free-model', cost: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: 0.05 },
        ],
      }],
    }
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(dailyWithZeroCost) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ projects: {} }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ blocks: [] }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ sessions: [] }) })
    const result = await fetchUsageSummary()
    expect(result.today?.modelBreakdowns).toHaveLength(1)
    expect(result.today?.modelBreakdowns[0]?.cost).toBe(0)
    expect(result.today?.modelBreakdowns[0]?.modelName).toBe('free-model')
  })
})
