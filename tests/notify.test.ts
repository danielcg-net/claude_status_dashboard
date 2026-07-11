import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Session } from '../src/domain.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn().mockResolvedValue(new Response()))

const makeSession = (overrides?: Partial<Session>): Session => ({
  id: 'test-1',
  name: 'my-project',
  status: 'orange',
  detail: '',
  usageProject: '/home/user/my-project',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  statusSince: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

vi.stubGlobal('fetch', mockFetch)

// Dynamically re-import the notify module with fresh process.env each test.
// `vi.resetModules()` clears the module cache so the top-level env reads re-run.
async function importNotify(env: Record<string, string | undefined> = {}): Promise<
  typeof import('../src/notify.js')
> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return await import('../src/notify.js')
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  mockFetch.mockResolvedValue(new Response())
  // Clear all NOTIFY_* vars between tests so previous values don't leak.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('NOTIFY_')) delete process.env[key]
  }
})

// ---------------------------------------------------------------------------
// eventForStatus
// ---------------------------------------------------------------------------

describe('eventForStatus', () => {
  it('maps red status to "red" event', async () => {
    const { eventForStatus } = await importNotify()
    expect(eventForStatus('red')).toBe('red')
  })

  it('maps green status to "finished" event', async () => {
    const { eventForStatus } = await importNotify()
    expect(eventForStatus('green')).toBe('finished')
  })

  it('returns null for yellow and orange', async () => {
    const { eventForStatus } = await importNotify()
    expect(eventForStatus('yellow')).toBeNull()
    expect(eventForStatus('orange')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// shouldNotify
// ---------------------------------------------------------------------------

describe('shouldNotify', () => {
  it('returns true when event is in NOTIFY_ON', async () => {
    const { shouldNotify } = await importNotify({ NOTIFY_ON: 'red,started' })
    expect(shouldNotify('red')).toBe(true)
    expect(shouldNotify('started')).toBe(true)
    expect(shouldNotify('finished')).toBe(false)
  })

  it('returns true for all events by default', async () => {
    const { shouldNotify } = await importNotify({})
    expect(shouldNotify('started')).toBe(true)
    expect(shouldNotify('finished')).toBe(true)
    expect(shouldNotify('red')).toBe(true)
  })

  it('returns false for all when NOTIFY_ON is empty', async () => {
    const { shouldNotify } = await importNotify({ NOTIFY_ON: '' })
    expect(shouldNotify('red')).toBe(false)
    expect(shouldNotify('started')).toBe(false)
    expect(shouldNotify('finished')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// _buildPayload — per-format payload shapes
// ---------------------------------------------------------------------------

describe('_buildPayload', () => {
  it('generic format includes full session data', async () => {
    const { _buildPayload } = await importNotify()
    const session = makeSession({ detail: 'doing work' })
    const { body, headers } = _buildPayload('generic', 'started', session)

    const parsed = JSON.parse(body)
    expect(parsed.event).toBe('started')
    expect(parsed.timestamp).toBeDefined()
    expect(parsed.session.id).toBe('test-1')
    expect(parsed.session.name).toBe('my-project')
    expect(parsed.session.status).toBe('orange')
    expect(parsed.session.detail).toBe('doing work')
    expect(parsed.session.usageProject).toBe('/home/user/my-project')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('pushover format sends token + user + message + priority', async () => {
    const { _buildPayload } = await importNotify({
      NOTIFY_PUSHOVER_TOKEN: 'tok-abc',
      NOTIFY_PUSHOVER_USER: 'user-xyz',
    })
    const session = makeSession({ detail: 'needs approval' })
    const { body, headers } = _buildPayload('pushover', 'red', session)

    const parsed = JSON.parse(body)
    expect(parsed.token).toBe('tok-abc')
    expect(parsed.user).toBe('user-xyz')
    expect(parsed.title).toBe('Claude Status Dashboard')
    expect(parsed.message).toContain('Needs attention')
    expect(parsed.message).toContain('needs approval')
    expect(parsed.priority).toBe(1) // red = high priority
  })

  it('pushover uses priority 0 for non-red events', async () => {
    const { _buildPayload } = await importNotify({
      NOTIFY_PUSHOVER_TOKEN: 'tok',
      NOTIFY_PUSHOVER_USER: 'user',
    })
    const { body } = _buildPayload('pushover', 'finished', makeSession())
    expect(JSON.parse(body).priority).toBe(0)
  })

  it('teams format produces a MessageCard', async () => {
    const { _buildPayload } = await importNotify()
    const { body } = _buildPayload('teams', 'red', makeSession({ detail: 'waiting' }))

    const parsed = JSON.parse(body)
    expect(parsed['@type']).toBe('MessageCard')
    expect(parsed['@context']).toBe('https://schema.org/extensions')
    expect(parsed.title).toBe('Claude Status Dashboard')
    expect(parsed.themeColor).toBe('FF0000') // red
    expect(parsed.text).toContain('waiting')
    expect(parsed.sections[0].facts).toHaveLength(3)
  })

  it('teams uses green color for finished events', async () => {
    const { _buildPayload } = await importNotify()
    const { body } = _buildPayload('teams', 'finished', makeSession())
    expect(JSON.parse(body).themeColor).toBe('00AA00')
  })

  it('slack format includes mrkdwn blocks', async () => {
    const { _buildPayload } = await importNotify()
    const { body } = _buildPayload('slack', 'red', makeSession({ detail: 'approval needed' }))

    const parsed = JSON.parse(body)
    expect(parsed.blocks[0].type).toBe('section')
    expect(parsed.blocks[0].text.type).toBe('mrkdwn')
    expect(parsed.blocks[0].text.text).toContain('Needs attention')
    expect(parsed.blocks[0].text.text).toContain('my-project')
    expect(parsed.blocks[0].text.text).toContain('approval needed')
  })

  it('discord format includes embed with color', async () => {
    const { _buildPayload } = await importNotify()
    const { body } = _buildPayload('discord', 'red', makeSession())

    const parsed = JSON.parse(body)
    expect(parsed.content).toBeNull()
    expect(parsed.embeds[0].title).toBe('Needs attention')
    expect(parsed.embeds[0].color).toBe(0xff0000)
    expect(parsed.embeds[0].fields).toHaveLength(2)
  })

  it('discord uses distinct colors per event', async () => {
    const { _buildPayload } = await importNotify()
    expect(JSON.parse(_buildPayload('discord', 'started', makeSession()).body).embeds[0].color).toBe(0x0076d3)
    expect(JSON.parse(_buildPayload('discord', 'finished', makeSession()).body).embeds[0].color).toBe(0x00aa00)
    expect(JSON.parse(_buildPayload('discord', 'red', makeSession()).body).embeds[0].color).toBe(0xff0000)
  })

  it('includes extra headers from NOTIFY_HEADERS', async () => {
    const { _buildPayload } = await importNotify({
      NOTIFY_HEADERS: '{"Authorization":"Bearer secret","X-Custom":"val"}',
    })
    const { headers } = _buildPayload('generic', 'started', makeSession())
    expect(headers['Authorization']).toBe('Bearer secret')
    expect(headers['X-Custom']).toBe('val')
  })

  it('ignores malformed NOTIFY_HEADERS JSON', async () => {
    const { _buildPayload } = await importNotify({
      NOTIFY_HEADERS: '{not valid json',
    })
    const { headers } = _buildPayload('generic', 'started', makeSession())
    expect(headers['Content-Type']).toBe('application/json')
    // No extra headers — malformed JSON is silently ignored.
    expect(Object.keys(headers)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// notify — fire-and-forget behaviour
// ---------------------------------------------------------------------------

describe('notify', () => {
  it('is a no-op when NOTIFY_WEBHOOK_URL is not set', async () => {
    const { notify } = await importNotify({})
    notify('red', makeSession())
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('is a no-op when the event is not in NOTIFY_ON', async () => {
    const { notify } = await importNotify({
      NOTIFY_WEBHOOK_URL: 'https://example.com/webhook',
      NOTIFY_ON: 'started',
    })
    notify('finished', makeSession())
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('posts to the webhook URL for matching events', async () => {
    const { notify } = await importNotify({
      NOTIFY_WEBHOOK_URL: 'https://hooks.example.com/push',
      NOTIFY_ON: 'red',
    })
    notify('red', makeSession({ detail: 'test alert' }))

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://hooks.example.com/push')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body).event).toBe('red')
  })

  it('does not throw when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))
    const { notify } = await importNotify({
      NOTIFY_WEBHOOK_URL: 'https://hooks.example.com/push',
      NOTIFY_ON: 'red',
    })
    // Must not throw.
    expect(() => notify('red', makeSession())).not.toThrow()
  })
})
