import { test, expect } from '@playwright/test'

test.describe('Session summary', () => {
  test('displays summary on session card when provided', async ({ page, request }) => {
    const { session } = await (await request.post('/api/sessions', {
      data: {
        name: 'e2e-summary-test',
        status: 'working',
        summary: 'Fix the login redirect bug in production',
      },
    })).json()

    await page.goto('/')
    const card = page.locator('.session-card').filter({ hasText: 'e2e-summary-test' })
    await expect(card).toBeVisible()

    const summaryEl = card.locator('.session-card__summary')
    await expect(summaryEl).toBeVisible()
    await expect(summaryEl).toHaveText('Fix the login redirect bug in production')
    await expect(summaryEl).toHaveAttribute('title', 'Fix the login redirect bug in production')

    // Clean up
    await request.delete(`/api/sessions/${session.id}`)
  })

  test('does not render summary element when summary is empty', async ({ page, request }) => {
    const { session } = await (await request.post('/api/sessions', {
      data: {
        name: 'e2e-no-summary',
        status: 'working',
      },
    })).json()

    await page.goto('/')
    const card = page.locator('.session-card').filter({ hasText: 'e2e-no-summary' })
    await expect(card).toBeVisible()

    // The summary element should not exist for this session
    await expect(card.locator('.session-card__summary')).toHaveCount(0)

    // Clean up
    await request.delete(`/api/sessions/${session.id}`)
  })

  test('summary is truncated to 200 chars at API level', async ({ request }) => {
    const longSummary = 'x'.repeat(300)
    const res = await request.post('/api/sessions', {
      data: {
        name: 'e2e-truncation',
        status: 'working',
        summary: longSummary,
      },
    })
    expect(res.status()).toBe(400) // max(200) rejects >200

    // 200 chars exactly should work
    const exact200 = 'y'.repeat(200)
    const { session } = await (await request.post('/api/sessions', {
      data: {
        name: 'e2e-truncation-200',
        status: 'working',
        summary: exact200,
      },
    })).json()
    expect(session.summary).toBe(exact200)

    // Clean up
    await request.delete(`/api/sessions/${session.id}`)
  })

  test('summary persists across status updates', async ({ page, request }) => {
    const { session } = await (await request.post('/api/sessions', {
      data: {
        name: 'e2e-persist',
        status: 'working',
        summary: 'Initial user prompt',
      },
    })).json()

    // Update status without providing summary
    await request.patch(`/api/sessions/${session.id}`, {
      data: { status: 'idle' },
    })

    await page.goto('/')
    const card = page.locator('.session-card').filter({ hasText: 'e2e-persist' })
    await expect(card).toBeVisible()
    await expect(card.locator('.session-card__summary')).toHaveText('Initial user prompt')

    // Clean up
    await request.delete(`/api/sessions/${session.id}`)
  })
})
