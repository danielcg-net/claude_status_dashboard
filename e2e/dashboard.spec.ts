import { test, expect } from '@playwright/test'

test.describe('Claude Status Dashboard', () => {
  test('displays the dashboard title', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('Claude Session Dashboard')
  })

  test('links to Bela\'s Ko-fi page', async ({ page }) => {
    await page.goto('/')
    const supportLink = page.getByRole('link', { name: 'Buy Bela a treat on Ko-fi' })
    await expect(supportLink).toBeVisible()
    await expect(supportLink).toHaveAttribute('href', 'https://ko-fi.com/danielcgnet')
    await expect(supportLink.locator('img')).toHaveAttribute('src', '/assets/bela-avatar.png')
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

  test('cost window buttons exist when usage data is available', async ({ page }) => {
    await page.goto('/')
    // Cost window buttons are only rendered when ccusage data is available.
    // In CI there are no Claude logs, so skip the assertion when unavailable.
    const hasData = await page.locator('.usage__window').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)
    if (hasData) {
      const windows = page.locator('.usage__window')
      expect(await windows.count()).toBeGreaterThan(0)
    }
  })

  test('dismissing update instructions does not temporarily suppress the update banner', async ({ page }) => {
    await page.route('/api/version', (route) => route.fulfill({
      json: { version: '0.9.3', latestVersion: '99.99.99', updateAvailable: true },
    }))
    await page.route('/api/update', (route) => route.fulfill({
      json: {
        success: false,
        mode: 'npm',
        message: 'npm install -g claude-status-dashboard@latest',
        requiresRestart: true,
      },
    }))

    await page.goto('/')
    await expect(page.getByRole('status', { name: 'Update available' })).toBeVisible()

    await page.getByRole('button', { name: 'How to update' }).click()
    await expect(page.getByRole('status', { name: 'Update instructions' })).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss' }).click()

    await expect.poll(() => page.evaluate(
      () => localStorage.getItem('version-banner-dismissed-until'),
    )).toBeNull()

    await page.reload()
    await expect(page.getByRole('status', { name: 'Update available' })).toBeVisible()
  })
})
