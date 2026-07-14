// Notification settings panel — build, sync, and event handling.

import { createElement } from './ui-dom.js'
import { ui } from './ui-state.js'
import type { NotifySettingsUI } from './ui-types.js'
import { notifyEventOptions, notifyFormatOptions } from './ui-types.js'
import { saveNotifySettings } from './ui-api.js'
import { showToast } from './ui-toast.js'
import { render } from './ui-render.js'

// Helper: sync an input's value only when it is NOT focused
const syncTextLike = (el: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string): void => {
  if (!el || document.activeElement === el) return
  if (el.value !== value) el.value = value
}

const syncCheckbox = (el: HTMLInputElement | null | undefined, checked: boolean): void => {
  if (!el) return
  if (el.checked !== checked) el.checked = checked
}

const syncDisabled = (el: HTMLElement | null | undefined, disabled: boolean): void => {
  if (!el) return
  if (disabled) el.setAttribute('disabled', 'true')
  else el.removeAttribute('disabled')
}

export const buildNotifyPanel = (s: NotifySettingsUI): HTMLElement =>
  createElement('div', { class: 'alert-controls__notify-panel' }, [
    // Header
    createElement('div', { class: 'notify-panel__header' }, [
      createElement('h3', {}, ['Notification Settings']),
      createElement('button', {
        class: 'notify-panel__close',
        type: 'button',
        'aria-label': 'Close notification settings',
      }, ['✕']),
    ]),
    // Enable toggle
    createElement('label', { class: 'notify-panel__toggle' }, [
      createElement('input', {
        id: 'notify-enabled',
        type: 'checkbox',
        checked: s.enabled ? 'true' : undefined,
      }),
      createElement('span', {}, ['Enable webhook notifications']),
    ]),
    // Webhook URL
    createElement('div', { class: 'notify-panel__field' }, [
      createElement('label', { for: 'notify-webhook-url' }, ['Webhook URL']),
      createElement('input', {
        id: 'notify-webhook-url',
        type: 'url',
        value: s.webhookUrl,
        placeholder: 'https://api.pushover.net/1/messages.json',
        disabled: s.enabled ? undefined : 'true',
      }),
    ]),
    // Format + Events row
    createElement('div', { class: 'notify-panel__row notify-panel__row--events' }, [
      createElement('div', { class: 'notify-panel__field' }, [
        createElement('label', { for: 'notify-format' }, ['Format']),
        createElement('select', {
          id: 'notify-format',
          disabled: s.enabled ? undefined : 'true',
        }, notifyFormatOptions.map(f =>
          createElement('option', { value: f, selected: s.format === f ? 'true' : undefined }, [f]),
        )),
      ]),
      createElement('fieldset', { class: 'notify-panel__events', disabled: s.enabled ? undefined : 'true' }, [
        createElement('legend', {}, ['Events']),
        createElement('div', { class: 'notify-panel__events-content' },
          notifyEventOptions.map(event =>
            createElement('label', {}, [
              createElement('input', {
                type: 'checkbox',
                value: event,
                checked: s.events.includes(event) ? 'true' : undefined,
                disabled: s.enabled ? undefined : 'true',
              }),
              event,
            ]),
          ),
        ),
      ]),
    ]),
    // Pushover API token
    createElement('div', { class: 'notify-panel__field' }, [
      createElement('label', { for: 'notify-pushover-token' }, ['Pushover API token']),
      createElement('input', {
        id: 'notify-pushover-token',
        type: 'password',
        placeholder: s.pushoverToken || '(not set)',
        disabled: s.enabled ? undefined : 'true',
      }),
    ]),
    // Pushover user key
    createElement('div', { class: 'notify-panel__field' }, [
      createElement('label', { for: 'notify-pushover-user' }, ['Pushover user key']),
      createElement('input', {
        id: 'notify-pushover-user',
        type: 'password',
        placeholder: s.pushoverUser || '(not set)',
        disabled: s.enabled ? undefined : 'true',
      }),
    ]),
    // Custom headers
    createElement('div', { class: 'notify-panel__field' }, [
      createElement('label', { for: 'notify-headers' }, ['Custom headers (JSON)']),
      createElement('textarea', {
        id: 'notify-headers',
        rows: '2',
        disabled: s.enabled ? undefined : 'true',
      }, [JSON.stringify(s.headers, null, 2)]),
    ]),
    // Save
    createElement('button', { id: 'notify-save', type: 'button' }, ['Save Settings']),
  ])

let lastSyncedNotifySettings: NotifySettingsUI | null = null

export const syncNotifyPanelFields = (panel: HTMLElement, s: NotifySettingsUI): void => {
  // Skip sync when settings haven't changed (reference equality).
  // The 2s poll preserves the same object via spread; only load/save
  // replaces it, so this avoids clobbering in-progress user edits.
  if (lastSyncedNotifySettings === s) return
  lastSyncedNotifySettings = s

  const enabled = s.enabled
  syncCheckbox(panel.querySelector<HTMLInputElement>('#notify-enabled'), enabled)
  syncTextLike(panel.querySelector<HTMLInputElement>('#notify-webhook-url'), s.webhookUrl)
  syncDisabled(panel.querySelector<HTMLInputElement>('#notify-webhook-url'), !enabled)

  // Format select: update selected option
  const formatSel = panel.querySelector<HTMLSelectElement>('#notify-format')
  if (formatSel) {
    if (formatSel.value !== s.format) formatSel.value = s.format
    syncDisabled(formatSel, !enabled)
  }

  // Event checkboxes
  panel.querySelectorAll<HTMLInputElement>('.notify-panel__events input[type="checkbox"]').forEach(cb => {
    syncCheckbox(cb, s.events.includes(cb.value))
    syncDisabled(cb, !enabled)
  })
  const fieldset = panel.querySelector<HTMLFieldSetElement>('.notify-panel__events')
  syncDisabled(fieldset, !enabled)

  // Pushover fields
  const tokenInput = panel.querySelector<HTMLInputElement>('#notify-pushover-token')
  if (tokenInput) {
    tokenInput.placeholder = s.pushoverToken || '(not set)'
    syncDisabled(tokenInput, !enabled)
  }
  const userInput = panel.querySelector<HTMLInputElement>('#notify-pushover-user')
  if (userInput) {
    userInput.placeholder = s.pushoverUser || '(not set)'
    syncDisabled(userInput, !enabled)
  }

  // Headers textarea
  syncTextLike(panel.querySelector<HTMLTextAreaElement>('#notify-headers'), JSON.stringify(s.headers, null, 2))
  syncDisabled(panel.querySelector<HTMLTextAreaElement>('#notify-headers'), !enabled)

  // Save button
  syncDisabled(panel.querySelector<HTMLButtonElement>('#notify-save'), !enabled)
}

export const attachNotifyPanelEvents = (): void => {
  // Close button
  document.querySelector('.notify-panel__close')?.addEventListener('click', () => {
    ui.state = { ...ui.state, notifySettingsOpen: false }
    render()
  })

  // Notify settings: enable/disable toggle (saves immediately)
  document.querySelector<HTMLInputElement>('#notify-enabled')?.addEventListener('change', async (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked
    try {
      const updated = await saveNotifySettings({ enabled: checked })
      ui.state = { ...ui.state, notifySettings: updated }
      showToast(`Notifications ${checked ? 'enabled' : 'disabled'}`, 'success')
    } catch {
      showToast('Failed to update notification settings', 'error')
    }
    render()
  })

  // Notify settings: save button
  document.querySelector<HTMLButtonElement>('#notify-save')?.addEventListener('click', async () => {
    const body: Record<string, unknown> = {
      webhookUrl: document.querySelector<HTMLInputElement>('#notify-webhook-url')?.value ?? '',
      format: (document.querySelector<HTMLSelectElement>('#notify-format')?.value) ?? 'generic',
      events: [...document.querySelectorAll<HTMLInputElement>('.notify-panel__events input[type="checkbox"]:checked')]
        .map(el => el.value),
      headers: (() => {
        const raw = document.querySelector<HTMLTextAreaElement>('#notify-headers')?.value ?? ''
        if (!raw.trim()) return {}
        try { const p = JSON.parse(raw); return typeof p === 'object' && p !== null && !Array.isArray(p) ? p as Record<string, string> : {} } catch { return {} }
      })(),
    }
    const tokenInput = document.querySelector<HTMLInputElement>('#notify-pushover-token')
    if (tokenInput?.value) body.pushoverToken = tokenInput.value
    const userInput = document.querySelector<HTMLInputElement>('#notify-pushover-user')
    if (userInput?.value) body.pushoverUser = userInput.value

    try {
      const updated = await saveNotifySettings(body)
      ui.state = { ...ui.state, notifySettings: updated }
      showToast('Notification settings saved', 'success')
    } catch (err) {
      showToast('Failed to save notification settings', 'error')
      console.error('Failed to save notify settings:', err)
    }
    render()
  })
}
