# Claude Status Dashboard

Local-only web dashboard for tracking Claude Code sessions. Claude Code hooks can register sessions and push status changes to the API exposed by the Docker container.

The dashboard also reads Claude Code usage through [`ccusage`](https://www.npmjs.com/package/ccusage) and displays cost/token totals when Claude logs are available.

## Statuses

- `green`: Claude has finished running something.
- `orange`: Claude is thinking and doing stuff.
- `red`: Claude is paused waiting for an approval or decision.

## Run With Docker Compose

```bash
docker compose up --build
```

Open [http://localhost:8787](http://localhost:8787).

The app stores session state in memory. Restarting the container clears the dashboard.

By default, Compose mounts your host Claude Code config directory into the container:

```yaml
volumes:
  - "${HOME}/.claude:/claude:ro"
environment:
  CLAUDE_CONFIG_DIR: "/claude"
```

If your Claude Code logs live somewhere else, change the volume source and keep `CLAUDE_CONFIG_DIR` pointed at the mounted path.

## API

Read `ccusage` totals:

```bash
curl http://localhost:8787/api/usage
```

Register or update a session:

```bash
curl -X POST http://localhost:8787/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"id":"repo-main","name":"BizYeet main worktree","usageProject":"-Users-you-Private-Projects-bizyeet","status":"orange","detail":"Claude is running tests"}'
```

Set a session status:

```bash
curl -X PATCH http://localhost:8787/api/sessions/repo-main \
  -H 'Content-Type: application/json' \
  -d '{"status":"red","detail":"Waiting for tool approval"}'
```

`usageProject` is optional. When present, the dashboard uses it to match the card to `ccusage daily --instances --json` project totals and display session cost on the card. If omitted, the browser tries to match the card `id` or `name` against the ccusage project key.

To see available project keys:

```bash
npx ccusage claude daily --instances --json
```

List sessions:

```bash
curl http://localhost:8787/api/sessions
```

Delete a session:

```bash
curl -X DELETE http://localhost:8787/api/sessions/repo-main
```

## Claude Code Hook Shape

Sample global Claude Code hooks live in [hooks/](hooks/README.md).

Yes, these can be configured globally in `~/.claude/settings.json`; they do not need to be installed per repo. The sample hook reads Claude Code's hook JSON from stdin and updates the dashboard by `session_id`.

Status mapping:

- `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`: `orange`
- `Notification`: `red`
- `Stop`, `SubagentStop`: `green`

## Claude Code Plugin

A Claude Code plugin package lives in [claude-code-plugin/claude-status-dashboard](claude-code-plugin/claude-status-dashboard/README.md). It bundles the same hook behavior with a `.claude-plugin/plugin.json` manifest and plugin `hooks/hooks.json`.

Local install:

```bash
claude plugin marketplace add /Users/ddecarvalhogomes/Private/claude_status_dashboard/claude-code-plugin --scope user
claude plugin install claude-status-dashboard@claude-status-dashboard --scope user
```

Publish install after this repo exists on GitHub:

```bash
claude plugin marketplace add danielcg-net/claude_status_dashboard --sparse claude-code-plugin --scope user
claude plugin install claude-status-dashboard@claude-status-dashboard --scope user
```

## Red Alert Beeps

The browser can emit a quiet beep when any card remains `red` longer than `RED_ALERT_AFTER_MS`.

Browsers require a user gesture before audio can play, so click `Enable beeps` after opening the page.

Configure the threshold in `compose.yml`:

```yaml
environment:
  RED_ALERT_AFTER_MS: "300000"
```

## ccusage

Usage metrics are refreshed through the server every `USAGE_CACHE_TTL_MS` milliseconds. The browser polls `/api/usage` every 30 seconds.

The app runs:

```bash
ccusage claude daily --json
ccusage claude daily --instances --json
ccusage claude blocks --json
```

If the installed `ccusage` version does not support the agent subcommand form, the adapter falls back to:

```bash
ccusage daily --json
ccusage daily --instances --json
ccusage blocks --json
```

If the usage panel says data is unavailable, check that the container can read Claude logs and that `CLAUDE_CONFIG_DIR` points to the mounted directory.

Each session card displays cost/tokens from the matched `ccusage --instances` project. The timeframe selector defaults to today and supports 2, 3, 7, 14, 30, 90 days, or all history. Cost summaries are always tied to the selected timeframe; cards also show the most recent non-zero daily costs for that window.

For the cleanest match, send `usageProject` from your hook using the exact project key reported by `ccusage`.

## Local Development

```bash
npm install
npm run dev
```

Then open [http://localhost:8787](http://localhost:8787).

## Publish Target

This repository is published at [danielcg-net/claude_status_dashboard](https://github.com/danielcg-net/claude_status_dashboard).
