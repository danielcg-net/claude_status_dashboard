#!/usr/bin/env node
// Claude Status Dashboard CLI — start the server
// Usage: npx claude-status-dashboard  OR  claude-status-dashboard (global install)
import { fileURLToPath } from 'node:url'

// Set argv[1] to the resolved server path so the isMain check in server.ts
// works without modification (it checks for process.argv[1]?.endsWith('server.js')).
const serverPath = fileURLToPath(new URL('../dist/server.js', import.meta.url))
process.argv[1] = serverPath

await import(serverPath)
