import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  hookEvents,
  hookSettingsSchema,
  hookActionSchema,
} from '../src/hook-settings.js'

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('hookSettingsSchema', () => {
  it('validates a fully installed status', () => {
    const input = {
      installed: true,
      configLocation: 'global',
      scriptExists: true,
      scriptPath: '/home/user/.claude-status-dashboard/hooks/claude-status-dashboard.sh',
      scriptVersion: '0.5.1',
      events: ['SessionStart', 'Stop', 'UserPromptSubmit'],
      error: null,
    }
    const parsed = hookSettingsSchema.parse(input)
    expect(parsed.installed).toBe(true)
    expect(parsed.configLocation).toBe('global')
    expect(parsed.scriptExists).toBe(true)
    expect(parsed.events).toEqual(['SessionStart', 'Stop', 'UserPromptSubmit'])
    expect(parsed.error).toBeNull()
  })

  it('allows error to be a string', () => {
    const input = {
      installed: false,
      configLocation: 'none' as const,
      scriptExists: false,
      scriptPath: '',
      scriptVersion: null,
      events: [],
      error: 'Something went wrong',
    }
    const parsed = hookSettingsSchema.parse(input)
    expect(parsed.error).toBe('Something went wrong')
  })

  it('allows error to be null', () => {
    const input = {
      installed: false,
      configLocation: 'none' as const,
      scriptExists: false,
      scriptPath: '',
      scriptVersion: null,
      events: [],
      error: null,
    }
    const parsed = hookSettingsSchema.parse(input)
    expect(parsed.error).toBeNull()
  })

  it('rejects invalid configLocation', () => {
    const input = {
      installed: false,
      configLocation: 'invalid' as string,
      scriptExists: false,
      scriptPath: '',
      scriptVersion: null,
      events: [],
      error: null,
    }
    expect(() => hookSettingsSchema.parse(input)).toThrow()
  })

  it('rejects non-boolean installed', () => {
    const input = {
      installed: 'yes',
      configLocation: 'none',
      scriptExists: false,
      scriptPath: '',
      scriptVersion: null,
      events: [],
      error: null,
    }
    expect(() => hookSettingsSchema.parse(input)).toThrow()
  })

  it('accepts both config location', () => {
    const input = {
      installed: true,
      configLocation: 'both' as const,
      scriptExists: true,
      scriptPath: '/tmp/hook.sh',
      scriptVersion: '1.0.0',
      events: hookEvents,
      error: null,
    }
    const parsed = hookSettingsSchema.parse(input)
    expect(parsed.configLocation).toBe('both')
  })

  it('accepts project config location', () => {
    const input = {
      installed: true,
      configLocation: 'project' as const,
      scriptExists: false,
      scriptPath: '',
      scriptVersion: null,
      events: [],
      error: null,
    }
    const parsed = hookSettingsSchema.parse(input)
    expect(parsed.configLocation).toBe('project')
  })
})

// ---------------------------------------------------------------------------
// hookEvents array
// ---------------------------------------------------------------------------

describe('hookEvents', () => {
  it('contains the 10 expected lifecycle events', () => {
    expect(hookEvents).toHaveLength(10)
    expect(hookEvents).toContain('SessionStart')
    expect(hookEvents).toContain('UserPromptSubmit')
    expect(hookEvents).toContain('PreToolUse')
    expect(hookEvents).toContain('PostToolUse')
    expect(hookEvents).toContain('Notification')
    expect(hookEvents).toContain('PermissionRequest')
    expect(hookEvents).toContain('Elicitation')
    expect(hookEvents).toContain('Stop')
    expect(hookEvents).toContain('StopFailure')
    expect(hookEvents).toContain('SubagentStop')
  })
})

// ---------------------------------------------------------------------------
// hookActionSchema
// ---------------------------------------------------------------------------

describe('hookActionSchema', () => {
  it('validates install action with explicit scope', () => {
    const parsed = hookActionSchema.parse({ action: 'install', scope: 'global' })
    expect(parsed.action).toBe('install')
    expect(parsed.scope).toBe('global')
  })

  it('validates delete action with project scope', () => {
    const parsed = hookActionSchema.parse({ action: 'delete', scope: 'project' })
    expect(parsed.action).toBe('delete')
    expect(parsed.scope).toBe('project')
  })

  it('defaults scope to global when omitted', () => {
    const parsed = hookActionSchema.parse({ action: 'install' })
    expect(parsed.scope).toBe('global')
  })

  it('rejects invalid action', () => {
    expect(() => hookActionSchema.parse({ action: 'update' })).toThrow()
  })

  it('rejects missing action', () => {
    expect(() => hookActionSchema.parse({ scope: 'global' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Filesystem-based integration tests
// ---------------------------------------------------------------------------

describe('detectHookStatus', () => {
  let tempDir: string
  let originalClaudeHome: string | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hooks-test-'))
    originalClaudeHome = process.env.CLAUDE_HOME
    process.env.CLAUDE_HOME = tempDir
  })

  afterEach(async () => {
    if (originalClaudeHome === undefined) {
      delete process.env.CLAUDE_HOME
    } else {
      process.env.CLAUDE_HOME = originalClaudeHome
    }
    delete process.env.CLAUDE_CONFIG_DIR
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns not-installed when no settings.json exists', async () => {
    const { detectHookStatus } = await import('../src/hook-settings.js')
    const status = await detectHookStatus('0.6.0')
    expect(status.installed).toBe(false)
    expect(status.configLocation).toBe('none')
    expect(status.events).toHaveLength(0)
  })

  it('detects global install when settings.json has dashboard hooks', async () => {
    const settingsDir = join(tempDir, 'settings.json')
    await writeFile(settingsDir, JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
        Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
      },
    }, null, 2))

    const { detectHookStatus } = await import('../src/hook-settings.js')
    const status = await detectHookStatus('0.6.0')
    expect(status.installed).toBe(true)
    expect(status.configLocation).toBe('global')
    expect(status.events).toContain('SessionStart')
    expect(status.events).toContain('Stop')
  })

  it('detects hooks with 2 events (minimal install)', async () => {
    const settingsDir = join(tempDir, 'settings.json')
    await writeFile(settingsDir, JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
        Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
      },
    }, null, 2))

    const { detectHookStatus } = await import('../src/hook-settings.js')
    const status = await detectHookStatus('0.6.0')
    // 2 out of 10 events should still be detected (we match by script name, not count)
    expect(status.installed).toBe(true)
    expect(status.events.length).toBeGreaterThanOrEqual(2)
  })

  it('does not detect hooks when script name differs', async () => {
    const settingsDir = join(tempDir, 'settings.json')
    await writeFile(settingsDir, JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/some-other-script.sh', timeout: 5 }] }],
      },
    }, null, 2))

    const { detectHookStatus } = await import('../src/hook-settings.js')
    const status = await detectHookStatus('0.6.0')
    expect(status.installed).toBe(false)
    expect(status.configLocation).toBe('none')
  })

  it('merges events from both locations when hooks exist in global and project settings', async () => {
    // Set up global hooks with specific events
    const globalSettingsPath = join(tempDir, 'settings.json')
    await writeFile(globalSettingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
        Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
      },
    }, null, 2))

    // Set up a project directory with its own .claude/settings.json
    const projectDir = await mkdtemp(join(tmpdir(), 'hooks-project-'))
    const projectClaudeDir = join(projectDir, '.claude')
    await mkdir(projectClaudeDir, { recursive: true })
    await writeFile(join(projectClaudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
        PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
      },
    }, null, 2))

    const originalCwd = process.cwd()
    try {
      process.chdir(projectDir)
      const { detectHookStatus } = await import('../src/hook-settings.js')
      const status = await detectHookStatus('0.6.0')

      expect(status.installed).toBe(true)
      expect(status.configLocation).toBe('both')
      // Should include events from BOTH global and project
      expect(status.events).toContain('SessionStart')
      expect(status.events).toContain('Stop')
      expect(status.events).toContain('UserPromptSubmit')
      expect(status.events).toContain('PreToolUse')
    } finally {
      process.chdir(originalCwd)
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  it('handles corrupt settings.json gracefully', async () => {
    const settingsDir = join(tempDir, 'settings.json')
    await writeFile(settingsDir, 'not valid json {{{')

    const { detectHookStatus } = await import('../src/hook-settings.js')
    const status = await detectHookStatus('0.6.0')
    // Should not throw — returns with error or false
    expect(status.installed).toBe(false)
  })
})

describe('installHooks and deleteHooks', () => {
  let tempDir: string
  let scriptPath: string
  let originalClaudeHome: string | undefined
  let originalFetch: typeof global.fetch

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hooks-test-'))
    originalClaudeHome = process.env.CLAUDE_HOME
    process.env.CLAUDE_HOME = tempDir

    // Create a fake hook script so downloadHookScript can "download" it
    const scriptDir = join(tempDir, '.claude-status-dashboard', 'hooks')
    await mkdir(scriptDir, { recursive: true })
    scriptPath = join(scriptDir, 'claude-status-dashboard.sh')
    await writeFile(scriptPath, '#!/bin/bash\necho hook', 'utf-8')

    // Mock fetch to return our local script content instead of hitting GitHub
    originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '#!/bin/bash\necho hook',
    })
  })

  afterEach(async () => {
    global.fetch = originalFetch
    if (originalClaudeHome === undefined) {
      delete process.env.CLAUDE_HOME
    } else {
      process.env.CLAUDE_HOME = originalClaudeHome
    }
    delete process.env.CLAUDE_CONFIG_DIR
    await rm(tempDir, { recursive: true, force: true })
  })

  it('installHooks creates settings.json with dashboard hooks', async () => {
    const { installHooks, detectHookStatus } = await import('../src/hook-settings.js')

    await installHooks('global', '0.6.0')

    const status = await detectHookStatus('0.6.0')
    expect(status.installed).toBe(true)
    expect(status.configLocation).toBe('global')
    expect(status.events.length).toBe(10) // all 10 events
    expect(status.events).toContain('SessionStart')
    expect(status.events).toContain('Stop')
    expect(status.events).toContain('SubagentStop')
  })

  it('deleteHooks removes dashboard hooks but preserves others', async () => {
    // First, create a settings.json with a mix of dashboard and non-dashboard hooks
    const settingsPath = join(tempDir, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({
      someOtherSetting: true,
      hooks: {
        SessionStart: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
        Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
        CustomEvent: [{ matcher: '.*', hooks: [{ type: 'command', command: 'echo hello' }] }],
      },
    }, null, 2))

    const { deleteHooks } = await import('../src/hook-settings.js')
    await deleteHooks('global')

    // Read the file back and verify
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)

    // Dashboard hooks should be gone
    expect(parsed.hooks.SessionStart).toBeUndefined()
    expect(parsed.hooks.Stop).toBeUndefined()

    // Non-dashboard hook should be preserved
    expect(parsed.hooks.CustomEvent).toBeDefined()
    expect(parsed.hooks.CustomEvent[0].hooks[0].command).toBe('echo hello')

    // Non-hook settings should be preserved
    expect(parsed.someOtherSetting).toBe(true)
  })

  it('deleteHooks strips dashboard hooks from a matcher that also has user hooks', async () => {
    // Regression: a matcher with mixed hooks (dashboard + user) must keep the
    // user hook and remove only the dashboard one.
    const settingsPath = join(tempDir, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: '.*',
          hooks: [
            { type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 },
            { type: 'command', command: 'echo hello' },
          ],
        }],
      },
    }, null, 2))

    const { deleteHooks } = await import('../src/hook-settings.js')
    await deleteHooks('global')

    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)

    // The event should still exist (it has a non-dashboard hook)
    expect(parsed.hooks.SessionStart).toBeDefined()
    expect(parsed.hooks.SessionStart).toHaveLength(1)
    // The matcher should only have the user hook, not the dashboard one
    const hooks = parsed.hooks.SessionStart[0].hooks
    expect(hooks).toHaveLength(1)
    expect(hooks[0].command).toBe('echo hello')
  })

  it('deleteHooks removes hooks key entirely when no hooks remain', async () => {
    const settingsPath = join(tempDir, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({
      otherSettings: true,
      hooks: {
        SessionStart: [{ matcher: '.*', hooks: [{ type: 'command', command: 'bash /tmp/claude-status-dashboard.sh', timeout: 5 }] }],
      },
    }, null, 2))

    const { deleteHooks } = await import('../src/hook-settings.js')
    await deleteHooks('global')

    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)

    expect(parsed.hooks).toBeUndefined()
    expect(parsed.otherSettings).toBe(true)
  })

  it('deleteHooks is a no-op when settings.json does not exist', async () => {
    const { deleteHooks } = await import('../src/hook-settings.js')
    // Should not throw
    await deleteHooks('global')
  })

  it('installHooks preserves existing non-hook settings', async () => {
    const settingsPath = join(tempDir, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({
      env: { FOO: 'bar' },
      model: 'sonnet',
    }, null, 2))

    const { installHooks } = await import('../src/hook-settings.js')

    await installHooks('global', '0.6.0')

    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)

    expect(parsed.env.FOO).toBe('bar')
    expect(parsed.model).toBe('sonnet')
    expect(parsed.hooks.SessionStart).toBeDefined()
  })
})
