// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'

import { render } from '../src/ui-render.js'
import { ui } from '../src/ui-state.js'

// ui-render.ts keeps its shell containers in module state and builds them on the
// first render, so the #app root has to be created once and reused — swapping it
// per test would leave later renders writing into a detached tree.
beforeAll(() => {
  const root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
})

const renderWith = (persistError: unknown): void => {
  ui.state = { ...ui.state, sessions: [], usage: null, persistError } as typeof ui.state
  render()
}

const banner = (): Element | null => document.querySelector('.persist-warning')

describe('persistence warning banner', () => {
  it('stays hidden while persistence is healthy', () => {
    renderWith(null)
    expect(banner()).toBeNull()
  })

  it('warns when the server cannot write its session cache', () => {
    renderWith('Cannot write the session cache at /data/sessions.json (EACCES)')

    expect(banner()).not.toBeNull()
    expect(banner()?.textContent).toContain('Sessions are not being saved')
    // The operator needs the underlying reason to act on it.
    expect(banner()?.querySelector('.persist-warning__detail')?.textContent).toContain('EACCES')
    expect(banner()?.getAttribute('role')).toBe('alert')
  })

  it('clears the warning once a save succeeds again', () => {
    renderWith('Cannot write the session cache at /data/sessions.json (EACCES)')
    expect(banner()).not.toBeNull()

    renderWith(null)
    expect(banner()).toBeNull()
  })

  it('ignores blank or non-string values from the wire', () => {
    renderWith('   ')
    expect(banner()).toBeNull()

    renderWith(undefined)
    expect(banner()).toBeNull()

    renderWith(42)
    expect(banner()).toBeNull()
  })
})
