# Webhook Notification Configuration

All notification settings are environment variables in `compose.yml` under `services.dashboard.environment`. After changing them, rebuild with `docker compose up -d --build`.

## Quick reference
| Variable | Default | Description |
|---|---|---|
| NOTIFY_WEBHOOK_URL | (none) | URL to POST to — required to enable |
| NOTIFY_FORMAT | generic | generic, pushover, teams, slack, discord |
| NOTIFY_ON | started,finished,red | Comma-separated event list |
| NOTIFY_HEADERS | (none) | JSON object for extra HTTP headers |
| NOTIFY_PUSHOVER_TOKEN | (none) | Pushover app token |
| NOTIFY_PUSHOVER_USER | (none) | Pushover user key |

## Recipes

### Apple Watch via Pushover ($5)
NOTIFY_WEBHOOK_URL: "https://api.pushover.net/1/messages.json"
NOTIFY_FORMAT: "pushover"
NOTIFY_ON: "red"
NOTIFY_PUSHOVER_TOKEN: "your-app-token"
NOTIFY_PUSHOVER_USER: "your-user-key"

### Apple Watch via ntfy.sh (free)
NOTIFY_WEBHOOK_URL: "https://ntfy.sh/my-topic"
NOTIFY_FORMAT: "generic"
NOTIFY_ON: "red"

### Slack
NOTIFY_WEBHOOK_URL: "https://hooks.slack.com/services/T.../B.../..."
NOTIFY_FORMAT: "slack"

### Microsoft Teams
NOTIFY_WEBHOOK_URL: "https://your-org.webhook.office.com/webhookb2/..."
NOTIFY_FORMAT: "teams"

### Discord
NOTIFY_WEBHOOK_URL: "https://discord.com/api/webhooks/.../..."
NOTIFY_FORMAT: "discord"

### Zapier / Make / n8n / custom
NOTIFY_WEBHOOK_URL: "https://hooks.zapier.com/hooks/catch/..."
NOTIFY_FORMAT: "generic"
The generic payload is: `{"event":"red","timestamp":"...","session":{"id":"...","name":"...","status":"...","detail":"...","usageProject":"..."}}`

## Full documentation
See `WEBHOOK.md` for step-by-step setup guides and troubleshooting.