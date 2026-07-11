# Webhook Notifications

Get pinged on your Apple Watch, phone, Slack, Teams, or anywhere else when
Claude needs your attention. The dashboard fires an outbound webhook on session
lifecycle events and you choose where it lands.

## Quick reference

| Variable | Default | Description |
|---|---|---|
| `NOTIFY_WEBHOOK_URL` | _(none)_ | URL to POST to. **Required** to enable notifications. |
| `NOTIFY_FORMAT` | `generic` | `generic` \| `pushover` \| `teams` \| `slack` \| `discord` |
| `NOTIFY_ON` | `started,finished,idle,working,attention` | Comma-separated (see below) |
| `NOTIFY_HEADERS` | _(none)_ | Extra HTTP headers as a JSON string |
| `NOTIFY_PUSHOVER_TOKEN` | _(none)_ | Pushover app token |
| `NOTIFY_PUSHOVER_USER` | _(none)_ | Pushover user key |

## Event types

Events are named after what's happening, not colors:

| Event | Status | Fires when |
|-------|--------|-----------|
| `started` | — | A new Claude Code session registers for the first time |
| `finished` | 🟢 green | Claude finished running |
| `idle` | 🟡 yellow | Idle — waiting for your input |
| `working` | 🟠 orange | Actively thinking or using tools |
| `attention` | 🔴 red | Needs your approval or attention |

All five are on by default. Set `NOTIFY_ON=attention` if you only want alerts.
To get notified when Claude is waiting for you: `NOTIFY_ON=idle,attention`.

## Enabling notifications

Uncomment and set the variables under `environment` in `compose.yml`, then
rebuild:

```bash
docker compose up -d --build
```

---

## Apple Watch

Apple Watch mirrors notifications from your iPhone apps. There's no direct
"webhook → Watch" path, but these two services bridge that gap with a trivial
HTTP API and a native iOS app.

### Option A: Pushover (recommended)

[Pushover](https://pushover.net) is a dedicated push notification service with
a native Apple Watch app. **$5 one-time purchase** (no subscription).

**Setup (5 minutes):**

1. Buy Pushover at [pushover.net](https://pushover.net) (or try the 7-day free
   trial on the iOS app).
2. Install the [Pushover iOS app](https://apps.apple.com/us/app/pushover-notifications/id506088175).
   Notifications will automatically appear on your Apple Watch — no extra setup.
3. Log in at [pushover.net](https://pushover.net) and copy your **User Key**
   (a 30-char string like `uXyZ99...`).
4. Go to [pushover.net/apps/build](https://pushover.net/apps/build), give your
   app a name (e.g. "Claude Dashboard"), and copy the **API Token/Key**
   (a 30-char string like `a1b2c3...`).

**compose.yml:**

```yaml
environment:
  NOTIFY_WEBHOOK_URL: "https://api.pushover.net/1/messages.json"
  NOTIFY_FORMAT: "pushover"
  NOTIFY_ON: "attention"
  NOTIFY_PUSHOVER_TOKEN: "a1b2c3-your-app-token"
  NOTIFY_PUSHOVER_USER: "uXyZ99-your-user-key"
```

Red alerts get **priority 1** (bypass quiet hours on iOS), everything else gets
priority 0. You'll feel a tap on your wrist whenever Claude needs attention.

### Option B: ntfy.sh (free)

[ntfy.sh](https://ntfy.sh) is an open-source pub-sub notification service.
Free public server, or self-host your own. The iOS app forwards to Apple Watch.

**Setup (2 minutes):**

1. Install the [ntfy iOS app](https://apps.apple.com/us/app/ntfy/id1625396347).
2. Pick a topic name (it's just a random string — no registration needed).
   E.g. `my-claude-alerts-abc123`.
3. Subscribe to that topic in the app.
4. Point the dashboard at `https://ntfy.sh/<your-topic>`.

**compose.yml:**

```yaml
environment:
  NOTIFY_WEBHOOK_URL: "https://ntfy.sh/my-claude-alerts-abc123"
  NOTIFY_FORMAT: "generic"
  NOTIFY_ON: "attention"
```

The `generic` format sends a plain JSON payload — the ntfy app shows the
`event` and `session.name` fields automatically. To customise the notification
title and message, you can use ntfy's header-based API instead:

```yaml
environment:
  NOTIFY_WEBHOOK_URL: "https://ntfy.sh/my-claude-alerts-abc123"
  NOTIFY_FORMAT: "generic"
  NOTIFY_ON: "attention"
  NOTIFY_HEADERS: "{\"Title\":\"Claude needs you\",\"Priority\":\"high\",\"Tags\":\"rotating_light\"}"
```

The dashboard always sends JSON; ntfy picks up any headers you pass.

---

## Slack

### Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
   → **From scratch**.
2. Give it a name (e.g. "Claude Dashboard") and pick a workspace.
3. In the left sidebar, go to **Incoming Webhooks** → toggle **Activate
   Incoming Webhooks** to On.
4. Click **Add New Webhook to Workspace** → pick the channel where
   notifications should land → **Allow**.
5. Copy the webhook URL (looks like
   `https://hooks.slack.com/services/T.../B.../...`).

**compose.yml:**

```yaml
environment:
  NOTIFY_WEBHOOK_URL: "https://hooks.slack.com/services/T00000000/B00000000/xxxxxxxxxxxx"
  NOTIFY_FORMAT: "slack"
  NOTIFY_ON: "started,finished,idle,working,attention"
```

Messages appear as mrkdwn-formatted blocks with emoji indicators (🟢 started,
✅ finished, 🔴 needs attention). All three events fire by default — adjust
`NOTIFY_ON` to taste.

### Fine print

- Incoming Webhooks are rate-limited to 1 message per second per channel.
  The dashboard fires at most a few events per hour in practice, so this won't
  be an issue.
- If you want @-mentions in the message, the incoming webhook format doesn't
  support it directly — use the `generic` format with a Slack API
  `chat.postMessage` call instead (requires a bot token and OAuth scope).

---

## Microsoft Teams

### Setup

1. In Teams, go to the channel where you want notifications → click the **⋯**
   menu → **Connectors**.
2. Search for **Incoming Webhook** → **Add** → **Configure**.
3. Give it a name (e.g. "Claude Dashboard") and optionally upload an icon.
4. Click **Create** → copy the webhook URL (looks like
   `https://your-org.webhook.office.com/webhookb2/.../IncomingWebhook/...`).
5. Click **Done**.

> **If the Connectors menu is missing:** Your Teams admin may have disabled
> connectors org-wide. Ask them to enable it, or use the "Workflows" method
> below.

**compose.yml:**

```yaml
environment:
  NOTIFY_WEBHOOK_URL: "https://your-org.webhook.office.com/webhookb2/..."
  NOTIFY_FORMAT: "teams"
  NOTIFY_ON: "started,finished,idle,working,attention"
```

Messages post as Office 365 MessageCards with:
- A **title** ("Claude Status Dashboard")
- A **theme color** matching the event (red for attention, green for finished,
  yellow for idle, orange for working, blue for started)
- A **facts table** with session name, status, and detail
- The message text in the card body

### Alternative: Power Automate (Workflows)

If Incoming Webhooks are disabled, use Power Automate instead:

1. In Teams, go to the channel → **⋯** → **Workflows**.
2. Create a workflow: **Post to a channel when a webhook request is received**.
3. Copy the generated webhook URL.
4. Use `NOTIFY_FORMAT=generic` — the raw JSON arrives in Power Automate and you
   can transform it into an Adaptive Card with the visual designer.

**compose.yml (Power Automate):**

```yaml
environment:
  NOTIFY_WEBHOOK_URL: "https://prod-123.westus.logic.azure.com:443/workflows/..."
  NOTIFY_FORMAT: "generic"
  NOTIFY_ON: "attention"
```

### Fine print

- Office 365 Connectors are being [retired](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)
  and will stop working. The replacement is **Power Automate workflows** — use
  the `generic` format and build an Adaptive Card in the workflow designer.
  Same result, just a different pipeline.
- MessageCards render differently on mobile vs desktop Teams. The `generic`
  format + Adaptive Cards gives you full control over both.

---

## Discord

### Setup

1. In Discord, open **Server Settings** → **Integrations** → **Webhooks**
   → **New Webhook**.
2. Give it a name (e.g. "Claude Dashboard") and pick a channel.
3. Click **Copy Webhook URL** (looks like
   `https://discord.com/api/webhooks/.../...`).

**compose.yml:**

```yaml
environment:
  NOTIFY_WEBHOOK_URL: "https://discord.com/api/webhooks/1234567890/abcdefghijklmnop"
  NOTIFY_FORMAT: "discord"
  NOTIFY_ON: "started,finished,idle,working,attention"
```

Discord messages use embeds with a colored sidebar per event type.

---

## Generic format: Zapier, Make, n8n, IFTTT, custom

Set `NOTIFY_FORMAT=generic` and the dashboard POSTs this JSON to your URL:

```json
{
  "event": "attention",
  "timestamp": "2026-07-10T20:45:00.000Z",
  "session": {
    "id": "session-abc123",
    "name": "my-project",
    "status": "red",
    "detail": "Claude needs approval for Bash tool",
    "usageProject": "/home/user/my-project"
  }
}
```

This is a plain, predictable schema. Any automation platform can consume it:

- **Zapier:** Use the **Webhook** trigger (Catch Hook). Filter on `event` in a
  Zapier filter step, then route to any Zapier action.
- **Make (Integromat):** Use the **Webhook** module. Parse the JSON, branch on
  `event`, route to Slack/Teams/email/SMS/anything.
- **n8n:** Self-hosted alternative. Use the **Webhook** trigger node.
- **IFTTT:** Limited free tier. Use the **Webhooks** service as a trigger
  ("Receive a web request"), then send a rich notification via the IFTTT iOS
  app (which forwards to Apple Watch).

### Example: generic → Zapier → SMS

```yaml
environment:
  NOTIFY_WEBHOOK_URL: "https://hooks.zapier.com/hooks/catch/123456/abcdef/"
  NOTIFY_FORMAT: "generic"
  NOTIFY_ON: "attention"
```

Zapier catches the JSON, a filter step checks `event == "attention"`, and an SMS
action texts your phone.

---

## Troubleshooting

### Notifications aren't firing

1. Check that `NOTIFY_WEBHOOK_URL` is set and the container was rebuilt
   (`docker compose up -d --build`).
2. Confirm the event you want is in `NOTIFY_ON` (default is
   `started,finished,red`).
3. The server logs notification failures silently by design (so the API stays
   fast). To debug, temporarily add `console.log` in `src/notify.ts`'s
   `fetch().catch()` block, or test your webhook URL manually:

   ```bash
   curl -X POST "YOUR_WEBHOOK_URL" \
     -H "Content-Type: application/json" \
     -d '{"event":"attention","timestamp":"2026-01-01T00:00:00Z","session":{"id":"test","name":"test","status":"red","detail":"manual test"}}'
   ```

4. If `curl` works but the dashboard doesn't, verify the container can reach
   the webhook URL (corporate VPNs or firewalls may block outbound requests
   from Docker).

### Teams: "Connectors are being retired"

Microsoft is phasing out Office 365 Connectors. Use **Power Automate** instead
(see the Teams section above). The `generic` format works perfectly with Power
Automate's "When a HTTP request is received" trigger.

### Pushover: not getting priority alerts on Apple Watch

Pushover's priority 1 ("high") bypasses iOS quiet hours. Make sure:
- The Pushover iOS app has Notification permissions enabled (Settings →
  Notifications → Pushover).
- Your Apple Watch is set to mirror iPhone alerts (Watch app → Notifications →
  Pushover → Mirror my iPhone).
- You're using the `pushover` format — the dashboard sets `priority: 1` for
  `red` events automatically.

### ntfy: messages show raw JSON

The ntfy iOS app shows whatever you POST. For a cleaner notification, add
custom headers (see the ntfy example above), or use the ntfy server's built-in
message templating if self-hosting.
