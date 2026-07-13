import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// Writes the current git branch/ref to a file that gets included in Docker
// builds, so the server can auto-detect the hooks source even without .git.

let ref = 'main'
try {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()

  // Only use branch name if it's not "HEAD" (detached) and not empty
  if (branch && branch !== 'HEAD') {
    ref = branch
  }
} catch {
  // Not in a git repo or git not available — use 'main'
}

writeFileSync('dist/git-ref.txt', `${ref}\n`, 'utf-8')
console.log(`git-ref: ${ref}`)
