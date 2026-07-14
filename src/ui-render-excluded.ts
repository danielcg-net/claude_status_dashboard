// Excluded repos and states sections — expandable details elements.

import { createElement } from './ui-dom.js'
import { shortProjectName } from './client-utils.js'
import { ui } from './ui-state.js'
import type { SessionStatus, UsageProject } from './ui-types.js'
import { statusLabels } from './ui-types.js'

export const renderExcludedReposSection = (usage: { readonly projects: Readonly<Record<string, UsageProject>> }): HTMLElement | null => {
  if (ui.state.excludedRepos.size === 0) return null

  const tags = [...ui.state.excludedRepos]
    .filter((key) => key in usage.projects)
    .map((key) => ({
      key,
      display: shortProjectName(key),
    }))
    .sort((a, b) => a.display.localeCompare(b.display))

  if (tags.length === 0) return null

  return createElement('details', { class: 'excluded-details' }, [
    createElement('summary', { class: 'excluded-details__summary' }, [
      `Excluded repos (${tags.length}) — click to manage`,
    ]),
    createElement('div', { class: 'excluded-details__tags' }, [
      ...tags.map(({ key, display }) =>
        createElement('span', { class: 'excluded-details__tag' }, [
          createElement('span', {}, [display]),
          createElement('button', {
            type: 'button',
            'data-unexclude-repo': key,
            'aria-label': `Include ${display} again`,
            title: `Include ${display} again`,
          }, ['✕']),
        ]),
      ),
    ]),
  ])
}

export const renderExcludedStatesSection = (): HTMLElement | null => {
  if (ui.state.excludedStates.size === 0) return null

  const sortedStates = (['finished', 'idle', 'working', 'attention'] as const)
    .filter((s) => ui.state.excludedStates.has(s))

  return createElement('details', { class: 'excluded-details excluded-details--states' }, [
    createElement('summary', { class: 'excluded-details__summary' }, [
      `Excluded states (${sortedStates.length}) — click to manage`,
    ]),
    createElement('div', { class: 'excluded-details__tags' }, [
      ...sortedStates.map((status) =>
        createElement('span', { class: 'excluded-details__tag' }, [
          createElement('span', {}, [statusLabels[status]]),
          createElement('button', {
            type: 'button',
            'data-unexclude-state': status,
            'aria-label': `Show ${statusLabels[status]} sessions again`,
            title: `Show ${statusLabels[status]} sessions again`,
          }, ['✕']),
        ]),
      ),
    ]),
  ])
}
