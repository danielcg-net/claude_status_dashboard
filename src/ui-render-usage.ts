// Usage section rendering — cost windows, metrics, active block, excluded repos.

import { costWindowLabels, daysForWindow, recentUsageDays, sumUsageDays, usageUnavailableMessage } from './client-utils.js'
import { createElement } from './ui-dom.js'
import { formatDayLabel, formatMoney, formatNumber, formatRelative, formatDateLabel, formatLocalTime } from './ui-format.js'
import { ui } from './ui-state.js'
import type { CostWindow, UsageDay, UsageProject, UsageSummary, UsageTotals } from './ui-types.js'
import { costWindowOrder } from './ui-types.js'
import { renderExcludedReposSection } from './ui-render-excluded.js'

export const usageMetric = (label: string, value: string): HTMLElement =>
  createElement('div', { class: 'usage__metric' }, [
    createElement('span', {}, [label]),
    createElement('strong', {}, [value]),
  ])

export const usageDaysForWindow = (usage: { readonly projects: Readonly<Record<string, UsageProject>> }, costWindow: CostWindow): readonly UsageDay[] =>
  daysForWindow(
    Object.values(usage.projects)
      .filter((project) => !ui.state.excludedRepos.has(project.project))
      .flatMap((project) => project.days),
    costWindow,
  )

export const renderCostWindowControls = (): HTMLElement =>
  createElement('div', { class: 'usage__windows', role: 'group', 'aria-label': 'Cost timeframe' }, [
    ...costWindowOrder.map((costWindow) =>
      createElement(
        'button',
        {
          class: `usage__window${ui.state.costWindow === costWindow ? ' usage__window--active' : ''}`,
          type: 'button',
          'data-cost-window': costWindow,
        },
        [costWindowLabels[costWindow]],
      ),
    ),
  ])

export const renderUsage = (usage: UsageSummary | null): HTMLElement => {
  if (!usage) {
    return createElement('section', { class: 'usage usage--loading', 'aria-label': 'Claude usage' }, [
      createElement('h2', {}, ['Claude usage']),
      createElement('p', {}, ['Loading ccusage data...']),
    ])
  }

  if (!usage.available) {
    // `error` comes off the wire, so narrow it once here and treat anything
    // that is not a non-empty string as "no detail" — both the headline and
    // the verbatim paragraph below rely on this, not on the declared type.
    const errorDetail = typeof usage.error === 'string' && usage.error.trim().length > 0 ? usage.error : null

    return createElement('section', { class: 'usage usage--unavailable', 'aria-label': 'Claude usage' }, [
      createElement('h2', {}, ['Claude usage']),
      createElement('p', {}, [usageUnavailableMessage(errorDetail)]),
      // Surface the underlying failure verbatim — the hint above is an
      // interpretation, this is what actually went wrong.
      ...(errorDetail === null ? [] : [createElement('p', { class: 'usage__error' }, [errorDetail])]),
    ])
  }

  const activeBlock = usage.activeBlock
  const windowTotals = sumUsageDays(usageDaysForWindow(usage, ui.state.costWindow))

  return createElement('section', { class: 'usage', 'aria-label': 'Claude usage' }, [
    createElement('div', { class: 'usage__header' }, [
      createElement('div', {}, [
        createElement('p', { class: 'usage__eyebrow' }, ['ccusage']),
        createElement('h2', {}, ['Claude usage']),
      ]),
      createElement('div', { class: 'usage__actions' }, [
        renderCostWindowControls(),
        createElement('span', { class: 'usage__freshness', ...(() => {
          const t = formatLocalTime(usage.generatedAt)
          return t !== null ? { title: t } : {}
        })() }, [`Updated ${formatRelative(usage.generatedAt)}`]),
      ]),
    ]),
    createElement('div', { class: 'usage__metrics' }, [
      usageMetric(`Cost · ${costWindowLabels[ui.state.costWindow]}`, formatMoney(windowTotals.totalCost)),
      usageMetric(`Tokens · ${costWindowLabels[ui.state.costWindow]}`, formatNumber(windowTotals.totalTokens)),
      usageMetric(
        'Matched repos',
        (() => {
          const total = Object.keys(usage.projects).length
          if (ui.state.excludedRepos.size === 0) return formatNumber(total)
          const activeExclusions = [...ui.state.excludedRepos].filter((k) => k in usage.projects).length
          return `${formatNumber(total - activeExclusions)}/${formatNumber(total)}`
        })(),
      ),
      usageMetric('Active block', activeBlock ? formatMoney(activeBlock.totalCost) : 'None'),
    ]),
    createElement('div', { class: 'usage__block' }, [
      createElement('span', { class: activeBlock ? 'usage__block-dot usage__block-dot--active' : 'usage__block-dot' }),
      createElement('span', {}, [
        activeBlock
          ? `Active block ${formatDateLabel(activeBlock.startTime)}-${formatDateLabel(activeBlock.endTime)} · ${formatMoney(
              activeBlock.totalCost,
            )} · ${formatNumber(activeBlock.totalTokens)} tokens` +
            (activeBlock.modelsUsed.length > 0 ? ` · ${activeBlock.modelsUsed.join(', ')}` : '')
          : 'No active usage block reported',
      ]),
    ]),
    ...(() => { const s = renderExcludedReposSection(usage); return s ? [s] : [] })(),
  ])
}
