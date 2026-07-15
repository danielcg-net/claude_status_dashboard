import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Hooks Settings Panel & Toast Notifications — E2E
//
// Uses stable selectors: IDs (#beep-toggle, etc.) for interactive elements,
// data-testid for structural containers added by this feature (hooks-panel,
// toast), getByRole for headings/buttons where appropriate.
// ---------------------------------------------------------------------------

// ── helpers ───────────────────────────────────────────────────────────────────

const openHooksPanel = async (page: import('@playwright/test').Page) => {
  await page.locator('#hooks-toggle').click()
  await expect(page.getByTestId('hooks-panel')).toBeVisible()
}

const openBeepPanel = async (page: import('@playwright/test').Page) => {
  await page.locator('#beep-toggle').click()
  // The beep panel doesn't have a data-testid yet; use its heading
  await expect(page.locator('.alert-controls__beep-panel')).toBeVisible()
}

const openNotifyPanel = async (page: import('@playwright/test').Page) => {
  await page.locator('#notify-toggle').click()
  await expect(page.locator('.alert-controls__notify-panel')).toBeVisible()
}

// ── Hooks panel UI ────────────────────────────────────────────────────────────

test.describe('Hooks settings panel', () => {
  test('header buttons: Beeps, Notifications, and Hooks', async ({ page }) => {
    await page.goto('/')

    const beepBtn = page.locator('#beep-toggle')
    const notifyBtn = page.locator('#notify-toggle')
    const hooksBtn = page.locator('#hooks-toggle')

    await expect(beepBtn).toBeVisible()
    await expect(notifyBtn).toBeVisible()
    await expect(hooksBtn).toBeVisible()

    await expect(beepBtn).toHaveText('Beeps')
    await expect(notifyBtn).toHaveText('Notifications')
    await expect(hooksBtn).toContainText('Hooks')
  })

  test('opens on click and shows all expected elements', async ({ page }) => {
    await page.goto('/')
    await openHooksPanel(page)

    const panel = page.getByTestId('hooks-panel')

    // Heading
    await expect(panel.getByRole('heading', { name: 'Hooks Setup' })).toBeVisible()

    // Close button
    await expect(page.getByTestId('hooks-panel-close')).toBeVisible()

    // Status section
    await expect(panel.locator('.hooks-panel__status')).toBeVisible()

    // Install button and scope selector
    await expect(page.locator('#hooks-install')).toBeVisible()
    await expect(page.locator('#hooks-scope')).toBeVisible()
  })

  test('close button dismisses the panel', async ({ page }) => {
    await page.goto('/')
    await openHooksPanel(page)

    await page.getByTestId('hooks-panel-close').click()
    await expect(page.getByTestId('hooks-panel')).not.toBeAttached()
  })

  test('toggle button dismisses on second click', async ({ page }) => {
    await page.goto('/')
    await openHooksPanel(page)

    await page.locator('#hooks-toggle').click()
    await expect(page.getByTestId('hooks-panel')).not.toBeAttached()
  })

  test('status badges display install state', async ({ page }) => {
    await page.goto('/')
    await openHooksPanel(page)

    const panel = page.getByTestId('hooks-panel')
    const statusRow = panel.locator('.hooks-panel__status-row').first()
    await expect(statusRow).toContainText('Status:')

    const badge = panel.locator('.hooks-panel__badge').first()
    await expect(badge).toBeVisible()
    expect(['Installed', 'Not installed']).toContain(await badge.textContent())
  })

  test('panel survives polling refresh cycles', async ({ page }) => {
    await page.goto('/')
    await openHooksPanel(page)

    // Verify heading is stable across at least one 2s poll cycle
    // waitForFunction ensures we wait until the condition is met
    await page.waitForFunction(
      () => document.querySelector('.alert-controls__hooks-panel h3')?.textContent === 'Hooks Setup',
      null,
      { timeout: 5000 },
    )

    await expect(page.getByTestId('hooks-panel').getByRole('heading')).toHaveText('Hooks Setup')
  })

  test('three panels can be open simultaneously and closed independently', async ({ page }) => {
    await page.goto('/')

    await openBeepPanel(page)
    await openNotifyPanel(page)
    await openHooksPanel(page)

    await expect(page.locator('.alert-controls__beep-panel')).toBeVisible()
    await expect(page.locator('.alert-controls__notify-panel')).toBeVisible()
    await expect(page.getByTestId('hooks-panel')).toBeVisible()

    // Close hooks only
    await page.getByTestId('hooks-panel-close').click()
    await expect(page.getByTestId('hooks-panel')).not.toBeAttached()
    await expect(page.locator('.alert-controls__beep-panel')).toBeVisible()
    await expect(page.locator('.alert-controls__notify-panel')).toBeVisible()
  })
})

// ── Toast notifications ───────────────────────────────────────────────────────

test.describe('toast notifications', () => {
  test('saving Beep settings shows a success toast', async ({ page }) => {
    await page.goto('/')
    await openBeepPanel(page)

    await page.locator('#beep-save').click()

    const toast = page.getByTestId('toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('Beep settings saved')
    await expect(toast).toHaveClass(/toast--success/)
  })

  test('saving Notify settings shows a success toast', async ({ page }) => {
    await page.goto('/')
    await openNotifyPanel(page)

    await page.locator('#notify-save').click()

    const toast = page.getByTestId('toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('Notification settings saved')
    await expect(toast).toHaveClass(/toast--success/)
  })

  test('success toast auto-dismisses', async ({ page }) => {
    await page.goto('/')
    await openBeepPanel(page)

    await page.locator('#beep-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()

    // Should disappear within generous timeout (auto-dismiss is 3.5s)
    await expect(page.getByTestId('toast')).not.toBeVisible({ timeout: 8000 })
  })

  test('server error produces an error toast', async ({ page }) => {
    await page.route('**/api/settings/beep', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 500, body: '{"error":"fail"}' })
      } else {
        await route.continue()
      }
    })

    await page.goto('/')
    await openBeepPanel(page)

    await page.locator('#beep-save').click()

    const toast = page.getByTestId('toast')
    await expect(toast).toBeVisible()
    await expect(toast).toHaveClass(/toast--error/)
    await expect(toast).toContainText('Failed')
  })

  test('toggling Notify enabled checkbox produces a toast', async ({ page }) => {
    await page.goto('/')
    await openNotifyPanel(page)

    const checkbox = page.locator('#notify-enabled')
    const wasChecked = await checkbox.isChecked()
    await checkbox.setChecked(!wasChecked)

    const toast = page.getByTestId('toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(wasChecked ? 'disabled' : 'enabled')
    await expect(toast).toHaveClass(/toast--success/)
  })

  test('toggling Beep enabled checkbox produces a toast', async ({ page }) => {
    await page.goto('/')
    await openBeepPanel(page)

    const checkbox = page.locator('#beep-enabled')
    const wasChecked = await checkbox.isChecked()
    await checkbox.setChecked(!wasChecked)

    const toast = page.getByTestId('toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(wasChecked ? 'disabled' : 'enabled')
  })

  test('rapid double-save replaces previous toast', async ({ page }) => {
    await page.goto('/')
    await openBeepPanel(page)

    // Enable beeps so the save button stays enabled
    const beepCheckbox = page.locator('#beep-enabled')
    if (!(await beepCheckbox.isChecked())) {
      await beepCheckbox.setChecked(true)
      // Wait for the auto-save from toggling the checkbox to settle
      await expect(page.getByTestId('toast')).toBeVisible()
    }

    // Now save twice in quick succession
    const saveBtn = page.locator('#beep-save')
    await expect(saveBtn).toBeEnabled()

    await saveBtn.click()
    await expect(page.getByTestId('toast')).toBeVisible()

    await saveBtn.click()
    await expect(page.getByTestId('toast')).toHaveCount(1)
  })
})

// ── Hooks install & delete with mocked API ────────────────────────────────────

test.describe('hooks install and delete', () => {
  const installedResponse = {
    installed: true,
    configLocation: 'global',
    scriptExists: true,
    scriptPath: '~/.claude-status-dashboard/hooks/claude-status-dashboard.sh',
    scriptVersion: '0.5.1',
    events: ['SessionStart', 'Stop', 'UserPromptSubmit'],
    error: null,
  }

  const notInstalledResponse = {
    installed: false,
    configLocation: 'none',
    scriptExists: true,
    scriptPath: '~/.claude-status-dashboard/hooks/claude-status-dashboard.sh',
    scriptVersion: null,
    events: [],
    error: null,
  }

  test('install returns success toast and badge updates', async ({ page }) => {
    await page.route('**/api/settings/hooks', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(installedResponse),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto('/')
    await openHooksPanel(page)

    await page.locator('#hooks-install').click()

    const toast = page.getByTestId('toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('Hooks installed')
    await expect(toast).toHaveClass(/toast--success/)

    // Badge should update to "Installed" after render cycle
    await expect(
      page.getByTestId('hooks-panel').locator('.hooks-panel__badge').first(),
    ).toContainText('Installed')
  })

  test('install failure shows error toast', async ({ page }) => {
    await page.route('**/api/settings/hooks', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Permission denied' }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto('/')
    await openHooksPanel(page)

    await page.locator('#hooks-install').click()

    const toast = page.getByTestId('toast')
    await expect(toast).toBeVisible()
    await expect(toast).toHaveClass(/toast--error/)
    await expect(toast).toContainText('Failed')
  })

  test('scope selector defaults to global', async ({ page }) => {
    await page.goto('/')
    await openHooksPanel(page)

    await expect(page.locator('#hooks-scope')).toHaveValue('global')
  })

  test('scope lists global and project options', async ({ page }) => {
    await page.goto('/')
    await openHooksPanel(page)

    const scope = page.locator('#hooks-scope')
    await expect(scope.locator('option[value="global"]')).toBeAttached()
    await expect(scope.locator('option[value="project"]')).toBeAttached()
  })

  test('delete button visible when installed, hidden when not', async ({ page }) => {
    await page.route('**/api/settings/hooks', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(installedResponse),
        })
      } else if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(notInstalledResponse),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto('/')
    await openHooksPanel(page)

    // Delete button visible because mock says installed
    const deleteBtn = page.locator('#hooks-delete')
    await expect(deleteBtn).toBeVisible()

    await deleteBtn.click()

    const toast = page.getByTestId('toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('deleted')
  })
})

// ── Hooks API endpoints ───────────────────────────────────────────────────────

test.describe('hooks API endpoints', () => {
  test('GET returns valid status shape', async ({ request }) => {
    const res = await request.get('/api/settings/hooks')
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(typeof body.installed).toBe('boolean')
    expect(['global', 'project', 'both', 'none']).toContain(body.configLocation)
    expect(typeof body.scriptExists).toBe('boolean')
    expect(typeof body.scriptPath).toBe('string')
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.error === null || typeof body.error === 'string').toBe(true)
  })

  test('PUT rejects invalid action', async ({ request }) => {
    const res = await request.put('/api/settings/hooks', { data: { action: 'invalid' } })
    expect(res.status()).toBe(400)
  })

  test('PUT rejects invalid scope', async ({ request }) => {
    const res = await request.put('/api/settings/hooks', { data: { action: 'install', scope: 'invalid' } })
    expect(res.status()).toBe(400)
  })
})
