// DOM creation helper — the single blessed way to create elements.
// Used by all rendering modules. Never use innerHTML.

import { booleanAttrs } from './ui-types.js'

export const createElement = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  attributes: Record<string, string | undefined> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tagName)

  Object.entries(attributes).forEach(([key, value]) => {
    if (value === undefined) return
    if (booleanAttrs.has(key)) {
      ;(element as Record<string, unknown>)[key] = value === 'true'
    } else {
      element.setAttribute(key, value)
    }
  })

  children.forEach((child) => {
    element.append(child instanceof Node ? child : document.createTextNode(child))
  })

  return element
}
