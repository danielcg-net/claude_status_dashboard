// Beep settings panel — build, sync, and event handling.

import { createElement } from './ui-dom.js'
import { ui } from './ui-state.js'
import type { BeepSettingsUI } from './ui-types.js'
import { beepEventOptions } from './ui-types.js'
import { saveBeepSettings } from './ui-api.js'
import { showToast } from './ui-toast.js'
import { redAlertAfterMs } from './ui-alerts.js'
import { render } from './ui-render.js'

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

export const buildBeepPanel = (s: BeepSettingsUI): HTMLElement =>
  createElement('div', { class: 'alert-controls__beep-panel' }, [
    // Header
    createElement('div', { class: 'beep-panel__header' }, [
      createElement('h3', {}, ['Beep Settings']),
      createElement('button', {
        class: 'beep-panel__close',
        type: 'button',
        'aria-label': 'Close beep settings',
      }, ['✕']),
    ]),
    // Enable toggle
    createElement('label', { class: 'beep-panel__toggle' }, [
      createElement('input', {
        id: 'beep-enabled',
        type: 'checkbox',
        checked: s.enabled ? 'true' : undefined,
      }),
      createElement('span', {}, ['Enable audio alerts']),
    ]),
    // Alert after + Max beeps row
    createElement('div', { class: 'beep-panel__row' }, [
      createElement('div', { class: 'beep-panel__field' }, [
        createElement('label', { for: 'alert-after-seconds' }, ['Wait (seconds)']),
        createElement('input', {
          id: 'alert-after-seconds',
          type: 'number',
          min: '0',
          step: '1',
          inputmode: 'numeric',
          value: String(s.alertAfterMs !== null ? Math.round(s.alertAfterMs / 1000) : Math.round(redAlertAfterMs(ui.state) / 1000)),
          disabled: s.enabled ? undefined : 'true',
        }),
      ]),
      createElement('div', { class: 'beep-panel__field' }, [
        createElement('label', { class: 'beep-panel__check-row' }, [
          createElement('input', {
            id: 'limit-beeps',
            type: 'checkbox',
            checked: s.maxBeeps !== null ? 'true' : undefined,
            disabled: s.enabled ? undefined : 'true',
          }),
          createElement('span', {}, ['Limit to']),
        ]),
        createElement('input', {
          id: 'max-beeps',
          type: 'number',
          step: '1',
          inputmode: 'numeric',
          value: s.maxBeeps !== null ? String(s.maxBeeps) : '',
          placeholder: String(s.maxBeeps ?? 5),
          disabled: s.maxBeeps === null || !s.enabled ? 'true' : undefined,
        }),
      ]),
    ]),
    // Events
    createElement('fieldset', { class: 'beep-panel__events', disabled: s.enabled ? undefined : 'true' }, [
      createElement('legend', {}, ['Events']),
      createElement('div', { class: 'beep-panel__events-content' },
        beepEventOptions.map(event =>
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
    // Save
    createElement('button', { id: 'beep-save', 'data-testid': 'beep-save', type: 'button' }, ['Save Settings']),
  ])

let lastSyncedBeepSettings: BeepSettingsUI | null = null

export const syncBeepPanelFields = (panel: HTMLElement, s: BeepSettingsUI): void => {
  // Skip sync when settings haven't changed (reference equality).
  // The 2s poll preserves the same object via spread; only load/save
  // replaces it, so this avoids clobbering in-progress user edits.
  if (lastSyncedBeepSettings === s) return
  lastSyncedBeepSettings = s

  const enabled = s.enabled
  syncCheckbox(panel.querySelector<HTMLInputElement>('#beep-enabled'), enabled)
  syncTextLike(
    panel.querySelector<HTMLInputElement>('#alert-after-seconds'),
    String(s.alertAfterMs !== null ? Math.round(s.alertAfterMs / 1000) : Math.round(redAlertAfterMs(ui.state) / 1000)),
  )
  syncDisabled(panel.querySelector<HTMLInputElement>('#alert-after-seconds'), !enabled)
  syncCheckbox(panel.querySelector<HTMLInputElement>('#limit-beeps'), s.maxBeeps !== null)
  syncDisabled(panel.querySelector<HTMLInputElement>('#limit-beeps'), !enabled)
  const maxBeepsInput = panel.querySelector<HTMLInputElement>('#max-beeps')
  if (maxBeepsInput) {
    const val = s.maxBeeps !== null ? String(s.maxBeeps) : ''
    syncTextLike(maxBeepsInput, val)
    syncDisabled(maxBeepsInput, s.maxBeeps === null || !enabled)
    maxBeepsInput.placeholder = String(s.maxBeeps ?? 5)
  }
  // Event checkboxes
  panel.querySelectorAll<HTMLInputElement>('.beep-panel__events input[type="checkbox"]').forEach(cb => {
    syncCheckbox(cb, s.events.includes(cb.value))
    syncDisabled(cb, !enabled)
  })
  const fieldset = panel.querySelector<HTMLFieldSetElement>('.beep-panel__events')
  syncDisabled(fieldset, !enabled)
  syncDisabled(panel.querySelector<HTMLButtonElement>('#beep-save'), !enabled)
}

export const attachBeepPanelEvents = (): void => {
  // Close button
  document.querySelector('.beep-panel__close')?.addEventListener('click', () => {
    ui.state = { ...ui.state, beepSettingsOpen: false }
    render()
  })

  // Limit checkbox — toggle max-beeps input disabled state
  document.querySelector<HTMLInputElement>('#limit-beeps')?.addEventListener('change', (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked
    const maxBeepsInput = document.querySelector<HTMLInputElement>('#max-beeps')
    if (maxBeepsInput) {
      syncDisabled(maxBeepsInput, !checked)
      if (!checked) maxBeepsInput.value = ''
    }
  })

  // Enable toggle (saves all panel values immediately)
  document.querySelector<HTMLInputElement>('#beep-enabled')?.addEventListener('change', async (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked

    const alertAfterInput = document.querySelector<HTMLInputElement>('#alert-after-seconds')
    const seconds = alertAfterInput ? Math.max(0, Math.floor(alertAfterInput.valueAsNumber)) : Math.round(redAlertAfterMs(ui.state) / 1000)
    const alertAfterMs = Number.isFinite(seconds) ? seconds * 1000 : null

    const limitChecked = document.querySelector<HTMLInputElement>('#limit-beeps')?.checked ?? false
    const maxBeepsInput = document.querySelector<HTMLInputElement>('#max-beeps')
    const maxBeeps: number | null = (() => {
      if (!limitChecked) return null
      if (!maxBeepsInput || !maxBeepsInput.value.trim()) return null
      const raw = maxBeepsInput.valueAsNumber
      if (Number.isNaN(raw)) return ui.state.beepSettings?.maxBeeps ?? 5
      return Math.max(1, Math.floor(raw))
    })()

    const events = [...document.querySelectorAll<HTMLInputElement>('.beep-panel__events input[type="checkbox"]:checked')]
      .map(el => el.value)

    try {
      const updated = await saveBeepSettings({ enabled, alertAfterMs, maxBeeps, events })
      ui.state = {
        ...ui.state,
        beepSettings: updated,
        audioEnabled: enabled,
        redAlertAfterOverrideMs: updated.alertAfterMs,
        maxBeeps: updated.maxBeeps,
      }
      showToast(`Beeps ${enabled ? 'enabled' : 'disabled'}`, 'success')
    } catch {
      showToast('Failed to update beep settings', 'error')
    }
    render()
  })

  // Save button
  document.querySelector<HTMLButtonElement>('#beep-save')?.addEventListener('click', async () => {
    const alertAfterInput = document.querySelector<HTMLInputElement>('#alert-after-seconds')
    const seconds = alertAfterInput ? Math.max(0, Math.floor(alertAfterInput.valueAsNumber)) : Math.round(redAlertAfterMs(ui.state) / 1000)
    const alertAfterMs = Number.isFinite(seconds) ? seconds * 1000 : null

    const limitChecked = document.querySelector<HTMLInputElement>('#limit-beeps')?.checked ?? false
    const maxBeepsInput = document.querySelector<HTMLInputElement>('#max-beeps')
    const maxBeeps: number | null = (() => {
      if (!limitChecked) return null
      if (!maxBeepsInput || !maxBeepsInput.value.trim()) return null
      const raw = maxBeepsInput.valueAsNumber
      if (Number.isNaN(raw)) return ui.state.beepSettings?.maxBeeps ?? 5
      return Math.max(1, Math.floor(raw))
    })()

    const events = [...document.querySelectorAll<HTMLInputElement>('.beep-panel__events input[type="checkbox"]:checked')]
      .map(el => el.value)

    const body: Record<string, unknown> = {
      enabled: document.querySelector<HTMLInputElement>('#beep-enabled')?.checked ?? ui.state.beepSettings?.enabled ?? false,
      alertAfterMs,
      maxBeeps,
      events,
    }

    try {
      const updated = await saveBeepSettings(body)
      ui.state = {
        ...ui.state,
        beepSettings: updated,
        audioEnabled: updated.enabled,
        redAlertAfterOverrideMs: updated.alertAfterMs,
        maxBeeps: updated.maxBeeps,
        lastBeepAt: 0,
        beepCount: 0,
      }
      showToast('Beep settings saved', 'success')
    } catch (err) {
      showToast('Failed to save beep settings', 'error')
      console.error('Failed to save beep settings:', err)
    }
    render()
  })
}
