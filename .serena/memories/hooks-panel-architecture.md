# Hooks Panel Architecture

## What it does
The Hooks panel is a floating settings overlay in the dashboard header (alongside Beeps and Notifications) that manages Claude Code lifecycle hook configuration. It inspects, installs, and deletes hook entries in `~/.claude/settings.json` or project `.claude/settings.json`.

## Key files
- `src/hook-settings.ts` — Backend: Zod schemas, `detectHookStatus()`, `installHooks()`, `deleteHooks()`, `downloadHookScript()`. Downloads the hook script from the GitHub release corresponding to the dashboard's version tag.
- `src/client.ts` — Frontend: `buildHooksPanel()`, `syncHooksPanelFields()`, `attachHooksPanelEvents()`, `showToast()`. Follows the exact same pattern as `buildBeepPanel()` / `buildNotifyPanel()`.
- `src/server.ts` — API routes: `GET /api/settings/hooks` (status), `PUT /api/settings/hooks` (install/delete via `{ action, scope }` body).
- `public/assets/styles.css` — `.alert-controls__hooks-panel`, `.hooks-panel__*`, `.toast` styles.
- `compose.yml` — Mounts `~/.claude-status-dashboard` volume, passes `HOME` env var for correct path resolution.

## Patterns to follow
- All settings panels use the same lifecycle: `build*Panel(s)` returns DOM, `sync*PanelFields(panel, s)` updates live, `attach*PanelEvents()` wires handlers once.
- Panel visibility is managed by `syncAlertControlsInPlace()` which creates/removes panel DOM elements based on `state.*Open` booleans.
- Settings persistence uses atomic writes (`.tmp` + `rename()`) in `src/*-settings.ts` modules.
- The `createElement()` helper builds all DOM — no JSX, no templates.
- E2E tests in `e2e/hooks-settings.spec.ts` use `CI=true PORT=8788` to avoid Docker port conflicts.

## Detection logic
`checkClaudeSettingsForHooks()` walks the settings.json `hooks` key looking for any hook command that references `claude-status-dashboard.sh` (or `claude-status-dashboard-hook.sh`). This catches both manual installs (all 10 events) and minimal installs (e.g. just SessionStart + Stop).

## Docker considerations
- `CLAUDE_CONFIG_DIR=/claude` maps host's `~/.claude` into the container.
- `HOME` must be passed so `userHome()` resolves to the actual user's home, not `/root`.
- The `.claude` volume must be writable (not `:ro`) for the hooks panel to modify settings.json.
