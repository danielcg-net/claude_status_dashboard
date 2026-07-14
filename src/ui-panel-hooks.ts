// Hooks setup panel — build, sync, and event handling.

import { createElement } from './ui-dom.js'
import { ui } from './ui-state.js'
import type { HooksSettingsUI } from './ui-types.js'
import { saveHookSettings } from './ui-api.js'
import { showToast } from './ui-toast.js'
import { render } from './ui-render.js'

export const buildHooksPanel = (s: HooksSettingsUI): HTMLElement => {
  const installedBadge = s.installed
    ? createElement('span', { class: 'hooks-panel__badge hooks-panel__badge--ok' }, ['Installed'])
    : createElement('span', { class: 'hooks-panel__badge hooks-panel__badge--warn' }, ['Not installed'])

  const scriptBadge = s.scriptExists
    ? createElement('span', { class: 'hooks-panel__badge hooks-panel__badge--ok' }, ['Script exists'])
    : createElement('span', { class: 'hooks-panel__badge hooks-panel__badge--warn' }, ['Script missing'])

  const locationLabel: Record<string, string> = {
    global: 'Global (~/.claude/settings.json)',
    project: 'Project (.claude/settings.json)',
    both: 'Both global & project',
    none: 'Not configured',
  }

  const children: HTMLElement[] = [
    // Header
    createElement('div', { class: 'hooks-panel__header' }, [
      createElement('h3', {}, ['Hooks Setup']),
      createElement('button', {
        class: 'hooks-panel__close',
        type: 'button',
        'aria-label': 'Close hooks settings',
        'data-testid': 'hooks-panel-close',
      }, ['✕']),
    ]),
    // Status section
    createElement('div', { class: 'hooks-panel__status' }, [
      createElement('div', { class: 'hooks-panel__status-row' }, [
        createElement('span', { class: 'hooks-panel__label' }, ['Status:']),
        installedBadge,
      ]),
      createElement('div', { class: 'hooks-panel__status-row' }, [
        createElement('span', { class: 'hooks-panel__label' }, ['Location:']),
        createElement('span', {}, [locationLabel[s.configLocation] ?? s.configLocation]),
      ]),
      createElement('div', { class: 'hooks-panel__status-row' }, [
        createElement('span', { class: 'hooks-panel__label' }, ['Script:']),
        scriptBadge,
        createElement('code', { class: 'hooks-panel__path' }, [s.scriptPath]),
      ]),
      ...(s.events.length > 0 ? [
        createElement('div', { class: 'hooks-panel__status-row' }, [
          createElement('span', { class: 'hooks-panel__label' }, ['Events:']),
          createElement('span', {}, [`${s.events.length} events configured`]),
        ]),
      ] : []),
      ...(s.scriptVersion ? [
        createElement('div', { class: 'hooks-panel__status-row' }, [
          createElement('span', { class: 'hooks-panel__label' }, ['Version:']),
          createElement('code', {}, [s.scriptVersion]),
        ]),
      ] : []),
      ...(s.error ? [
        createElement('div', { class: 'hooks-panel__error' }, [s.error]),
      ] : []),
    ]),
    // Scope selector
    createElement('div', { class: 'hooks-panel__field' }, [
      createElement('label', { for: 'hooks-scope' }, ['Where to install hooks:']),
      createElement('select', {
        id: 'hooks-scope',
        class: 'hooks-panel__select',
      }, [
        createElement('option', {
          value: 'global',
          selected: s.configLocation === 'global' ? 'true' : undefined,
        }, ['Global (~/.claude/settings.json)']),
        createElement('option', {
          value: 'project',
          selected: s.configLocation === 'project' ? 'true' : undefined,
        }, ['Project (.claude/settings.json)']),
      ]),
    ]),
    // Action buttons
    createElement('div', { class: 'hooks-panel__actions' }, [
      createElement('button', {
        id: 'hooks-install',
        class: 'hooks-panel__btn hooks-panel__btn--primary',
        type: 'button',
      }, ['Install / Update Hooks']),
      createElement('button', {
        id: 'hooks-delete',
        class: 'hooks-panel__btn hooks-panel__btn--danger',
        type: 'button',
        style: s.installed ? '' : 'display: none',
      }, ['Delete Hooks']),
    ]),
  ]

  return createElement('div', { class: 'alert-controls__hooks-panel', 'data-testid': 'hooks-panel' }, children)
}

export const syncHooksPanelFields = (panel: HTMLElement, s: HooksSettingsUI): void => {
  // Update installed badge
  const badges = panel.querySelectorAll<HTMLElement>('.hooks-panel__badge')
  if (badges.length >= 2) {
    const b0 = badges[0]!
    b0.textContent = s.installed ? 'Installed' : 'Not installed'
    b0.className = s.installed ? 'hooks-panel__badge hooks-panel__badge--ok' : 'hooks-panel__badge hooks-panel__badge--warn'
    const b1 = badges[1]!
    b1.textContent = s.scriptExists ? 'Script exists' : 'Script missing'
    b1.className = s.scriptExists ? 'hooks-panel__badge hooks-panel__badge--ok' : 'hooks-panel__badge hooks-panel__badge--warn'
  }

  // Toggle delete button visibility
  const deleteBtn = panel.querySelector<HTMLButtonElement>('#hooks-delete')
  if (deleteBtn) {
    deleteBtn.style.display = s.installed ? '' : 'none'
  }

  // Show/hide error
  const errorEl = panel.querySelector<HTMLElement>('.hooks-panel__error')
  if (errorEl) {
    if (s.error) {
      errorEl.textContent = s.error
      errorEl.style.display = ''
    } else {
      errorEl.style.display = 'none'
    }
  }
}

export const attachHooksPanelEvents = (): void => {
  // Close button
  document.querySelector('.hooks-panel__close')?.addEventListener('click', () => {
    ui.state = { ...ui.state, hooksSettingsOpen: false }
    render()
  })

  // Install / Update button
  document.querySelector<HTMLButtonElement>('#hooks-install')?.addEventListener('click', async () => {
    const scope = (document.querySelector<HTMLSelectElement>('#hooks-scope')?.value) ?? 'global'
    try {
      const updated = await saveHookSettings({ action: 'install', scope })
      ui.state = { ...ui.state, hooksSettings: updated }
      showToast('Hooks installed successfully', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(`Failed to install hooks: ${message}`, 'error')
    }
    render()
  })

  // Delete button
  document.querySelector<HTMLButtonElement>('#hooks-delete')?.addEventListener('click', async () => {
    const scope = (document.querySelector<HTMLSelectElement>('#hooks-scope')?.value) ?? 'global'
    try {
      const updated = await saveHookSettings({ action: 'delete', scope })
      ui.state = { ...ui.state, hooksSettings: updated }
      showToast('Hooks deleted', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(`Failed to delete hooks: ${message}`, 'error')
    }
    render()
  })
}
