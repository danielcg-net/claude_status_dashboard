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

- `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`: `orange`
- `Notification`: `red`
- `Stop`, `SubagentStop`: `green`

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
export CLAUDE_STATUS_USAGE_PROJECT="-Users-you-Private-Projects-your-repo"
```

Normally you do not need `CLAUDE_STATUS_USAGE_PROJECT`. The hook derives `usageProject` from Claude Code's hook `cwd`, matching the path-like key style used by `ccusage daily --instances --json`.

## Local Validation

From this plugin directory:

```bash
claude plugin validate /Users/ddecarvalhogomes/Private/claude_status_dashboard/claude-code-plugin/claude-status-dashboard
```

## Install

This repo includes a local Claude Code marketplace at:

```text
/Users/ddecarvalhogomes/Private/claude_status_dashboard/claude-code-plugin
```

Add it to Claude Code and install the plugin globally:

```bash
claude plugin marketplace add /Users/ddecarvalhogomes/Private/claude_status_dashboard/claude-code-plugin --scope user
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

## Publish

After publishing this repository, users can add the GitHub repo as a marketplace. Because this repo stores the marketplace under `claude-code-plugin`, use sparse checkout:

```bash
claude plugin marketplace add danielcg-net/claude-status-dashboard --sparse claude-code-plugin --scope user
claude plugin install claude-status-dashboard@claude-status-dashboard --scope user
```
