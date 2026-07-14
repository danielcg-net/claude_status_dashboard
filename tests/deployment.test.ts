import { describe, it, expect, beforeEach } from 'vitest'
import { detectDeployment as detect, __resetDeploymentCache as resetCache } from '../src/deployment.js'

describe('detectDeployment', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.DATA_DIR
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
