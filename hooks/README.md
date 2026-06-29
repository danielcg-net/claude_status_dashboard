# Claude Code Hook Samples

These hooks are intended for your global Claude Code user settings, so every repo reports into the local dashboard.

## Status Mapping

- `SessionStart`, `UserPromptSubmit`: `yellow` (idle at prompt)
- `PreToolUse`, `PostToolUse`: `orange` (actively working)
- `Notification`: `red` (needs attention)
- `Stop`, `SubagentStop`: `green` (finished)

The hook command reads Claude Code hook JSON from stdin and sends a `POST /api/sessions` request. The dashboard treats repeated `POST` calls with the same `session_id` as updates.

## Global Setup

Claude Code user settings live at:

```text
~/.claude/settings.json
```

Copy the `hooks` object from `hooks/settings.global.example.json` into that file, then replace `{{REPO_ROOT}}` with this repo's actual absolute path.

For example, if this repo is cloned to `/home/user/claude_status_dashboard`:

```text
/home/user/claude_status_dashboard/hooks/claude-status-dashboard.sh
```

Make the hook executable:

```bash
chmod +x /home/user/claude_status_dashboard/hooks/claude-status-dashboard.sh
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
export CLAUDE_STATUS_USAGE_PROJECT="my-project"
```

Normally you do not need `CLAUDE_STATUS_USAGE_PROJECT`. The hook derives it from the last directory of the hook `cwd` (e.g., `bizyeet` from `/Users/you/Private/Projects/bizyeet`). The dashboard's fuzzy matcher will find the matching ccusage project.

## Notes

The hook intentionally ignores dashboard API failures. Claude Code should not fail just because the local dashboard is not running.
