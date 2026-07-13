import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Writes the current git branch/ref to dist/git-ref.txt.  The server reads
// this file at runtime (works even inside Docker where .git is absent).
//
// Strategy:
//   1. If we can detect the git branch → always write it (host build).
//   2. If we can't (Docker build) → keep whatever the host already wrote.

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
