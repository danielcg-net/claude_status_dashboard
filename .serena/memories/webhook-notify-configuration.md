# Webhook Notification Configuration

All notification settings are environment variables in `compose.yml` under `services.dashboard.environment`. After changing them, rebuild with `docker compose up -d --build`.

## Quick reference
| Variable | Default | Description |
|---|---|---|
| NOTIFY_WEBHOOK_URL | (none) | URL to POST to — required to enable |
| NOTIFY_FORMAT | generic | generic, pushover, teams, slack, discord |
| NOTIFY_ON | started,finished,idle,working,attention | Comma-separated: started, finished, idle, working, attention","timestamp":"...","session":{"id":"...","name":"...","status":"...","detail":"...","usageProject":"..."}}`

## Full documentation
See `WEBHOOK.md` for step-by-step setup guides and troubleshooting.