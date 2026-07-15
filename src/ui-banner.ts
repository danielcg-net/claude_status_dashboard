// Update-available banner — renders and syncs version notifications.

import { triggerUpdate } from './ui-api.js'
import { createElement } from './ui-dom.js'
import { ui } from './ui-state.js'
import { showToast } from './ui-toast.js'

declare const __VERSION__: string

const versionBannerDismissedUntilKey = 'version-banner-dismissed-until'
const versionBannerSkippedKey = 'version-banner-skipped'

// Temporary dismissal: banner stays hidden for this many ms after clicking ✕
const TEMPORARY_DISMISS_MS = 24 * 60 * 60 * 1000 // 24 hours

// ── Shared helpers ──────────────────────────────────────────────

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    try { document.execCommand('copy'); return true } catch { return false } finally { ta.remove() }
  }
}

const makeCopyButton = (text: string): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.className = 'update-banner__copy'
  btn.type = 'button'
  btn.title = 'Copy'
  btn.textContent = '📋'
  btn.addEventListener('click', async () => {
    const ok = await copyToClipboard(text)
    showToast(ok ? 'Copied' : 'Failed to copy', ok ? 'success' : 'error')
  })
  return btn
}

const makeDismissButton = (
  onDismiss: () => void,
  temporarilyDismissUpdate = false,
): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.className = 'update-banner__dismiss'
  btn.type = 'button'
  btn.setAttribute('aria-label', temporarilyDismissUpdate ? 'Dismiss temporarily (banner will reappear later)' : 'Dismiss')
  btn.title = temporarilyDismissUpdate ? 'Dismiss temporarily' : 'Dismiss'
  btn.textContent = '✕'
  btn.addEventListener('click', () => {
    if (temporarilyDismissUpdate) {
      localStorage.setItem(
        versionBannerDismissedUntilKey,
        String(Date.now() + TEMPORARY_DISMISS_MS),
      )
    }
    ui.state = { ...ui.state, updateAvailable: false, deploymentMessage: null }
    onDismiss()
  })
  return btn
}

const makeSkipButton = (onDismiss: () => void): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.className = 'update-banner__skip'
  btn.type = 'button'
  btn.setAttribute('aria-label', 'Skip this version permanently')
  btn.title = 'Skip this version'
  btn.textContent = 'Skip this version'
  btn.addEventListener('click', () => {
    if (ui.state.latestVersion) {
      localStorage.setItem(versionBannerSkippedKey, ui.state.latestVersion)
    }
    ui.state = { ...ui.state, updateAvailable: false, deploymentMessage: null }
    onDismiss()
  })
  return btn
}

// ── Banner builders ─────────────────────────────────────────────

const makeUpdateButton = (sync: () => void): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.className = 'update-banner__action'
  btn.type = 'button'
  btn.textContent = 'How to update'
  btn.addEventListener('click', async () => {
    try {
      const result = await triggerUpdate()
      ui.state = { ...ui.state, deploymentMessage: result.message }
      sync()
    } catch {
      showToast('Update request failed. Check server logs.', 'error')
    }
  })
  return btn
}

const buildBanner = (sync: () => void, onDismiss: () => void): HTMLElement => {
  const latest = ui.state.latestVersion ?? 'unknown'
  const current = __VERSION__

  const actionBtn = makeUpdateButton(sync)
  const skipBtn = makeSkipButton(onDismiss)
  const dismissBtn = makeDismissButton(onDismiss, true)

  return createElement('aside', { class: 'update-banner', role: 'status', 'aria-label': 'Update available' }, [
    createElement('div', { class: 'update-banner__body' }, [
      createElement('span', { class: 'update-banner__icon' }, ['↑']),
      createElement('span', {}, [
        'A new version is available: ',
        createElement('strong', {}, [`v${latest}`]),
        ` (you are on v${current}). `,
        createElement(
          'a',
          {
            href: 'https://github.com/danielcg-net/claude_status_dashboard/releases',
            target: '_blank',
            rel: 'noopener',
          },
          ['View releases'],
        ),
        ' ',
        actionBtn,
      ]),
    ]),
    skipBtn,
    dismissBtn,
  ])
}

const COMMAND_LABELS: Record<string, string> = {
  'npm install -g claude-status-dashboard@latest':
    'Use this if you installed globally with npm install -g',
  'npx claude-status-dashboard@latest':
    'Use this to run directly without installing',
}

const buildCommandRow = (line: string): HTMLElement => {
  const label = COMMAND_LABELS[line] ?? ''
  return createElement('div', { class: 'update-banner__command-row' }, [
    createElement('div', { class: 'update-banner__command-block' }, [
      createElement('code', { class: 'update-banner__code' }, [line]),
      label
        ? createElement('span', { class: 'update-banner__command-label' }, [label])
        : null,
    ].filter((el): el is HTMLElement => el !== null)),
    makeCopyButton(line),
  ])
}

const buildInstructionsBanner = (command: string, onDismiss: () => void): HTMLElement => {
  const lines = command.split('\n').filter((l) => l.length > 0)
  const dismissBtn = makeDismissButton(onDismiss)

  return createElement('aside', { class: 'update-banner', role: 'status', 'aria-label': 'Update instructions' }, [
    createElement('div', { class: 'update-banner__body' }, [
      createElement('span', { class: 'update-banner__icon' }, ['↑']),
      createElement('span', {}, ['Run one of these in your terminal:']),
    ]),
    ...lines.map(buildCommandRow),
    dismissBtn,
  ])
}

// ── Sync ────────────────────────────────────────────────────────

export const syncBanner = (bannerWrapper: HTMLElement, onDismiss: () => void): void => {
  const sync = (): void => syncBanner(bannerWrapper, onDismiss)

  // Permanent skip: user explicitly clicked "Skip this version"
  const permanentlySkipped =
    !ui.state.deploymentMessage &&
    localStorage.getItem(versionBannerSkippedKey) === ui.state.latestVersion

  // Temporary dismiss: user clicked ✕ — applies for TEMPORARY_DISMISS_MS
  const temporarilyDismissed =
    !ui.state.deploymentMessage &&
    Number(localStorage.getItem(versionBannerDismissedUntilKey) || '0') > Date.now()

  const dismissed = permanentlySkipped || temporarilyDismissed

  if (!ui.state.updateAvailable && !ui.state.deploymentMessage) {
    bannerWrapper.replaceChildren()
    return
  }

  if (dismissed) {
    bannerWrapper.replaceChildren()
    return
  }

  if (ui.state.deploymentMessage !== null) {
    const existing = bannerWrapper.querySelector('.update-banner')
    const existingCode = existing?.querySelector('.update-banner__code')?.textContent
    if (existingCode === ui.state.deploymentMessage) return
    bannerWrapper.replaceChildren(buildInstructionsBanner(ui.state.deploymentMessage, onDismiss))
    return
  }

  const existing = bannerWrapper.querySelector('.update-banner')
  const latest = ui.state.latestVersion ?? 'unknown'
  const existingStrong = existing?.querySelector('strong')?.textContent
  if (existingStrong === `v${latest}`) return

  bannerWrapper.replaceChildren(buildBanner(sync, onDismiss))
}
