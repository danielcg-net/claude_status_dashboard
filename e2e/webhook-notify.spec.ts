import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Webhook notification resilience — E2E
// ---------------------------------------------------------------------------
//
// The playwright config starts the server with NOTIFY_WEBHOOK_URL pointing at
// a dead port (127.0.0.1:19999).  The server fires a fire-and-forget fetch to
// that URL on every session lifecycle event.  Every one of those requests
// fails instantly with "connection refused" and the notify() handler swallows
// the error silently.
//
// These tests verify that the notification code path never affects API
// responses, session state, or the UI — even when the webhook target is dead.
// They also serve as a smoke test for the full lifecycle with notifications
// enabled.

// ── helpers ───────────────────────────────────────────────────────────────────

const createSession = async (
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  data: Record<string, unknown>,
) => {
  const res = await request.post('/api/sessions', { data })
  expect(res.status()).toBe(201)
  return (await res.json()).session as {
    id: string
    name: string
    status: string
    detail: string
  }
}

// ── API resilience ───────────────────────────────────────────────────────────

test.describe('webhook notification resilience (API)', () => {
  test('session creation succeeds when webhook target is dead', async ({ request }) => {
    const session = await createSession(request, {
      name: 'e2e-webhook-new',
      status: 'working',
      detail: 'starting up',
    })

    expect(session.name).toBe('e2e-webhook-new')
    expect(session.status).toBe('working')

    await request.delete(`/api/sessions/${session.id}`)
  })

  test('status transition to red succeeds when webhook target is dead', async ({ request }) => {
    const session = await createSession(request, {
      id: 'e2e-webhook-red',
      name: 'needs-attention',
      status: 'idle',
    })

    const res = await request.patch(`/api/sessions/${session.id}`, {
      data: { status: 'attention', detail: 'approval required' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.session.status).toBe('attention')
    expect(body.session.detail).toBe('approval required')

    await request.delete(`/api/sessions/${session.id}`)
  })

  test('status transition to green succeeds when webhook target is dead', async ({ request }) => {
    const session = await createSession(request, {
      id: 'e2e-webhook-green',
      name: 'finished-job',
      status: 'working',
    })

    const res = await request.patch(`/api/sessions/${session.id}`, {
      data: { status: 'finished', detail: 'all done' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.session.status).toBe('finished')

    await request.delete(`/api/sessions/${session.id}`)
  })

  test('full lifecycle with notifications enabled leaves no side-effects', async ({ request }) => {
    // Create → update to red → update to green → delete.  Every step fires a
    // notification to the dead webhook URL and must still succeed.
    const session = await createSession(request, {
      name: 'e2e-webhook-lifecycle',
      status: 'working',
    })

    // Red transition (fires 'attention' notification)
    let res = await request.patch(`/api/sessions/${session.id}`, {
      data: { status: 'attention', detail: 'waiting' },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).session.status).toBe('attention')

    // Green transition (fires 'finished' notification)
    res = await request.patch(`/api/sessions/${session.id}`, {
      data: { status: 'finished', detail: 'completed' },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).session.status).toBe('finished')

    // Deletion must still work
    res = await request.delete(`/api/sessions/${session.id}`)
    expect(res.status()).toBe(200)
    expect((await res.json()).deleted).toBe(true)

    // Session is gone
    res = await request.get('/api/sessions')
    const sessions = (await res.json()).sessions as { id: string }[]
    expect(sessions.find((s) => s.id === session.id)).toBeUndefined()
  })
})

// ── UI resilience ────────────────────────────────────────────────────────────

test.describe('webhook notification resilience (UI)', () => {
  test('dashboard loads and renders session cards with notifications enabled', async ({
    page,
    request,
  }) => {
    const session = await createSession(request, {
      name: 'e2e-webhook-ui',
      status: 'working',
      detail: 'ui test',
    })

    await page.goto('/')
    const card = page.locator('.session-card').filter({ hasText: 'e2e-webhook-ui' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('ui test')

    await request.delete(`/api/sessions/${session.id}`)
  })

  test('session card updates after status change with notifications enabled', async ({
    page,
    request,
  }) => {
    const session = await createSession(request, {
      name: 'e2e-webhook-update-ui',
      status: 'idle',
      detail: 'before patch',
    })

    await page.goto('/')
    const card = page.locator('.session-card').filter({ hasText: 'e2e-webhook-update-ui' })
    await expect(card).toBeVisible()

    // Patch to red — fires a 'attention' notification that silently fails.
    await request.patch(`/api/sessions/${session.id}`, {
      data: { status: 'attention', detail: 'after patch' },
    })

    // Card should update on the next poll cycle (every 2 s).
    await expect(card).toContainText('after patch')

    await request.delete(`/api/sessions/${session.id}`)
  })

  test('no console errors from notification failures', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    const session = await createSession(request, {
      name: 'e2e-webhook-noerrors',
      status: 'working',
    })

    await page.goto('/')

    // Trigger a 'attention' notification (silently fails server-side).
    await request.patch(`/api/sessions/${session.id}`, {
      data: { status: 'attention' },
    })

    // Wait for a poll cycle so the UI refreshes.
    await page.waitForTimeout(3000)

    // Server-side fetch failures should not surface as browser errors.
    expect(errors).toHaveLength(0)

    await request.delete(`/api/sessions/${session.id}`)
  })
})
