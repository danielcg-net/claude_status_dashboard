// The central render function. Imported by panel modules to trigger re-renders.
// This module imports rendering helpers but NOT the panel modules themselves,
// avoiding circular dependencies.

import { createElement } from './ui-dom.js'
import { ui } from './ui-state.js'
import type { AppState, CostWindow, SessionStatus, SortMode } from './ui-types.js'
import { statusLabels, statusToColor } from './ui-types.js'
import { renderUpdateBanner, syncBanner } from './ui-banner.js'
import { renderUsage } from './ui-render-usage.js'
import {
  findUsageProject,
  isSessionExcluded,
  isSessionStateExcluded,
  paginateSessions,
  renderSession,
  renderSessionToolbar,
  sortSessions,
} from './ui-render-session.js'
import { renderRepoExplorer } from './ui-render-repo.js'
import { renderExcludedStatesSection } from './ui-render-excluded.js'
import { saveExcludedRepos, saveExcludedStates } from './ui-storage.js'
import {
  buildNotifyPanel,
  syncNotifyPanelFields,
  attachNotifyPanelEvents,
} from './ui-panel-notify.js'
import {
  buildBeepPanel,
  syncBeepPanelFields,
  attachBeepPanelEvents,
} from './ui-panel-beep.js'
import {
  buildHooksPanel,
  syncHooksPanelFields,
  attachHooksPanelEvents,
} from './ui-panel-hooks.js'

declare const __VERSION__: string

// ── Persistent UI containers (survive refresh cycles) ──
// The shell, header, and alert-controls are created once and never detached.
// Only #app-body is replaced on each 2s cycle so interactive state (open
// <select> dropdowns, text selections, focus) is preserved.
const shell = {
  shellEl: null as HTMLElement | null,
  headerEl: null as HTMLElement | null,
  bodyWrapper: null as HTMLElement | null,
  bannerWrapper: null as HTMLElement | null,
  firstRender: true,
}

// ── Persistent alert controls (never destroyed, updated in-place) ──
const panels = {
  alertControlsRoot: null as HTMLElement | null,
  notifyPanel: null as HTMLElement | null,
  beepPanel: null as HTMLElement | null,
  hooksPanel: null as HTMLElement | null,
  alertControlsLive: false,
}

// ── Alert controls in-place sync ──────────────────────────────────────────────

const syncAlertControlsInPlace = (): void => {
  if (!panels.alertControlsRoot) return

  // Beep toggle active class
  const beepToggle = panels.alertControlsRoot.querySelector<HTMLButtonElement>('#beep-toggle')
  if (beepToggle) {
    beepToggle.classList.toggle('audio-toggle--active', ui.state.beepSettingsOpen)
  }

  // Notify toggle active class
  const notifyToggle = panels.alertControlsRoot.querySelector<HTMLButtonElement>('#notify-toggle')
  if (notifyToggle) {
    notifyToggle.classList.toggle('audio-toggle--active', ui.state.notifySettingsOpen)
  }

  // Hooks toggle active class
  const hooksToggle = panels.alertControlsRoot.querySelector<HTMLButtonElement>('#hooks-toggle')
  if (hooksToggle) {
    hooksToggle.classList.toggle('audio-toggle--active', ui.state.hooksSettingsOpen)
  }

  // ── Beep panel visibility transitions ──
  {
    const s = ui.state.beepSettings
    const shouldShow = ui.state.beepSettingsOpen && s !== null

    if (shouldShow && !panels.beepPanel) {
      panels.beepPanel = buildBeepPanel(s)
      panels.alertControlsRoot.append(panels.beepPanel)
      attachBeepPanelEvents()
    } else if (shouldShow && panels.beepPanel) {
      syncBeepPanelFields(panels.beepPanel, s)
    } else if (!shouldShow && panels.beepPanel) {
      panels.beepPanel.remove()
      panels.beepPanel = null
    }
  }

  // ── Notify panel visibility transitions ──
  {
    const s = ui.state.notifySettings
    const shouldShow = ui.state.notifySettingsOpen && s !== null

    if (shouldShow && !panels.notifyPanel) {
      panels.notifyPanel = buildNotifyPanel(s)
      panels.alertControlsRoot.append(panels.notifyPanel)
      attachNotifyPanelEvents()
    } else if (shouldShow && panels.notifyPanel) {
      syncNotifyPanelFields(panels.notifyPanel, s)
    } else if (!shouldShow && panels.notifyPanel) {
      panels.notifyPanel.remove()
      panels.notifyPanel = null
    }
  }

  // ── Hooks panel visibility transitions ──
  {
    const s = ui.state.hooksSettings
    const shouldShow = ui.state.hooksSettingsOpen && s !== null

    if (shouldShow && !panels.hooksPanel) {
      panels.hooksPanel = buildHooksPanel(s)
      panels.alertControlsRoot.append(panels.hooksPanel)
      attachHooksPanelEvents()
    } else if (shouldShow && panels.hooksPanel) {
      syncHooksPanelFields(panels.hooksPanel, s)
    } else if (!shouldShow && panels.hooksPanel) {
      panels.hooksPanel.remove()
      panels.hooksPanel = null
    }
  }
}

// ── Build the initial alert controls DOM (first render only) ──

const buildAlertControls = (): HTMLElement => {
  const children: HTMLElement[] = [
    createElement('button', {
      id: 'beep-toggle',
      class: `audio-toggle${ui.state.beepSettingsOpen ? ' audio-toggle--active' : ''}`,
      type: 'button',
    }, ['Beeps']),
    createElement('button', {
      id: 'notify-toggle',
      class: `audio-toggle${ui.state.notifySettingsOpen ? ' audio-toggle--active' : ''}`,
      type: 'button',
    }, ['Notifications']),
    createElement('button', {
      id: 'hooks-toggle',
      class: `audio-toggle${ui.state.hooksSettingsOpen ? ' audio-toggle--active' : ''}`,
      type: 'button',
    }, ['Hooks']),
  ]

  return createElement('div', { class: 'alert-controls', 'aria-label': 'Alert and notification controls' }, children)
}

// ── One-time event listeners for alert controls ──

const attachAlertControlEvents = (): void => {
  if (panels.alertControlsLive) return
  panels.alertControlsLive = true

  document.querySelector<HTMLButtonElement>('#beep-toggle')?.addEventListener('click', () => {
    ui.state = { ...ui.state, beepSettingsOpen: !ui.state.beepSettingsOpen }
    render()
  })

  document.querySelector<HTMLButtonElement>('#notify-toggle')?.addEventListener('click', () => {
    ui.state = { ...ui.state, notifySettingsOpen: !ui.state.notifySettingsOpen }
    render()
  })

  document.querySelector<HTMLButtonElement>('#hooks-toggle')?.addEventListener('click', () => {
    ui.state = { ...ui.state, hooksSettingsOpen: !ui.state.hooksSettingsOpen }
    render()
  })
}

// ── Body content (rebuilt on each 2s refresh cycle) ──

const buildBodyContent = (): ReadonlyArray<HTMLElement> => {
  // Pre-compute filtered + sorted + paged sessions for the grid
  const gridEligible = ui.state.sessions.filter((session) => {
    if (ui.state.excludedRepos.size > 0 && isSessionExcluded(session)) return false
    if (isSessionStateExcluded(session)) return false
    if (ui.state.selectedRepo) {
      const project = findUsageProject(session, ui.state.usage)
      return project?.project === ui.state.selectedRepo
    }
    return true
  })
  const sorted = sortSessions(gridEligible, ui.state.sortMode)
  const { page: pagedSessions, currentPage } = paginateSessions(
    sorted,
    ui.state.pageSize,
    ui.state.pageIndex,
  )
  // Clamp pageIndex if it drifted out of bounds after a filter change
  const safePageIndex = currentPage - 1
  if (safePageIndex !== ui.state.pageIndex) {
    ui.state = { ...ui.state, pageIndex: safePageIndex }
  }

  return [
    renderUsage(ui.state.usage),
    ui.state.usage?.available ? renderRepoExplorer(ui.state.usage) : createElement('section', { class: 'repo-explorer repo-explorer--empty', 'aria-label': 'Repo cost explorer' }, [
      createElement('h2', {}, ['Costs by repo']),
      createElement('p', {}, ['ccusage data is not available.']),
    ]),
    createElement('section', { class: 'summary', 'aria-label': 'Status summary' }, [
      ...(['finished', 'idle', 'working', 'attention'] as const).map((status) =>
        createElement('div', { class: `summary__item summary__item--${statusToColor[status]}${ui.state.excludedStates.has(status) ? ' summary__item--dimmed' : ''}` }, [
          createElement('span', {}, [statusLabels[status], ui.state.excludedStates.has(status) ? ' (hidden)' : '']),
          createElement('strong', {}, [String(ui.state.sessions.filter((session) => {
            if (session.status !== status) return false
            if (ui.state.excludedRepos.size > 0 && isSessionExcluded(session)) return false
            if (ui.state.selectedRepo) {
              const project = findUsageProject(session, ui.state.usage)
              return project?.project === ui.state.selectedRepo
            }
            return true
          }).length)]),
          createElement('button', {
            class: 'summary__item__exclude',
            type: 'button',
            'data-exclude-state': status,
            'aria-label': ui.state.excludedStates.has(status)
              ? `Show ${statusLabels[status]} sessions again`
              : `Hide ${statusLabels[status]} sessions`,
            title: ui.state.excludedStates.has(status)
              ? `Show ${statusLabels[status]} sessions again`
              : `Hide ${statusLabels[status]} sessions from the grid`,
          }, ['✕']),
        ]),
      ),
    ]),
    ...(() => { const s = renderExcludedStatesSection(); return s ? [s] : [] })(),
    ...(ui.state.sessions.length === 0
      ? [createElement('section', { class: 'empty' }, (() => {
          const hooksInstalled = ui.state.hooksSettings?.installed === true

          if (hooksInstalled) {
            return [
              createElement('h2', {}, ['No sessions registered']),
              createElement('p', {}, [
                'Hooks are installed and working. Open Claude Code in any project — sessions will appear here automatically.',
              ]),
              createElement('p', { class: 'empty__or' }, ['Or test with curl:']),
              createElement('pre', { class: 'empty__snippet' }, [
                'curl -X POST http://localhost:8787/api/sessions \\\n',
                '  -H "Content-Type: application/json" \\\n',
                `  -d '{"name":"test","status":"orange"}'`,
              ]),
            ]
          }

          return [
            createElement('h2', {}, ['No sessions registered']),
            createElement('p', {}, [
              'Click ',
              createElement('strong', {}, ['Hooks']),
              ' in the toolbar above to install the Claude Code plugin — sessions will appear here automatically.',
            ]),
            createElement('p', { class: 'empty__or' }, ['Or test with curl:']),
            createElement('pre', { class: 'empty__snippet' }, [
              'curl -X POST http://localhost:8787/api/sessions \\\n',
              '  -H "Content-Type: application/json" \\\n',
              `  -d '{"name":"test","status":"orange"}'`,
            ]),
          ]
        })())]
      : [
          renderSessionToolbar(gridEligible.length) as HTMLElement,
          createElement('section', { class: 'grid', 'aria-label': 'Claude Code sessions' }, pagedSessions.map(renderSession)),
        ].filter((el): el is HTMLElement => el !== null)
    ),
  ]
}

// ── Attach body events (re-attached after each rebuild) ──

const attachBodyEvents = (): void => {
  document.querySelectorAll<HTMLButtonElement>('[data-cost-window]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.state = { ...ui.state, costWindow: button.dataset.costWindow as CostWindow, selectedRepo: null, pageIndex: 0 }
      render()
    })
  })

  document.querySelectorAll<HTMLElement>('[data-repo]').forEach((card) => {
    card.addEventListener('click', () => {
      ui.state = { ...ui.state, selectedRepo: card.dataset.repo ?? null, pageIndex: 0 }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-repo-back]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.state = { ...ui.state, selectedRepo: null, pageIndex: 0 }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-exclude-repo]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const repo = button.dataset.excludeRepo
      if (!repo) return
      const next = new Set(ui.state.excludedRepos)
      next.add(repo)
      saveExcludedRepos(next)
      ui.state = {
        ...ui.state,
        excludedRepos: next,
        selectedRepo: ui.state.selectedRepo === repo ? null : ui.state.selectedRepo,
        pageIndex: 0,
      }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-unexclude-repo]').forEach((button) => {
    button.addEventListener('click', () => {
      const fullKey = button.dataset.unexcludeRepo
      if (!fullKey || !ui.state.excludedRepos.has(fullKey)) return
      const next = new Set(ui.state.excludedRepos)
      next.delete(fullKey)
      saveExcludedRepos(next)
      ui.state = { ...ui.state, excludedRepos: next, pageIndex: 0 }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-exclude-state]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const status = button.dataset.excludeState as SessionStatus | undefined
      if (!status || !['finished', 'idle', 'working', 'attention'].includes(status)) return
      const next = new Set(ui.state.excludedStates)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      saveExcludedStates(next)
      ui.state = { ...ui.state, excludedStates: next, pageIndex: 0 }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-unexclude-state]').forEach((button) => {
    button.addEventListener('click', () => {
      const status = button.dataset.unexcludeState as SessionStatus | undefined
      if (!status || !ui.state.excludedStates.has(status)) return
      const next = new Set(ui.state.excludedStates)
      next.delete(status)
      saveExcludedStates(next)
      ui.state = { ...ui.state, excludedStates: next, pageIndex: 0 }
      render()
    })
  })

  // ── Sort mode ──
  document.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const sortMode = button.dataset.sort as SortMode
      ui.state = { ...ui.state, sortMode, pageIndex: 0 }
      render()
    })
  })

  // ── Page size ──
  document.querySelectorAll<HTMLButtonElement>('[data-page-size]').forEach((button) => {
    button.addEventListener('click', () => {
      const pageSize = Number(button.dataset.pageSize)
      if (Number.isNaN(pageSize) || pageSize <= 0) return
      ui.state = { ...ui.state, pageSize, pageIndex: 0 }
      render()
    })
  })

  // ── Page navigation ──
  document.querySelectorAll<HTMLButtonElement>('[data-page="prev"]').forEach((button) => {
    button.addEventListener('click', () => {
      if (ui.state.pageIndex > 0) {
        ui.state = { ...ui.state, pageIndex: ui.state.pageIndex - 1 }
        render()
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-page="next"]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.state = { ...ui.state, pageIndex: ui.state.pageIndex + 1 }
      render()
    })
  })
}

// ── The render function ────────────────────────────────────────────────────────

export const render = (): void => {
  const root = document.querySelector<HTMLDivElement>('#app')
  if (!root) {
    throw new Error('Missing #app root element.')
  }

  if (shell.firstRender) {
    // ── First render: create persistent containers ──
    shell.bannerWrapper = createElement('div', { id: 'app-banner' })
    shell.shellEl = createElement('main', { class: 'shell' })
    shell.headerEl = createElement('header', { class: 'header' })
    shell.bodyWrapper = createElement('div', { id: 'app-body' })

    // Build header content
    const banner = renderUpdateBanner()
    if (banner) {
      shell.bannerWrapper.append(banner)
      shell.bannerWrapper.querySelector('.update-banner__dismiss')?.addEventListener('click', () => {
        if (ui.state.latestVersion) {
          sessionStorage.setItem('version-banner-dismissed', ui.state.latestVersion)
        }
        ui.state = { ...ui.state, updateAvailable: false }
        render()
      })
    }

    panels.alertControlsRoot = buildAlertControls()
    shell.headerEl.append(
      createElement('div', {}, [
        createElement('p', { class: 'eyebrow' }, [
          'Local Claude Code monitor',
          createElement('a', {
            class: 'help-link',
            href: 'https://github.com/danielcg-net/claude_status_dashboard#readme',
            target: '_blank',
            rel: 'noopener',
            title: 'Help & documentation',
          }, ['Help']),
        ]),
        createElement('h1', {}, ['Claude Session Dashboard', createElement('span', { class: 'version-badge' }, [`v${__VERSION__}`])]),
      ]),
      panels.alertControlsRoot,
    )

    shell.shellEl.append(shell.headerEl, shell.bodyWrapper)
    root.replaceChildren(...[shell.bannerWrapper, shell.shellEl].filter((el): el is HTMLElement => el !== null))

    // Initial body content
    shell.bodyWrapper.replaceChildren(...buildBodyContent())

    // One-time alert-control event listeners
    attachAlertControlEvents()

    // Body event listeners
    attachBodyEvents()

    // Show notify panel if already open at startup
    if (ui.state.notifySettingsOpen && ui.state.notifySettings) {
      panels.notifyPanel = buildNotifyPanel(ui.state.notifySettings)
      panels.alertControlsRoot.append(panels.notifyPanel)
      attachNotifyPanelEvents()
    }

    // Show beep panel if already open at startup
    if (ui.state.beepSettingsOpen && ui.state.beepSettings) {
      panels.beepPanel = buildBeepPanel(ui.state.beepSettings)
      panels.alertControlsRoot.append(panels.beepPanel)
      attachBeepPanelEvents()
    }

    // Show hooks panel if already open at startup
    if (ui.state.hooksSettingsOpen && ui.state.hooksSettings) {
      panels.hooksPanel = buildHooksPanel(ui.state.hooksSettings)
      panels.alertControlsRoot.append(panels.hooksPanel)
      attachHooksPanelEvents()
    }

    shell.firstRender = false
    return
  }

  // ── Subsequent renders: sync persistent sections, rebuild body ──
  syncBanner(shell.bannerWrapper!, render)
  syncAlertControlsInPlace()

  // Capture open state of <details> elements before rebuild
  const prevOpenRepos = shell.bodyWrapper!.querySelector('details.excluded-details:not(.excluded-details--states)')?.hasAttribute('open') ?? false
  const prevOpenStates = shell.bodyWrapper!.querySelector('details.excluded-details--states')?.hasAttribute('open') ?? false

  shell.bodyWrapper!.replaceChildren(...buildBodyContent())

  // Restore open state after rebuild
  if (prevOpenRepos) {
    shell.bodyWrapper!.querySelector('details.excluded-details:not(.excluded-details--states)')?.setAttribute('open', '')
  }
  if (prevOpenStates) {
    shell.bodyWrapper!.querySelector('details.excluded-details--states')?.setAttribute('open', '')
  }

  attachBodyEvents()
}
