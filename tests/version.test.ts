import { describe, it, expect } from 'vitest'
import { compareVersions, getVersion } from '../src/version.js'

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('returns positive when a > b', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
  })

  it('returns negative when a < b', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0)
  })

  it('handles different segment counts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1', '1.0.0')).toBe(0)
    expect(compareVersions('0.2', '0.1.1')).toBeGreaterThan(0)
  })

  it('returns 0 for non-numeric versions', () => {
    expect(compareVersions('dev', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', 'unknown')).toBe(0)
  })
})

describe('getVersion', () => {
  it('returns a non-empty version string', () => {
    const version = getVersion()
    expect(typeof version).toBe('string')
    expect(version.length).toBeGreaterThan(0)
  })

  it('matches the package.json version format', () => {
    const version = getVersion()
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('is cached (returns the same value on repeated calls)', () => {
    const first = getVersion()
    const second = getVersion()
    expect(first).toBe(second)
  })
})
