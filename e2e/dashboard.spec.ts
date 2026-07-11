import { test, expect } from '@playwright/test'

test.describe('Claude Status Dashboard', () => {
  test('displays the dashboard title', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('Claude Session Dashboard')
  })

  test('health endpoint responds', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.service).toBe('claude-status-dashboard')
  })

  test('creates a session via API and it appears', async ({ page, request }) => {
    const { session } = await (await request.post('/api/sessions', {
      data: { name: 'e2e-test-session', status: 'working' },
    })).json()

    // Reload and verify
    await page.goto('/')
    await expect(page.locator('.session-card h2').filter({ hasText: 'e2e-test-session' }).first()).toBeVisible()

    // Clean up
    await request.delete(`/api/sessions/${session.id}`)
  })

  test('API validation rejects bad status', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      data: { name: 'bad', status: 'purple' },
    })
    expect(res.status()).toBe(400)
  })

  test('usage card is visible even without data', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.usage')).toBeVisible({ timeout: 10000 })
  })

  test('cost window buttons exist', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.usage__window', { timeout: 10000 })
    const windows = page.locator('.usage__window')
    expect(await windows.count()).toBeGreaterThan(0)
  })
})
