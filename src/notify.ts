import type { Session, SessionStatus } from './domain.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events are named after what's happening, not colors.
 *  `started` is the only non-status event — it fires once when a session
 *  first registers.  The rest map directly to Claude Code session states:
 *
 *    finished  — green  (Claude finished running)
 *    idle      — yellow (waiting for your input)
 *    working   — orange (actively thinking or using tools)
 *    attention — red    (needs your approval or attention)
 */
export type NotifyEvent = 'started' | 'finished' | 'idle' | 'working' | 'attention'

export type NotifyFormat = 'generic' | 'pushover' | 'teams' | 'slack' | 'discord'

// ---------------------------------------------------------------------------
// Configuration (read once at module load)
// ---------------------------------------------------------------------------

const NOTIFY_WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL
const NOTIFY_FORMAT = (process.env.NOTIFY_FORMAT ?? 'generic') as NotifyFormat
const NOTIFY_ON = new Set<string>(
  (process.env.NOTIFY_ON ?? 'started,finished,idle,working,attention')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const NOTIFY_PUSHOVER_TOKEN = process.env.NOTIFY_PUSHOVER_TOKEN
const NOTIFY_PUSHOVER_USER = process.env.NOTIFY_PUSHOVER_USER

const parseHeaders = (raw: string | undefined): Record<string, string> => {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const NOTIFY_HEADERS: Record<string, string> = parseHeaders(process.env.NOTIFY_HEADERS)

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Whether a given event type should fire a notification. */
export const shouldNotify = (event: NotifyEvent): boolean => NOTIFY_ON.has(event)

/** Map a session status to its lifecycle event. */
export const eventForStatus = (status: SessionStatus): NotifyEvent => {
  switch (status) {
    case 'green':
      return 'finished'
    case 'yellow':
      return 'idle'
    case 'orange':
      return 'working'
    case 'red':
      return 'attention'
  }
}

// ---------------------------------------------------------------------------
// Message text
// ---------------------------------------------------------------------------

const statusLabel = (event: NotifyEvent): string => {
  switch (event) {
    case 'started':
      return 'Session started'
    case 'finished':
      return 'Claude finished'
    case 'idle':
      return 'Idle — waiting for input'
    case 'working':
      return 'Working'
    case 'attention':
      return 'Needs attention'
  }
}

const formatMessage = (event: NotifyEvent, session: Session): string => {
  const label = statusLabel(event)
  const detail = session.detail ? ` — ${session.detail}` : ''
  return `${label}: ${session.name}${detail}`
}

// ---------------------------------------------------------------------------
// Payload builders (per format)
// ---------------------------------------------------------------------------

interface Payload {
  readonly body: string
  readonly headers: Record<string, string>
}

const buildGeneric = (event: NotifyEvent, session: Session): Payload => ({
  body: JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    session: {
      id: session.id,
      name: session.name,
      status: session.status,
      detail: session.detail,
      usageProject: session.usageProject,
    },
  }),
  headers: { 'Content-Type': 'application/json', ...NOTIFY_HEADERS },
})

const buildPushover = (event: NotifyEvent, session: Session): Payload => ({
  body: JSON.stringify({
    token: NOTIFY_PUSHOVER_TOKEN,
    user: NOTIFY_PUSHOVER_USER,
    title: 'Claude Status Dashboard',
    message: formatMessage(event, session),
    priority: event === 'attention' ? 1 : 0,
  }),
  headers: { 'Content-Type': 'application/json', ...NOTIFY_HEADERS },
})

const teamsColor = (event: NotifyEvent): string => {
  switch (event) {
    case 'finished':
      return '00AA00'
    case 'idle':
      return 'DDA000'
    case 'working':
      return 'E67E00'
    case 'attention':
      return 'FF0000'
    default:
      return '0076D3' // started
  }
}

const buildTeams = (event: NotifyEvent, session: Session): Payload => ({
  body: JSON.stringify({
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    title: 'Claude Status Dashboard',
    text: formatMessage(event, session),
    themeColor: teamsColor(event),
    sections: [
      {
        facts: [
          { name: 'Session', value: session.name },
          { name: 'Status', value: session.status },
          { name: 'Detail', value: session.detail || '(none)' },
        ],
      },
    ],
  }),
  headers: { 'Content-Type': 'application/json', ...NOTIFY_HEADERS },
})

const slackIcon = (event: NotifyEvent): string => {
  switch (event) {
    case 'finished':
      return '✅'
    case 'idle':
      return '🟡'
    case 'working':
      return '🟠'
    case 'attention':
      return '🔴'
    default:
      return '🟢' // started
  }
}

const buildSlack = (event: NotifyEvent, session: Session): Payload => ({
  body: JSON.stringify({
    text: `Claude Status Dashboard — ${statusLabel(event)}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${slackIcon(event)} *${statusLabel(event)}*\n> ${session.name}${session.detail ? ` — ${session.detail}` : ''}`,
        },
      },
    ],
  }),
  headers: { 'Content-Type': 'application/json', ...NOTIFY_HEADERS },
})

const discordColors: Record<NotifyEvent, number> = {
  started: 0x0076d3,
  finished: 0x00aa00,
  idle: 0xdda000,
  working: 0xe67e00,
  attention: 0xff0000,
}

const buildDiscord = (event: NotifyEvent, session: Session): Payload => ({
  body: JSON.stringify({
    content: null,
    embeds: [
      {
        title: statusLabel(event),
        description: formatMessage(event, session),
        color: discordColors[event],
        fields: [
          { name: 'Session', value: session.name, inline: true },
          { name: 'Status', value: session.status, inline: true },
        ],
      },
    ],
  }),
  headers: { 'Content-Type': 'application/json', ...NOTIFY_HEADERS },
})

const builders: Record<NotifyFormat, (event: NotifyEvent, session: Session) => Payload> = {
  generic: buildGeneric,
  pushover: buildPushover,
  teams: buildTeams,
  slack: buildSlack,
  discord: buildDiscord,
}

// Exported for testing.
export const _buildPayload = (
  format: NotifyFormat,
  event: NotifyEvent,
  session: Session,
): Payload => builders[format](event, session)

// ---------------------------------------------------------------------------
// Core: fire a notification (fire-and-forget — never throws)
// ---------------------------------------------------------------------------

/** Send a notification for the given event and session.  Safe to call
 *  without awaiting — failures are silently swallowed so the API stays fast. */
export function notify(event: NotifyEvent, session: Session): void {
  if (!NOTIFY_WEBHOOK_URL) return
  if (!shouldNotify(event)) return

  const builder = builders[NOTIFY_FORMAT]
  if (!builder) return // unknown format — silently skip

  const { body, headers } = builder(event, session)

  fetch(NOTIFY_WEBHOOK_URL, { method: 'POST', headers, body }).catch(() => {
    // Fire-and-forget: notification failures must never affect the API.
  })
}
