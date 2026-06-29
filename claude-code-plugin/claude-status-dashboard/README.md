# Claude Status Dashboard Plugin

Claude Code plugin that reports lifecycle events to a local Claude Status Dashboard.

## What It Does

The plugin registers hooks for:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Notification`
- `Stop`
- `SubagentStop`

Status mapping:

- `SessionStart`, `UserPromptSubmit`: `yellow` (idle at prompt)
- `PreToolUse`, `PostToolUse`: `orange` (actively working)
- `Notification`: `red` (needs attention)
- `Stop`, `SubagentStop`: `green` (finished)

The hook sends `POST /api/sessions` to the dashboard. Repeated posts for the same Claude Code `session_id` update the same card.

## Requirements

- Local dashboard running at `http://localhost:8787`
- `node`
- `curl`

The hook intentionally ignores API failures so Claude Code keeps working when the dashboard is not running.

## Configuration

Optional environment variables:

```bash
export CLAUDE_STATUS_API_URL="http://localhost:8787"
export CLAUDE_STATUS_CURL_TIMEOUT="2"
export CLAUDE_STATUS_USAGE_PROJECT="-Users-username-Private-Projects-your-repo"
```

Normally you do not need `CLAUDE_STATUS_USAGE_PROJECT`. The hook derives `usageProject` from Claude Code's hook `cwd`, matching the path-like key style used by `ccusage daily --instances --json`.

## Local Validation

From this plugin directory:

```bash
claude plugin validate ./claude-code-plugin/claude-status-dashboard
```

## Install

This repo includes a local Claude Code marketplace at:

```text
./claude-code-plugin
```

Add it to Claude Code and install the plugin globally:

```bash
claude plugin marketplace add ./claude-code-plugin --scope user
claude plugin install claude-status-dashboard@claude-status-dashboard --scope user
```

Check install status:

```bash
claude plugin list
claude plugin details claude-status-dashboard
```

Start the dashboard before using Claude Code:

```bash
docker compose up --build
```

## Updating

After pulling new changes from the repository, the plugin cache still has the old hook script. Update it by reinstalling:

```bash
claude plugin uninstall claude-status-dashboard --scope user
claude plugin install claude-status-dashboard@claude-status-dashboard --scope user
```

Or copy the updated script directly:

```bash
cp claude-code-plugin/claude-status-dashboard/scripts/claude-status-dashboard-hook.sh \
  ~/.claude/plugins/cache/claude-status-dashboard/claude-status-dashboard/0.1.0/scripts/claude-status-dashboard-hook.sh
```

## Publish

After publishing this repository, users can add the GitHub repo as a marketplace. Because this repo stores the marketplace under `claude-code-plugin`, use sparse checkout:

```bash
claude plugin marketplace add danielcg-net/claude_status_dashboard --sparse claude-code-plugin --scope user
claude plugin install claude-status-dashboard@claude-status-dashboard --scope user
```
