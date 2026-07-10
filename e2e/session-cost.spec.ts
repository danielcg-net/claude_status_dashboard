import { test, expect } from '@playwright/test'

// ── helpers ───────────────────────────────────────────────────────────────────

const TODAY_UTC = new Date().toISOString().slice(0, 10)
const YESTERDAY_UTC = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

type DayOverrides = { date: string; totalCost?: number; totalTokens?: number; inputTokens?: number; outputTokens?: number }

const makeDay = (overrides: DayOverrides) => ({
  date: overrides.date,
  inputTokens: overrides.inputTokens ?? 100,
  outputTokens: overrides.outputTokens ?? 200,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: overrides.totalTokens ?? 300,
  totalCost: overrides.totalCost ?? 1.5,
  modelsUsed: ['claude-sonnet-4-6'],
  modelBreakdowns: [
    {
      modelName: 'claude-sonnet-4-6',
      cost: overrides.totalCost ?? 1.5,
      inputTokens: overrides.inputTokens ?? 100,
      outputTokens: overrides.outputTokens ?? 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
  ],
})

const makeUsageResponse = (projectKey: string, days: ReturnType<typeof makeDay>[]) => ({
  available: true,
  generatedAt: new Date().toISOString(),
  totals: {
    inputTokens: days.reduce((s, d) => s + d.inputTokens, 0),
    outputTokens: days.reduce((s, d) => s + d.outputTokens, 0),
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: days.reduce((s, d) => s + d.totalTokens, 0),
    totalCost: days.reduce((s, d) => s + d.totalCost, 0),
  },
  today: days.find((d) => d.date === TODAY_UTC) ?? null,
  activeBlock: null,
  blocks: [],
  projects: {
    [projectKey]: {
      project: projectKey,
      totals: {
        inputTokens: days.reduce((s, d) => s + d.inputTokens, 0),
        outputTokens: days.reduce((s, d) => s + d.outputTokens, 0),
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: days.reduce((s, d) => s + d.totalTokens, 0),
        totalCost: days.reduce((s, d) => s + d.totalCost, 0),
      },
      today: days.find((d) => d.date === TODAY_UTC) ?? null,
      days,
    },
  },
})

// ── session card cost display ─────────────────────────────────────────────────

test.describe('session card cost display', () => {
  const PROJECT_KEY = '-Users-e2e-test-my-project'

  test('shows cost and token count when usageProject matches a ccusage project', async ({ page, request }) => {
    const todayData = makeDay({ date: TODAY_UTC, totalCost: 2.34, totalTokens: 50_000 })

    await page.route('/api/usage', (route) =>
      route.fulfill({ json: makeUsageResponse(PROJECT_KEY, [todayData]) }),
    )

    const { session } = await (
      await request.post('/api/sessions', {
        data: { name: 'e2e-cost-test', usageProject: PROJECT_KEY, status: 'green' },
      })
    ).json()

    await page.goto('/')
    const card = page.locator('.session-card').filter({ hasText: 'e2e-cost-test' })
    await expect(card).toBeVisible()

    // Cost should appear — not $0.00
    await expect(card.locator('.session-card__cost')).toBeVisible()
    await expect(card).toContainText('$2.34')

    await request.delete(`/api/sessions/${session.id}`)
  })

  test('shows "No usage data" when usageProject has no matching ccusage entry', async ({ page, request }) => {
    await page.route('/api/usage', (route) =>
      route.fulfill({
        json: { available: true, generatedAt: new Date().toISOString(), totals: {}, today: null, activeBlock: null, blocks: [], projects: {} },
      }),
    )

    const { session } = await (
      await request.post('/api/sessions', {
        data: { name: 'e2e-no-usage', usageProject: '-Users-nonexistent-project', status: 'green' },
      })
    ).json()

    await page.goto('/')
    const card = page.locator('.session-card').filter({ hasText: 'e2e-no-usage' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('No ccusage project match')

    await request.delete(`/api/sessions/${session.id}`)
  })

  // Note: the UTC-negative timezone regression (session at 04:55 UTC showing $0.00)
  // is fully covered by the unit tests in tests/client-date-filter.test.ts which
  // control timestamps precisely. An E2E test cannot reliably reproduce it since
  // the server assigns createdAt at runtime.
})

// ── cost window filter ────────────────────────────────────────────────────────

test.describe('cost window filter (Costs by repo)', () => {
  const PROJECT_KEY = '-Users-e2e-test-filter-project'

  test('"Today" filter shows only today\'s repo cost', async ({ page, request }) => {
    const days = [
      makeDay({ date: YESTERDAY_UTC, totalCost: 5.0, totalTokens: 100_000 }),
      makeDay({ date: TODAY_UTC, totalCost: 1.23, totalTokens: 20_000 }),
    ]

    await page.route('/api/usage', (route) =>
      route.fulfill({ json: makeUsageResponse(PROJECT_KEY, days) }),
    )

    const { session } = await (
      await request.post('/api/sessions', {
        data: { name: 'e2e-filter-test', usageProject: PROJECT_KEY, status: 'green' },
      })
    ).json()

    await page.goto('/')

    // Switch to Today filter
    await page.locator('.usage__window', { hasText: 'Today' }).click()

    const repoCard = page.locator('.repo-card').filter({ hasText: 'filter-project' })

    // Regression: "Today" used localIsoDate() which gave the wrong date for
    // UTC-negative timezones — the repo card would disappear from Today filter.
    await expect(repoCard).toBeVisible()
    await expect(repoCard).toContainText('$1.23')
    await expect(repoCard).not.toContainText('$5.00')

    await request.delete(`/api/sessions/${session.id}`)
  })

  test('"2 days" filter includes today and yesterday', async ({ page, request }) => {
    const days = [
      makeDay({ date: YESTERDAY_UTC, totalCost: 3.0, totalTokens: 60_000 }),
      makeDay({ date: TODAY_UTC, totalCost: 1.5, totalTokens: 30_000 }),
    ]

    await page.route('/api/usage', (route) =>
      route.fulfill({ json: makeUsageResponse(PROJECT_KEY, days) }),
    )

    const { session } = await (
      await request.post('/api/sessions', {
        data: { name: 'e2e-2days-test', usageProject: PROJECT_KEY, status: 'green' },
      })
    ).json()

    await page.goto('/')
    await page.locator('.usage__window', { hasText: '2 days' }).click()

    const repoCard = page.locator('.repo-card').filter({ hasText: 'filter-project' })
    await expect(repoCard).toBeVisible()
    // Both days should contribute to the total ($4.50)
    await expect(repoCard).toContainText('$4.50')

    await request.delete(`/api/sessions/${session.id}`)
  })
})

// ── session lifecycle status transitions ──────────────────────────────────────

test.describe('session status lifecycle', () => {
  test('PATCH updates the existing card status without creating a new card', async ({ page, request }) => {
    await page.route('/api/usage', (route) =>
      route.fulfill({
        json: { available: false, generatedAt: new Date().toISOString(), totals: {}, today: null, activeBlock: null, blocks: [], projects: {} },
      }),
    )

    const { session } = await (
      await request.post('/api/sessions', {
        data: { name: 'e2e-lifecycle', status: 'orange', detail: 'Starting up' },
      })
    ).json()

    await page.goto('/')
    const card = page.locator('.session-card').filter({ hasText: 'e2e-lifecycle' })
    await expect(card).toBeVisible()

    // Patch to green
    await request.patch(`/api/sessions/${session.id}`, {
      data: { status: 'green', detail: 'All done' },
    })

    // Still only one card — PATCH updates, not creates
    await expect(page.locator('.session-card').filter({ hasText: 'e2e-lifecycle' })).toHaveCount(1)

    await request.delete(`/api/sessions/${session.id}`)
  })

  test('deleting a session removes its card from the UI', async ({ page, request }) => {
    await page.route('/api/usage', (route) =>
      route.fulfill({
        json: { available: false, generatedAt: new Date().toISOString(), totals: {}, today: null, activeBlock: null, blocks: [], projects: {} },
      }),
    )

    const { session } = await (
      await request.post('/api/sessions', {
        data: { name: 'e2e-delete-me', status: 'green' },
      })
    ).json()

    await page.goto('/')
    await expect(page.locator('.session-card').filter({ hasText: 'e2e-delete-me' })).toBeVisible()

    await request.delete(`/api/sessions/${session.id}`)

    // After deletion, card should disappear on the next poll cycle (every 2 s).
    // Playwright's toHaveCount(0) retries until the assertion passes (default 30 s
    // timeout), so there is no need for an explicit sleep or manual wait.
    await expect(page.locator('.session-card').filter({ hasText: 'e2e-delete-me' })).toHaveCount(0)
  })
})
