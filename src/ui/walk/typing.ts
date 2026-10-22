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

/**
 * F-35: after a mouse click on a button (the Realism pill, Sound, a speed button) the button keeps the focus, so the next Space would press it
 * again instead of pausing. A click made with the mouse (`detail > 0`; a key press that activates a button has `detail` 0) on a button outside
 * a dialog puts the focus back on the page. Pure, so node can test it.
 */
export function shouldBlurAfterClick(detail: number, tagName: string, inDialog: boolean): boolean {
  return detail > 0 && tagName === 'BUTTON' && !inDialog
}

/** Install that on `target` (the window); returns the function that stops. */
export function installBlurAfterClick(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onClick = (e: Event): void => {
    const el = isElement(e.target) ? e.target.closest('button') : null
    if (!el) return
    if (shouldBlurAfterClick((e as MouseEvent).detail, el.tagName, el.closest('[role="dialog"]') !== null) && document.activeElement === el) el.blur()
  }
  target.addEventListener('click', onClick)
  return () => target.removeEventListener('click', onClick)
}
