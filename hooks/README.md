# Claude Code Hook Samples

These hooks are intended for your global Claude Code user settings, so every repo reports into the local dashboard.

## Status Mapping

- `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`: `orange`
- `Notification`: `red`
- `Stop`, `SubagentStop`: `green`

The hook command reads Claude Code hook JSON from stdin and sends a `POST /api/sessions` request. The dashboard treats repeated `POST` calls with the same `session_id` as updates.

## Global Setup

Claude Code user settings live at:

```text
~/.claude/settings.json
```

Copy the `hooks` object from `hooks/settings.global.example.json` into that file, then replace:

```text
/absolute/path/to/claude_status_dashboard/hooks/claude-status-dashboard.sh
```

with this repo's actual script path.

For this checkout, that path is:

```text
/Users/ddecarvalhogomes/Private/claude_status_dashboard/hooks/claude-status-dashboard.sh
```

Make the hook executable:

```bash
chmod +x /Users/ddecarvalhogomes/Private/claude_status_dashboard/hooks/claude-status-dashboard.sh
```

Start the dashboard before using Claude Code:

```bash
docker compose up --build
```

## Configuration

The hook supports these optional environment variables:

```bash
export CLAUDE_STATUS_API_URL="http://localhost:8787"
export CLAUDE_STATUS_CURL_TIMEOUT="2"
export CLAUDE_STATUS_USAGE_PROJECT="-Users-you-Private-Projects-your-repo"
```

Normally you do not need `CLAUDE_STATUS_USAGE_PROJECT`. The hook derives it from the hook `cwd`, using the same path-like key style that `ccusage --instances` reports.

## Notes

The hook intentionally ignores dashboard API failures. Claude Code should not fail just because the local dashboard is not running.
