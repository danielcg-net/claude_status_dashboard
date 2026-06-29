#!/usr/bin/env bash
set -euo pipefail

api_url="${CLAUDE_STATUS_API_URL:-http://localhost:8787}"
curl_timeout="${CLAUDE_STATUS_CURL_TIMEOUT:-2}"
hook_input="$(cat)"

payload="$(
  HOOK_INPUT="$hook_input" node <<'NODE'
const path = require('node:path')
const fs = require('node:fs')

const inputText = process.env.HOOK_INPUT || ''
const input = inputText ? JSON.parse(inputText) : {}

const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
const findGitRoot = (start) => {
  let current = path.resolve(start)
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}
const projectRoot = findGitRoot(cwd) || cwd
const event = input.hook_event_name || 'Unknown'
const sessionId = input.session_id || cwd
const sessionShort = String(sessionId).slice(0, 8)
const projectName = path.basename(projectRoot) || projectRoot
const toolName = typeof input.tool_name === 'string' ? input.tool_name : ''
const reason = typeof input.reason === 'string' ? input.reason : ''

const usageProject =
  process.env.CLAUDE_STATUS_USAGE_PROJECT ||
  String(projectRoot).replace(/[^A-Za-z0-9._-]/g, '-')

const detailFor = () => {
  if (event === 'SessionStart') return 'Claude Code session started'
  if (event === 'UserPromptSubmit') return 'User submitted a prompt'
  if (event === 'PreToolUse' && toolName) return `Claude is about to use ${toolName}`
  if (event === 'PostToolUse' && toolName) return `Claude used ${toolName}`
  if (event === 'Notification') return 'Claude needs attention'
  if (event === 'Stop') return reason ? `Claude stopped: ${reason}` : 'Claude finished running'
  if (event === 'StopFailure') return reason ? `Claude stopped with error: ${reason}` : 'Claude stopped with an error'
  if (event === 'SubagentStop') return reason ? `Subagent stopped: ${reason}` : 'Subagent finished running'
  return `Claude event: ${event}`
}

const statusFor = () => {
  if (event === 'Notification') return 'red'
  if (event === 'Stop' || event === 'SubagentStop') return 'green'
  if (event === 'StopFailure') return 'red'
  if (event === 'SessionStart' || event === 'UserPromptSubmit') return 'yellow'
  return 'orange'
}

const payload = {
  id: String(sessionId),
  name: `${projectName} (${sessionShort})`,
  usageProject,
  status: statusFor(),
  detail: detailFor(),
}

process.stdout.write(JSON.stringify(payload))
NODE
)"

curl \
  --fail \
  --silent \
  --max-time "$curl_timeout" \
  --request POST \
  "$api_url/api/sessions" \
  --header 'Content-Type: application/json' \
  --data "$payload" >/dev/null 2>&1 || true
