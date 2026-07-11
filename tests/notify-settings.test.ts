import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('notifySettingsSchema', () => {
  it('parses valid settings', async () => {
    const { notifySettingsSchema } = await import('../src/notify-settings.js')
    const result = notifySettingsSchema.parse({
      enabled: true,
      webhookUrl: 'https://example.com/hook',
      format: 'slack',
      events: ['attention', 'finished'],
      pushoverToken: 'abc123',
      pushoverUser: 'user456',
      headers: { Authorization: 'Bearer xyz' },
    })
    expect(result.enabled).toBe(true)
    expect(result.webhookUrl).toBe('https://example.com/hook')
    expect(result.format).toBe('slack')
    expect(result.events).toEqual(['attention', 'finished'])
    expect(result.pushoverToken).toBe('abc123')
  })

  it('applies defaults for missing fields', async () => {
    const { notifySettingsSchema } = await import('../src/notify-settings.js')
    const result = notifySettingsSchema.parse({})
    expect(result.enabled).toBe(true)
    expect(result.webhookUrl).toBe('')
    expect(result.format).toBe('generic')
    expect(result.events).toHaveLength(5)
    expect(result.pushoverToken).toBe('')
    expect(result.headers).toEqual({})
  })

  it('rejects invalid format', async () => {
    const { notifySettingsSchema } = await import('../src/notify-settings.js')
    expect(() => notifySettingsSchema.parse({ format: 'zapier' })).toThrow()
  })

  it('rejects invalid event', async () => {
    const { notifySettingsSchema } = await import('../src/notify-settings.js')
    expect(() => notifySettingsSchema.parse({ events: ['purple'] })).toThrow()
  })

  it('partial schema accepts any subset', async () => {
    const { notifySettingsSchema } = await import('../src/notify-settings.js')
    const partial = notifySettingsSchema.partial()
    const result = partial.parse({ format: 'discord' })
    expect(result.format).toBe('discord')
    expect(result.webhookUrl).toBeUndefined()
  })
})

describe('loadNotifySettings / saveNotifySettings', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'notify-settings-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null when file does not exist', async () => {
    const { loadNotifySettings } = await import('../src/notify-settings.js')
    const result = await loadNotifySettings(tmpDir)
    expect(result).toBeNull()
  })

  it('round-trips settings', async () => {
    const { loadNotifySettings, saveNotifySettings, notifySettingsSchema } =
      await import('../src/notify-settings.js')
    const settings = notifySettingsSchema.parse({
      enabled: false,
      webhookUrl: 'https://example.com/hook',
      format: 'pushover',
      events: ['attention'],
      pushoverToken: 'tok-secret',
      pushoverUser: 'user-secret',
      headers: { 'X-Custom': 'val' },
    })
    await saveNotifySettings(tmpDir, settings)
    const loaded = await loadNotifySettings(tmpDir)
    expect(loaded).not.toBeNull()
    expect(loaded!.enabled).toBe(false)
    expect(loaded!.webhookUrl).toBe('https://example.com/hook')
    expect(loaded!.pushoverToken).toBe('tok-secret')
  })

  it('handles corrupt JSON gracefully', async () => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(join(tmpDir, 'notify-settings.json'), 'not valid json')
    const { loadNotifySettings } = await import('../src/notify-settings.js')
    const result = await loadNotifySettings(tmpDir)
    expect(result).toBeNull()
  })

  it('handles valid JSON that fails schema', async () => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(join(tmpDir, 'notify-settings.json'), JSON.stringify({ format: 'invalid-format' }))
    const { loadNotifySettings } = await import('../src/notify-settings.js')
    const result = await loadNotifySettings(tmpDir)
    expect(result).toBeNull()
  })
})
