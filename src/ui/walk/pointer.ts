/** Give the mouse back: the browser keeps it captured for the walk camera until you ask (Esc does the same by itself). Safe anywhere. */
export function releasePointer(): void {
  if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock()
}
