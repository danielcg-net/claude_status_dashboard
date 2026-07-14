# Claude Status Dashboard — Architecture Overview

## Stack
- **Runtime**: Node.js + Hono (server), vanilla TypeScript (client, no framework)
- **Build**: `tsc` + `scripts/build-client.mjs` (esbuild)
- **Data source**: `ccusage` CLI (`node_modules/.bin/ccusage`) — reads `~/.claude/projects/**/*.jsonl`
- **Port**: `8787` (configurable via `PORT` env var)

## Key files
| File | Purpose |
|------|---------|
| `src/server.ts` | Hono HTTP server, usage cache (30s TTL via `USAGE_CACHE_TTL_MS`) |
| `src/usage.ts` | Wraps ccusage CLI, parses JSON into typed `UsageSummary` |
| `src/domain.ts` | Session store — `registerSession`, `updateSession`, `deleteSession` |
| `src/client.ts` | All browser-side rendering logic (single compiled bundle) |

## Data flow
1. Claude Code hooks POST to `/api/sessions` to register/update sessions
2. Server calls `ccusage claude daily --instances --json` + `ccusage claude blocks --json`
3. `usage.ts` parses output into `UsageSummary { projects, activeBlock, blocks, totals }`
4. Client fetches `/api/usage` + `/api/sessions`, renders session cards and cost views

## Session ↔ Usage project matching (`client.ts`)
- `Session.usageProject` holds the ccusage project key (encoded path, e.g. `-Users-foo-Private-myrepo`)
- `buildProjectLookup` indexes projects by raw key AND `normalizeProjectKey(key)` (lowercased, non-alphanumeric → `-`)
- `projectCandidatesFor` tries `usageProject`, `session.id`, `session.name` — each raw + normalized
- `findUsageProjectUnfiltered` also has a suffix-match fallback

## Cost aggregation per session card
- `filterDaysBySessionTimeRange(session, days)` filters ccusage daily entries to the session's date range
- **IMPORTANT**: All date comparisons against ccusage day keys must use **UTC** — NOT local time
  - ccusage server process reports day keys in UTC (e.g. `2026-07-10`)
  - Users in UTC-negative timezones (e.g. MDT UTC-6) get local date `2026-07-09` → no match → $0.00
  - `utcDateString(date: Date): string` — single UTC formatting primitive (`date.toISOString().slice(0,10)`)
  - `parseUtcDateString(isoString: string): string | null` — safe parser; returns null on invalid input
  - `localIsoDate`, `utcIsoDate`, `utcDateOf` were all removed — do NOT reintroduce them
  - Fixed in PR #25 (`fix/session-cost-utc-date-mismatch`): session card cost, Today filter, N-day window
- `sumUsageDays` aggregates tokens + cost across the filtered days

## Known quirks
- Sessions with `usageProject` using underscores (e.g. `claude_status_dashboard`) are bridged to
  hyphenated ccusage keys via `normalizeProjectKey`
- `ccusage` computes `totalCost` from token counts × model pricing — no `costUSD` field needed in JSONL
  (Bedrock sessions lack `costUSD` but costs still appear via ccusage's own pricing calc)
