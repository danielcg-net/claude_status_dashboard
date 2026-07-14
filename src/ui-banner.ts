// Update-available banner — renders, syncs, and dismisses version notifications.

import { createElement } from './ui-dom.js'
import { ui } from './ui-state.js'

declare const __VERSION__: string

const versionBannerDismissedKey = 'version-banner-dismissed'

export const renderUpdateBanner = (): HTMLElement | null => {
  if (!ui.state.updateAvailable) return null
  if (sessionStorage.getItem(versionBannerDismissedKey) === ui.state.latestVersion) return null

  const latest = ui.state.latestVersion ?? 'unknown'
  const current = __VERSION__

  return createElement('aside', { class: 'update-banner', role: 'status', 'aria-label': 'Update available' }, [
    createElement('div', { class: 'update-banner__body' }, [
      createElement('span', { class: 'update-banner__icon' }, ['↑']),
      createElement('span', {}, [
        `A new version is available: `,
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
      ]),
    ]),
    createElement('button', {
      class: 'update-banner__dismiss',
      type: 'button',
      'aria-label': 'Dismiss update notification',
      title: 'Dismiss',
    }, ['✕']),
  ])
}

export const dismissBanner = (): void => {
  if (ui.state.latestVersion) {
    sessionStorage.setItem(versionBannerDismissedKey, ui.state.latestVersion)
  }
  ui.state = { ...ui.state, updateAvailable: false }
}

export const attachBannerDismiss = (container: HTMLElement): void => {
  container.querySelector('.update-banner__dismiss')?.addEventListener('click', () => {
    if (ui.state.latestVersion) {
      sessionStorage.setItem(versionBannerDismissedKey, ui.state.latestVersion)
    }
    ui.state = { ...ui.state, updateAvailable: false }
    // render() will be called by the caller
  })
}

export const syncBanner = (bannerWrapper: HTMLElement): void => {
  const newBanner = renderUpdateBanner()
  const existingBanner = bannerWrapper.querySelector('.update-banner')

  if (!newBanner && existingBanner) {
    existingBanner.remove()
  } else if (newBanner && !existingBanner) {
    bannerWrapper.replaceChildren(newBanner)
    attachBannerDismiss(bannerWrapper)
  } else if (newBanner && existingBanner) {
    const newStrong = newBanner.querySelector('strong')?.textContent
    const oldStrong = existingBanner.querySelector('strong')?.textContent
    if (newStrong && newStrong !== oldStrong) {
      bannerWrapper.replaceChildren(newBanner)
      attachBannerDismiss(bannerWrapper)
    }
  }
}
