# AGENTS.md

Instructions for coding agents working on this project (Claude Code, Codex, etc.).

## Git workflow

- **Never push directly to `main`.** All changes go through feature branches → PR → review → merge. Even trivial fixes, even docs. No exceptions.
- **Never reuse branch names.** Once a branch is merged and deleted, that name is dead. GitHub Actions silently skips workflow triggers for reused branch names. Always create a fresh, unique name (e.g. `feat/webhook-notify`, `fix/event-names`, `docs/pushover-setup`).
- **Branch naming:** use the conventional commit prefix as a slug — `feat/<thing>`, `fix/<thing>`, `docs/<thing>`, `chore/<thing>`.
- Always branch off an up-to-date `main`.
- For git operations: use local terminal commands (stage, commit, push). Only use GitHub MCP/API for remote-only operations (creating PRs, fetching comments).
- Always verify commits are clean before pushing — keep each PR focused.

## Secrets and credentials

- **Never put secrets in committed files.** No API tokens, no user keys, no passwords, no OAuth secrets — nothing that authenticates or authorizes. Not even as placeholders, not even in docs examples. If it grants access, it goes in `.env` (gitignored) or an environment variable set outside the repo.
- **The only committed env file is `.env.example`** — it contains commented-out variable names with no values, as documentation.
- **If a secret is accidentally committed and pushed, rotate it immediately.** Even if the branch is deleted, GitHub caches PR diffs and commits may be accessible. The secret is burned — revoke it and generate a new one.
- **Never ask the user for secrets unless strictly necessary.** If you must, remind them to put it in `.env`, never in a committed file.
- `compose.yml` uses `${VAR}` substitution — values come from `.env` at runtime, not from the committed file.

## Coding conventions

- **TypeScript everywhere** — backend (Hono/Node), frontend (Vanilla TS bundled to `public/assets/client.js`). TypeScript strict mode.
- **Use `??` for null/undefined defaults**, not `||`. The only exception is the `asNumber()` pattern in `src/usage.ts` where `||` is correct for ccusage field fallbacks.
- **Functional style** — prefer pure functions, immutable data, `readonly` types.
- **`createElement` helper** for DOM creation in `src/ui-dom.ts` — never `innerHTML`.

### Loop style

- **Prefer array methods over imperative loops.** Use `forEach`, `map`, `filter`,
  `reduce`, `find`, `some`, `every`, and `flatMap` instead of `for`, `for...of`,
  `for...in`, and `while`.
- **Use `Object.entries()`, `Object.values()`, `Object.keys()`** with array
  methods instead of `for...in`.
- **Use `Array.from()` with a mapping callback** instead of index-based loops
  (`for (let i = 0; ...)`).
- **Prefer `.find()` / `.some()` for early-exit search** over a `for...of` loop
  with `break` or `return`.
- **Use `.reduce()` for accumulation patterns** — building Maps, summing fields,
  merging objects — instead of a `for...of` with a mutable accumulator.
- **Rare exceptions**: tight performance-sensitive loops (profile first), or
  async iteration where Promise-based alternatives would be less readable.
  When you use an exception, add a comment explaining why.
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
- **Tests never touch `./data`.** `vitest.config.ts` pins `DATA_DIR` to
  `.test-data/unit`, because `tests/server.test.ts` drives the real app and its
  mutations persist — on the default it would overwrite the sessions and
  notification settings of a dashboard running from this checkout.

### E2E tests (Playwright)

- `e2e/dashboard.spec.ts` — smoke tests against running server
- Run: `npm run test:e2e` (build + test)
- Playwright config starts `node dist/server.js` via `webServer` on port **8788**
  with `DATA_DIR=.test-data/e2e` — never 8787 or `./data`, so a real dashboard
  running locally is left alone. Override with `E2E_PORT` / `E2E_DATA_DIR`
  (the data dir must stay under `.test-data/`; `scripts/test-data-dirs.mjs`
  refuses anything else).
- `reuseExistingServer` is `false`: reusing a server would discard that isolated
  environment, since it only applies to a server this config launches.
- The stale-state wipe runs in the `webServer` command, not a setup hook —
  Playwright boots the server before `globalSetup`, so a hook would delete the
  directory only after the server had loaded the previous run's sessions.
- Follow `playwright-best-practices` and `playwright-page-objects` skills

## Versioning

- **Every PR must bump the version** in `package.json` following [semver](https://semver.org/). CI blocks merging if the version hasn't changed.
  - **MAJOR** (`1.0.0`): breaking changes to the API, dashboard behavior, or hook configuration format.
  - **MINOR** (`0.1.0`): new features, new hook events, new dashboard capabilities.
  - **PATCH** (`0.0.1`): bug fixes, documentation, internal refactors, CI changes.
- The version is read at runtime by `src/version.ts` (server) and embedded at build time by `scripts/build-client.mjs` (frontend `__VERSION__`).
- When bumping `package.json`, also bump the version in `claude-code-plugin/claude-status-dashboard/.claude-plugin/plugin.json` to match. CI validates they stay in sync.
- On merge to `main`, the [Release workflow](.github/workflows/release.yml) auto-creates a tag and GitHub Release from the new version.

## PR process

1. Branch off `main`, implement changes with tests
2. **Bump the version** in `package.json` (semver) and `claude-code-plugin/claude-status-dashboard/.claude-plugin/plugin.json`
3. Run `npm test` and `npm run build` locally before pushing
4. Push, create PR — DeepSeek Code Review runs automatically
5. Invoke `/post-pr-review` to loop through findings
6. Merge when CI is green and all comments resolved
7. Required CI: Version bump check, Type check + unit tests, DeepSeek CR
8. When merged, the Release workflow auto-creates a GitHub Release with release notes (see below)

## Releases

Releases are created automatically when a PR is merged to `main`. The [Release workflow](.github/workflows/release.yml) reads the version from `package.json`, creates a matching `vX.Y.Z` tag, and publishes a GitHub Release with auto-generated release notes.

### How release notes are generated

GitHub auto-generates release notes from the PRs merged since the last release. To make these notes useful:

- **Write PR descriptions that work as changelog entries.** The PR description becomes the release-note bullet point. Start with a one-sentence summary, then add details. Avoid references to internal review comments or CI — describe the change from the user's perspective.
- **Label every PR** with one of: `feature` / `enhancement`, `fix` / `bug`, `documentation` / `docs`, `chore` / `maintenance` / `refactor` / `ci`, or `breaking` / `breaking-change`. Labels control which category the PR appears under in the release notes (see [`.github/release.yml`](.github/release.yml)).
- **First release after a dry spell?** GitHub's auto-generation covers all PRs since the last tag — there's nothing special to do.

### Manual release

If the automatic workflow fails or you need to re-create a release:

```bash
gh release create v$(node -p "require('./package.json').version") \
  --generate-notes \
  --title "v$(node -p "require('./package.json').version")"
```

To edit release notes after creation, go to the [Releases page](https://github.com/danielcg-net/claude_status_dashboard/releases) and click "Edit release."

## Runtime notes

- Server port: 8787 (configurable via `PORT` env var)
- Usage cache TTL: 30s (configurable via `USAGE_CACHE_TTL_MS`)
- Red alert threshold: 300s (configurable via `RED_ALERT_AFTER_MS`)
