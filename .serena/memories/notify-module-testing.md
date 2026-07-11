# Notify Module Testing Strategy

## Unit tests (tests/notify.test.ts — 20 tests)
Uses `vi.hoisted` + `vi.stubGlobal('fetch', mockFetch)` + `vi.resetModules()` pattern to control process.env before each dynamic import of the notify module.

### Coverage
- **eventForStatus**: pure function — 'red'→'red', 'green'→'finished', others→null
- **shouldNotify**: depends on NOTIFY_ON env var; tests with default, custom, and empty values
- **_buildPayload**: per-format payload shapes (generic, pushover, teams, slack, discord), extra headers, malformed JSON handling
- **notify**: no-op without URL, respects NOTIFY_ON filter, posts correct payload, silently swallows fetch rejections

## Server integration tests (tests/server.test.ts — 8 tests)
Mocks `notify` with `vi.mock('../src/notify.js')` while keeping real `eventForStatus`. Verifies:
- POST creates → 'started' fires
- POST status change to green → 'finished' fires
- POST status change to red → 'red' fires
- POST same status → no notification
- PATCH to green → 'finished' fires
- PATCH to red → 'red' fires
- PATCH same status → no notification
- Detail-only update → no notification

## E2E tests (e2e/webhook-notify.spec.ts — 7 tests)
Playwright config sets `NOTIFY_WEBHOOK_URL=http://127.0.0.1:19999/dead` (dead port) via `webServer.env`. Every E2E test implicitly proves fire-and-forget resilience. Dedicated tests verify:
- Session creation succeeds with dead webhook
- Status transitions (red, green) succeed with dead webhook
- Full lifecycle (create→red→green→delete) leaves no side-effects
- UI loads and renders correctly with notifications enabled
- Card updates after status change with notifications enabled
- No browser console errors from server-side notification failures

## Key testing concern
The notify module reads process.env at import time (module-level constants). Tests use `vi.resetModules()` + dynamic `import()` to get fresh module state with controlled env vars. The `mockFetch` must return a Promise (`.mockResolvedValue(new Response())`) because notify() chains `.catch()` on the fetch result.