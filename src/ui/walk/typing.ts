/** Is the player typing (or choosing from a list) in a field? Global keys must stay out of the way. Shared by the HUD hotkeys and E. */

export const NON_TYPING_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'color', 'range'])

const isElement = (target: EventTarget | null): target is HTMLElement => typeof HTMLElement !== 'undefined' && target instanceof HTMLElement

/** True while the user is typing (or choosing from a list). */
export function isTyping(target: EventTarget | null): boolean {
  if (!isElement(target)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  return tag === 'INPUT' && !NON_TYPING_INPUTS.has((target as HTMLInputElement).type)
}

/** Buttons and checkboxes already react to Space themselves. */
export function activatesOnSpace(target: EventTarget | null): boolean {
  return isElement(target) && (target.tagName === 'BUTTON' || (target.tagName === 'INPUT' && NON_TYPING_INPUTS.has((target as HTMLInputElement).type)))
}
