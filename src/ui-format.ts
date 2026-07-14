// Date, number, and currency formatting utilities for the browser UI.
// Pure functions — no DOM access, safe to test in Node with jsdom.

import { parseUtcDateString } from './client-utils.js'

// Parse a UTC ISO string and return the epoch ms, or null if invalid.
export const parseIso = (isoDate: string): number | null => {
  const utcMs = Date.parse(isoDate)
  if (isNaN(utcMs)) {
    console.warn('parseIso: invalid ISO date string', isoDate)
    return null
  }
  return utcMs
}

export const millisecondsSince = (isoDate: string): number | null => {
  const utcMs = parseIso(isoDate)
  return utcMs === null ? null : Date.now() - utcMs
}

export const formatRelative = (isoDate: string): string => {
  const utcMs = parseIso(isoDate)
  if (utcMs === null) return 'unknown'

  const seconds = Math.max(0, Math.floor((Date.now() - utcMs) / 1000))
  const minutes = Math.floor(seconds / 60)

  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
  }

  if (minutes >= 1) {
    return `${minutes}m ${seconds % 60}s ago`
  }

  return `${seconds}s ago`
}

// Format a UTC ISO timestamp as a local time string for tooltips / absolute display.
export const formatLocalTime = (isoDate: string): string | null => {
  const utcMs = parseIso(isoDate)
  if (utcMs === null) return null
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(utcMs))
}

export const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)

export const formatMoney = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)

const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/

export const formatDayLabel = (date: string): string => {
  // date is "YYYY-MM-DD" from ccusage. Append T00:00:00Z and use timeZone:'UTC'
  // to avoid UTC-to-local date shifts (e.g. "2026-06-28" as UTC midnight becomes
  // June 27 in negative-offset timezones).
  if (!dateStringRegex.test(date)) {
    console.warn('formatDayLabel: unexpected date format', date)
    return date
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T00:00:00Z'))
}

export const formatDateLabel = (isoDate: string): string => {
  if (!isoDate) {
    return 'No active block'
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoDate))
}
