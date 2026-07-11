# Webhook Notification Architecture

## Overview
The dashboard fires outbound webhooks on session lifecycle events. Configured via env vars in `compose.yml`, the notify module (`src/notify.ts`) builds per-service payloads and POSTs them to the configured URL. All calls are fire-and-forget — failures are silently swallowed so the API stays fast.

## Supported formats (NOTIFY_FORMAT)
- **pushover** — Pushover API (`{token, user, title, message, priority}`). Priority 1 for red alerts, 0 otherwise.
- **teams** — Office 365 MessageCard with theme colors and facts table.
- **slack** — mrkdwn blocks with emoji indicators.
- **discord** — Discord embed with colored sidebar per event.
- **generic** — Raw JSON: `{event, timestamp, session: {id, name, status, detail, usageProject}}`. For Zapier/Make/n8n/IFTTT.

## Event types (NOTIFY_ON)
- `started` — new session registered (POST without existing id)
- `finished` — status transitions to green (Claude finished)
- `idle` — status transitions to yellow (waiting for input)
- `working` — status transitions to orange (actively working)
- `attention` — status transitions to red (needs attention)).

## Key env vars
- NOTIFY_WEBHOOK_URL — required to enable; URL to POST to
- NOTIFY_FORMAT — defaults to 'generic'
- NOTIFY_ON — defaults to 'started,finished,red'; comma-separated
- NOTIFY_HEADERS — JSON object string for extra HTTP headers
- NOTIFY_PUSHOVER_TOKEN / NOTIFY_PUSHOVER_USER — pushover-specific

## Wiring in server.ts
- POST /api/sessions: checks if session is new (`!previous`) → 'started'; if existing with status change → uses eventForStatus()
- PATCH /api/sessions/:id: checks previous.status !== session.status → uses eventForStatus()
- eventForStatus(): 'red' → 'red', 'green' → 'finished', others → null
- Same-status updates do NOT fire notifications.

## Fire-and-forget pattern
notify() calls fetch() without await. The .catch(() => {}) handler swallows all errors. The API returns before the webhook completes, so slow webhook targets never impact dashboard responsiveness.

## Apple Watch
Pushover ($5 one-time) is the recommended path. Install the iOS app, grab user key + app token, set NOTIFY_FORMAT=pushover. Apple Watch mirrors iPhone notifications automatically. ntfy.sh is the free alternative.

## Docs
Full setup guides for Apple Watch, Slack, Teams, Discord, and generic webhook platforms are in `WEBHOOK.md`.