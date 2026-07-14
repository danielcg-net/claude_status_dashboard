import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const versionCache = { value: null as string | null }

/** Returns the current version from package.json (cached in memory). */
export const getVersion = (): string => {
  if (versionCache.value !== null) return versionCache.value
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }
    versionCache.value = pkg.version
    return versionCache.value
  } catch {
    return '0.0.0'
  }
}

/**
 * Compares two semver strings (e.g. "0.1.0" vs "0.2.0").
 * Returns negative if a < b, zero if equal, positive if a > b.
 * Segments are compared numerically; missing segments treated as 0.
 */
export const compareVersions = (a: string, b: string): number => {
  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)
  const length = Math.max(aParts.length, bParts.length)

  const firstDiff = Array.from({ length }, (_, i) => {
    const aNum = aParts[i] ?? 0
    const bNum = bParts[i] ?? 0
    if (isNaN(aNum) || isNaN(bNum)) return 0
    return aNum - bNum
  }).find((d) => d !== 0)
  return firstDiff ?? 0
}

/** Fetches a package.json URL and extracts the version field. Returns null on any error. */
export const checkLatestVersion = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    const pkg = (await response.json()) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}
