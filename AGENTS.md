# AGENTS.md

Instructions for coding agents working on this project (Claude Code, Codex, etc.).

## Git workflow

- **Never push directly to `main`.** All changes go through feature branches → PR → review → merge. Even trivial fixes, even docs. No exceptions.
- **Never reuse branch names.** Once a branch is merged and deleted, that name is dead. GitHub Actions silently skips workflow triggers for reused branch names. Always create a fresh, unique name (e.g. `feat/webhook-notify`, `fix/event-names`, `docs/pushover-setup`).
- **Branch naming:** use the conventional commit prefix as a slug — `feat/<thing>`, `fix/<thing>`, `docs/<thing>`, `chore/<thing>`.
- Always branch off an up-to-date `main`.
- For git operations: use local terminal commands (stage, commit, push). Only use GitHub MCP/API for remote-only operations (creating PRs, fetching comments).
- Always verify commits are clean before pushing — keep each PR focused.

## Coding conventions

- **TypeScript everywhere** — backend (Hono/Node), frontend (Vanilla TS bundled to `public/assets/client.js`). TypeScript strict mode.
- **Use `??` for null/undefined defaults**, not `||`. The only exception is the `asNumber()` pattern in `src/usage.ts` where `||` is correct for ccusage field fallbacks.
- **Functional style** — prefer pure functions, immutable data, `readonly` types.
- **`createElement` helper** for DOM creation in `src/client.ts` — never `innerHTML`.
- **CSS custom properties** from `:root` only, dark theme.
- **Zod schemas** in `src/domain.ts` for API input validation.
- **ccusage parsing** in `src/usage.ts` handles nested `tokenCounts`, `costUSD`/`totalCost` fallbacks, agent subcommand fallback.

## Project structure

| Path | Purpose |
|------|---------|
| `src/server.ts` | Hono HTTP server, API routes |
| `src/domain.ts` | Session types, Zod schemas, state logic |
| `src/usage.ts` | ccusage integration, usage parsing |
| `src/client.ts` | Vanilla TypeScript frontend (bundled) |
| `public/assets/styles.css` | Dark theme CSS |
| `hooks/` | Claude Code hook scripts |
| `tests/` | Vitest unit + integration tests |
| `e2e/` | Playwright E2E tests |

## Testing

### Unit & integration tests (Vitest)

- `tests/domain.test.ts` — session state machine
- `tests/usage.test.ts` — ccusage JSON parsing, edge cases, fallbacks
- `tests/server.test.ts` — HTTP endpoints via Hono `app.request()`
- `tests/client-utils.test.ts` — pure utility functions
- Run: `npm test` (all), `npx vitest run <file>` (single file)

### E2E tests (Playwright)

- `e2e/dashboard.spec.ts` — smoke tests against running server
- Run: `npm run test:e2e` (build + test)
- Playwright config starts `node dist/server.js` via `webServer`
- Follow `playwright-best-practices` and `playwright-page-objects` skills

## Versioning

- **Every PR must bump the version** in `package.json` following [semver](https://semver.org/). CI blocks merging if the version hasn't changed.
  - **MAJOR** (`1.0.0`): breaking changes to the API, dashboard behavior, or hook configuration format.
  - **MINOR** (`0.1.0`): new features, new hook events, new dashboard capabilities.
  - **PATCH** (`0.0.1`): bug fixes, documentation, internal refactors, CI changes.
- The version is read at runtime by `src/version.ts` (server) and embedded at build time by `scripts/build-client.mjs` (frontend `__VERSION__`).
- When bumping `package.json`, also bump the version in `claude-code-plugin/claude-status-dashboard/.claude-plugin/plugin.json` to match. CI validates they stay in sync.

## PR process

1. Branch off `main`, implement changes with tests
2. **Bump the version** in `package.json` (semver) and `claude-code-plugin/claude-status-dashboard/.claude-plugin/plugin.json`
3. Run `npm test` and `npm run build` locally before pushing
4. Push, create PR — DeepSeek Code Review runs automatically
5. Invoke `/post-pr-review` to loop through findings
6. Merge when CI is green and all comments resolved
7. Required CI: Version bump check, Type check + unit tests, DeepSeek CR

## Runtime notes

- Server port: 8787 (configurable via `PORT` env var)
- Usage cache TTL: 30s (configurable via `USAGE_CACHE_TTL_MS`)
- Red alert threshold: 300s (configurable via `RED_ALERT_AFTER_MS`)
