import { existsSync } from 'node:fs'

export type DeploymentInfo = {
  readonly mode: 'npm' | 'docker'
}

const cache = { value: null as DeploymentInfo | null }

/** Detects whether the server is running inside Docker or via npm/npx.
 *  Result is cached — deployment mode cannot change at runtime. */
export const detectDeployment = (): DeploymentInfo => {
  if (cache.value !== null) return cache.value

  const isDocker =
    process.env.CLAUDE_CONFIG_DIR === '/claude' ||
    process.env.DATA_DIR === '/data' ||
    existsSync('/.dockerenv')

  cache.value = { mode: isDocker ? 'docker' : 'npm' }
  return cache.value
}

/** Resets the cached detection (for tests). */
export const __resetDeploymentCache = (): void => {
  cache.value = null
}
