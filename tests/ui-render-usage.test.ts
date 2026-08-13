// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

import { renderUsage } from '../src/ui-render-usage.js'
import type { UsageSummary } from '../src/ui-types.js'

// The shape the server sends when ccusage cannot be read. Fields are spelled
// out here rather than reusing a factory because the point of these tests is
// what happens when the payload does NOT match the declared type.
const unavailable = (overrides: Record<string, unknown> = {}): UsageSummary =>
  ({
    available: false,
    generatedAt: '2026-06-01T10:00:00Z',
    totals: {},
    today: null,
    activeBlock: null,
    blocks: [],
    sessions: [],
    projects: {},
    ...overrides,
  }) as unknown as UsageSummary

describe('renderUsage — unavailable state', () => {
  it('renders without an error field present', () => {
    // A payload with no `error` key at all: the E2E mocks send exactly this,
    // and reading `.length` off it used to throw and abort the whole render.
    const section = renderUsage(unavailable())

    expect(section.querySelector('h2')?.textContent).toBe('Claude usage')
    expect(section.querySelector('.usage__error')).toBeNull()
  })

  it('omits the detail paragraph for a null or empty error', () => {
    expect(renderUsage(unavailable({ error: null })).querySelector('.usage__error')).toBeNull()
    expect(renderUsage(unavailable({ error: '' })).querySelector('.usage__error')).toBeNull()
  })

  it('shows the underlying error verbatim when one is reported', () => {
    const section = renderUsage(unavailable({ error: 'spawn /pkg/.bin/ccusage ENOENT' }))

    expect(section.querySelector('.usage__error')?.textContent).toBe('spawn /pkg/.bin/ccusage ENOENT')
    // ...and the headline explains it rather than blaming the config dir.
    expect(section.textContent).toContain('ccusage CLI could not be started')
    expect(section.textContent).not.toContain('CLAUDE_CONFIG_DIR')
  })

  it('ignores a whitespace-only error string', () => {
    expect(renderUsage(unavailable({ error: '   \n  ' })).querySelector('.usage__error')).toBeNull()
  })

  it('does not trust a non-string error value from the wire', () => {
    // A malformed payload must not take the panel down: the headline falls
    // back to the hint and no detail paragraph is rendered.
    expect(() => renderUsage(unavailable({ error: 500 }))).not.toThrow()
    expect(renderUsage(unavailable({ error: { message: 'boom' } })).querySelector('.usage__error')).toBeNull()
  })

  it('falls back to the config hint when no error detail is available', () => {
    expect(renderUsage(unavailable()).textContent).toContain('CLAUDE_CONFIG_DIR')
  })
})
