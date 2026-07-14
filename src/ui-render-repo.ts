// Repo cards, detail view, and repo explorer rendering.

import {
  aggregateModelBreakdowns,
  daysForWindow,
  projectKeyToPath,
  recentUsageDays,
  shortProjectName,
  sumUsageDays,
} from './client-utils.js'
import { createElement } from './ui-dom.js'
import { formatDayLabel, formatMoney, formatNumber } from './ui-format.js'
import { ui } from './ui-state.js'
import type { UsageDay, UsageProject, UsageSummary } from './ui-types.js'
import { costWindowLabels, MODEL_COLORS } from './ui-types.js'

export const renderRepoCard = (project: UsageProject): HTMLElement => {
  const windowDays = daysForWindow(project.days, ui.state.costWindow)
  const totals = sumUsageDays(windowDays)
  const recentDays = recentUsageDays(windowDays)
  const maxCost = Math.max(...recentDays.map((day) => day.totalCost), 0)
  const isSelected = ui.state.selectedRepo === project.project

  return createElement('article', {
    class: `repo-card${isSelected ? ' repo-card--selected' : ''}`,
    'data-repo': project.project,
  }, [
    createElement('div', { class: 'repo-card__header' }, [
      createElement('h3', { class: 'repo-card__name', title: projectKeyToPath(project.project) }, [shortProjectName(project.project)]),
      createElement('span', { class: 'repo-card__cost' }, [formatMoney(totals.totalCost)]),
      createElement('button', {
        class: 'repo-card__exclude',
        type: 'button',
        'data-exclude-repo': project.project,
        'aria-label': `Exclude ${shortProjectName(project.project)}`,
        title: 'Exclude this repo from the dashboard',
      }, ['✕']),
    ]),
    createElement('div', { class: 'repo-card__metrics' }, [
      createElement('div', {}, [
        createElement('span', {}, ['Tokens']),
        createElement('strong', {}, [formatNumber(totals.totalTokens)]),
      ]),
      createElement('div', {}, [
        createElement('span', {}, ['Days']),
        createElement('strong', {}, [String(windowDays.length)]),
      ]),
      createElement('div', {}, [
        createElement('span', {}, ['Input']),
        createElement('strong', {}, [formatNumber(totals.inputTokens)]),
      ]),
      createElement('div', {}, [
        createElement('span', {}, ['Output']),
        createElement('strong', {}, [formatNumber(totals.outputTokens)]),
      ]),
    ]),
    ...(() => {
      const models = aggregateModelBreakdowns(project.days, ui.state.costWindow)
      if (models.length === 0) return [] as HTMLElement[]
      const maxModelCost = Math.max(...models.map((m) => m.cost), 0)
      return [createElement('div', { class: 'model-breakdown' }, [
        createElement('div', { class: 'model-breakdown__bars' },
          models.map((m, i) =>
            createElement('div', { class: 'model-breakdown__bar' }, [
              createElement('span', { class: 'model-breakdown__label' }, [m.modelName]),
              createElement('span', { class: 'model-breakdown__cost' }, [formatMoney(m.cost)]),
              createElement('span', { class: 'model-breakdown__bar-fill', style: `--bar-width: ${maxModelCost > 0 ? Math.max(4, Math.round((m.cost / maxModelCost) * 100)) : 0}%; --bar-color: ${MODEL_COLORS[i % MODEL_COLORS.length]}` }),
            ]),
          ),
        ),
      ])]
    })(),
    recentDays.length === 0
      ? createElement('div', { class: 'repo-card__daily-empty' }, ['No usage in this window'])
      : createElement(
          'div',
          { class: 'repo-card__daily', 'aria-label': `Daily ${project.project} usage` },
          recentDays.map((day) =>
            createElement('div', { class: 'repo-card__daily-row' }, [
              createElement('span', { class: 'repo-card__daily-date' }, [formatDayLabel(day.date)]),
              createElement('span', {
                class: 'repo-card__daily-bar',
                style: `--bar-width: ${maxCost > 0 ? Math.max(4, Math.round((day.totalCost / maxCost) * 100)) : 0}%`,
              }),
              createElement('span', { class: 'repo-card__daily-cost' }, [formatMoney(day.totalCost)]),
            ]),
          ),
        ),
  ])
}

export const renderRepoDetail = (project: UsageProject): HTMLElement => {
  const windowDays = daysForWindow(project.days, ui.state.costWindow)
  const totals = sumUsageDays(windowDays)
  const allDays = [...windowDays]
    .filter((day) => day.totalCost > 0 || day.totalTokens > 0)
    .sort((left, right) => right.date.localeCompare(left.date))
  const maxCost = Math.max(...allDays.map((day) => day.totalCost), 0)

  return createElement('section', { class: 'repo-detail', 'aria-label': `${project.project} cost detail` }, [
    createElement('div', { class: 'repo-detail__header' }, [
      createElement('button', {
        class: 'repo-detail__back',
        type: 'button',
        'data-repo-back': '',
      }, ['← All repos']),
      createElement('div', {}, [
        createElement('h2', {}, [shortProjectName(project.project)]),
        createElement('p', { class: 'repo-detail__path' }, [projectKeyToPath(project.project)]),
        createElement('p', { class: 'repo-detail__subtitle' }, [
          `${formatMoney(totals.totalCost)} · ${formatNumber(totals.totalTokens)} tokens · ${allDays.length} days`,
        ]),
      ]),
    ]),
    createElement('div', { class: 'repo-detail__metrics' }, [
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, [`Cost · ${costWindowLabels[ui.state.costWindow]}`]),
        createElement('strong', {}, [formatMoney(totals.totalCost)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Input tokens']),
        createElement('strong', {}, [formatNumber(totals.inputTokens)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Output tokens']),
        createElement('strong', {}, [formatNumber(totals.outputTokens)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Cache creation']),
        createElement('strong', {}, [formatNumber(totals.cacheCreationTokens)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Cache read']),
        createElement('strong', {}, [formatNumber(totals.cacheReadTokens)]),
      ]),
      createElement('div', { class: 'usage__metric' }, [
        createElement('span', {}, ['Total tokens']),
        createElement('strong', {}, [formatNumber(totals.totalTokens)]),
      ]),
    ]),
    allDays.length === 0
      ? createElement('p', { class: 'repo-detail__empty' }, ['No usage in this window'])
      : createElement(
          'div',
          { class: 'repo-detail__days', 'aria-label': `Daily breakdown for ${project.project}` },
          allDays.map((day) =>
            createElement('div', { class: 'repo-detail__day' }, [
              createElement('div', { class: 'repo-detail__day-header' }, [
                createElement('span', { class: 'repo-detail__day-date' }, [formatDayLabel(day.date)]),
                createElement('span', { class: 'repo-detail__day-cost' }, [formatMoney(day.totalCost)]),
              ]),
              createElement('div', {
                class: 'repo-detail__day-bar',
                style: `--bar-width: ${maxCost > 0 ? Math.max(2, Math.round((day.totalCost / maxCost) * 100)) : 0}%`,
              }),
              createElement('div', { class: 'repo-detail__day-metrics' }, [
                createElement('span', {}, [`${formatNumber(day.totalTokens)} tokens`]),
                createElement('span', {}, [`${formatNumber(day.inputTokens)} in / ${formatNumber(day.outputTokens)} out`]),
                day.modelBreakdowns.length > 0
                  ? createElement('span', {}, [day.modelBreakdowns.map((b) => `${b.modelName} ${formatMoney(b.cost)}`).join(', ')])
                  : day.modelsUsed.length > 0
                    ? createElement('span', {}, [day.modelsUsed.join(', ')])
                    : createElement('span', {}, ['—']),
              ]),
            ]),
          ),
        ),
  ])
}

export const renderRepoExplorer = (usage: UsageSummary): HTMLElement => {
  const allProjects = Object.values(usage.projects)
    .filter((project) => {
      const windowDays = daysForWindow(project.days, ui.state.costWindow)
      return windowDays.some((day) => day.totalCost > 0 || day.totalTokens > 0)
    })
    .sort((left, right) => {
      const leftTotals = sumUsageDays(daysForWindow(left.days, ui.state.costWindow))
      const rightTotals = sumUsageDays(daysForWindow(right.days, ui.state.costWindow))
      return rightTotals.totalCost - leftTotals.totalCost
    })

  const projects = allProjects.filter((p) => !ui.state.excludedRepos.has(p.project))

  if (allProjects.length === 0) {
    return createElement('section', { class: 'repo-explorer repo-explorer--empty', 'aria-label': 'Repo cost explorer' }, [
      createElement('h2', {}, ['Costs by repo']),
      createElement('p', {}, ['No repo usage data available for the selected window.']),
    ])
  }

  // If a repo is selected, show its detail view
  if (ui.state.selectedRepo) {
    const selected = projects.find((p) => p.project === ui.state.selectedRepo)
    if (selected) {
      return createElement('section', { class: 'repo-explorer', 'aria-label': 'Repo cost explorer' }, [
        renderRepoDetail(selected),
      ])
    }
  }

  const activeExclusions = [...ui.state.excludedRepos].filter((k) => k in usage.projects).length

  return createElement('section', { class: 'repo-explorer', 'aria-label': 'Repo cost explorer' }, [
    createElement('div', { class: 'repo-explorer__header' }, [
      createElement('h2', {}, ['Costs by repo']),
      createElement('span', { class: 'repo-explorer__count' }, [
        `${projects.length} repo${projects.length === 1 ? '' : 's'}${activeExclusions > 0 ? ` (${activeExclusions} excluded)` : ''}`,
      ]),
    ]),
    projects.length === 0
      ? createElement('p', { class: 'repo-explorer__all-excluded' }, ['All repos with usage data in this window are excluded. Include some from the ccusage card above to see them.'])
      : createElement('div', { class: 'repo-explorer__grid' }, projects.map(renderRepoCard)),
  ])
}
