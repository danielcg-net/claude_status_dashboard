import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Writes the current git branch/ref to dist/git-ref.txt.  The server reads
// this file at runtime (works even inside Docker where .git is absent).
//
// Strategy:
//   1. If the GIT_REF env var is set (e.g. via Docker build arg), use it.
//   2. If we can detect the git branch → always write it (host build).
//   3. If we can't (Docker build, no env var) → keep whatever already exists.
//   4. Fall back to 'main'.

// Docker build passes GIT_REF as a build arg; use it directly.
const envRef = process.env.GIT_REF?.trim()
if (envRef) {
  writeFileSync('dist/git-ref.txt', `${envRef}\n`, 'utf-8')
  console.log(`git-ref: ${envRef} (from GIT_REF env)`)
  process.exit(0)
}

try {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()

  if (branch && branch !== 'HEAD') {
    writeFileSync('dist/git-ref.txt', `${branch}\n`, 'utf-8')
    console.log(`git-ref: ${branch}`)
    process.exit(0)
  }
} catch {
  // git not available — fall through to preserve-existing logic
}

// Inside Docker (no .git): keep the host-written file if it exists.
if (existsSync('dist/git-ref.txt')) {
  const existing = readFileSync('dist/git-ref.txt', 'utf-8').trim()
  if (existing) {
    console.log(`git-ref: ${existing} (preserved)`)
    process.exit(0)
  }
}

// Last resort
writeFileSync('dist/git-ref.txt', 'main\n', 'utf-8')
console.log('git-ref: main (fallback)')
