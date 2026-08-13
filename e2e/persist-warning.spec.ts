import { expect, test } from '@playwright/test'

// These tests exercise the real client refresh path — loadState() fetching
// /api/sessions, the response being spread into ui.state, then render(). A unit
// test that sets ui.state.persistError directly cannot prove that path works.

const usageUnavailable = {
  available: false,
  generatedAt: new Date().toISOString(),
  totals: {},
  today: null,
  activeBlock: null,
  blocks: [],
  sessions: [],
  projects: {},
  error: null,
}

const stubUsage = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.route('/api/usage', (route) => route.fulfill({ json: usageUnavailable }))
}

test.describe('session persistence warning', () => {
  test('shows the banner when the server reports it cannot save sessions', async ({ page }) => {
    await stubUsage(page)
    await page.route('/api/sessions', (route) =>
      route.fulfill({
        json: {
          sessions: [],
          redAlertAfterMs: 300000,
          persistError: 'Cannot write the session cache at /data/sessions.json (EACCES)',
        },
      }),
    )

    await page.goto('/')

    const banner = page.locator('.persist-warning')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Sessions are not being saved')
    await expect(banner.locator('.persist-warning__detail')).toContainText('EACCES')
  })

  test('stays hidden when persistence is healthy', async ({ page }) => {
    await stubUsage(page)
    await page.route('/api/sessions', (route) =>
      route.fulfill({ json: { sessions: [], redAlertAfterMs: 300000, persistError: null } }),
    )

    await page.goto('/')

    await expect(page.locator('.usage')).toBeVisible()
    await expect(page.locator('.persist-warning')).toHaveCount(0)
  })

  test('real server reports no persistence error with a writable data dir', async ({ request }) => {
    const response = await request.get('/api/health')

    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({ ok: true, persistError: null })
  })
})
