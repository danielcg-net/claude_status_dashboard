// Toast notification for the browser UI.
// Mutates the DOM — import only in browser context.

import { createElement } from './ui-dom.js'

const toastTimers = { primary: null as ReturnType<typeof setTimeout> | null, fallback: null as ReturnType<typeof setTimeout> | null }

export const showToast = (message: string, type: 'success' | 'error', durationMs: number = 3500): void => {
  // Clear any pending timers from a previous toast
  if (toastTimers.primary !== null) clearTimeout(toastTimers.primary)
  if (toastTimers.fallback !== null) clearTimeout(toastTimers.fallback)
  const existing = document.querySelector('.toast')
  if (existing) existing.remove()

  const toast = createElement('div', { class: `toast toast--${type}`, role: 'status', 'data-testid': 'toast' }, [message])
  document.body.append(toast)

  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add('toast--visible'))

  toastTimers.primary = setTimeout(() => {
    toast.classList.remove('toast--visible')
    toast.addEventListener('transitionend', () => toast.remove(), { once: true })
    // Fallback: remove after transition duration if transitionend didn't fire.
    toastTimers.fallback = setTimeout(() => { toast.remove() }, 350)
  }, durationMs)
}
