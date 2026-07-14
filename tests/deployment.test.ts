import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoist mocks before module import
const { __resetDeploymentCache, detectDeployment } = await vi.hoisted(async () => {
  const mod = await vi.importActual<typeof import('../src/deployment.js')>('../src/deployment.js')
  return mod
})

// Re-import after hoisting for test access
const deploymentMod = await import('../src/deployment.js')
const detect = deploymentMod.detectDeployment
const resetCache = deploymentMod.__resetDeploymentCache

describe('detectDeployment', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.DATA_DIR
    vi.resetModules()
    resetCache()
  })

  it('detects npm mode by default', () => {
    const result = detect()
    expect(result.mode).toBe('npm')
  })

  it('detects docker mode when CLAUDE_CONFIG_DIR is /claude', () => {
    process.env.CLAUDE_CONFIG_DIR = '/claude'
    const result = detect()
    expect(result.mode).toBe('docker')
  })

  it('detects docker mode when DATA_DIR is /data', () => {
    process.env.DATA_DIR = '/data'
    const result = detect()
    expect(result.mode).toBe('docker')
  })

  it('caches the result on first call', () => {
    process.env.CLAUDE_CONFIG_DIR = '/claude'
    const first = detect()
    process.env.CLAUDE_CONFIG_DIR = '/not-claude'
    const second = detect()
    expect(first.mode).toBe('docker')
    expect(second.mode).toBe('docker') // cached
  })
})
