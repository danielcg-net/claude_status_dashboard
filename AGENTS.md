# AGENTS.md

Instructions for coding agents working on this project (Claude Code, Codex, etc.).

## Git workflow

- Do not code directly in `main`. Always create a feature branch from an up-to-date `main`.
- Always open pull requests for feature branches — never commit or push to `main`.
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

## PR process

1. Branch off `main`, implement changes with tests
2. Run `npm test` and `npm run build` locally before pushing
3. Push, create PR — DeepSeek Code Review runs automatically
4. Invoke `/post-pr-review` to loop through findings
5. Merge when CI is green and all comments resolved
6. Required CI: Type check + unit tests, DeepSeek CR

## Runtime notes

- Server port: 8787 (configurable via `PORT` env var)
- Usage cache TTL: 30s (configurable via `USAGE_CACHE_TTL_MS`)
- Red alert threshold: 300s (configurable via `RED_ALERT_AFTER_MS`)
