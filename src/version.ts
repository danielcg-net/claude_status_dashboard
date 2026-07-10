import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let cachedVersion: string | null = null

/** Returns the current version from package.json (cached in memory). */
export const getVersion = (): string => {
  if (cachedVersion !== null) return cachedVersion
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }
    cachedVersion = pkg.version
    return cachedVersion
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

  for (let i = 0; i < length; i++) {
    const aNum = aParts[i] ?? 0
    const bNum = bParts[i] ?? 0
    if (isNaN(aNum) || isNaN(bNum)) return 0
    if (aNum !== bNum) return aNum - bNum
  }

  return 0
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
