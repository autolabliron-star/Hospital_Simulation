/**
 * The one key listener of the interaction layer (W1). It owns E, stands you up from a seat on a move key, and closes the walk-mode
 * panels on Esc, and it never acts while you type or while a menu or panel owns the keyboard ("one consumer per key").
 *
 *   E        in walk mode with nothing open: run the target (or stand up if you are seated). Consumed.
 *   W A S D  while seated: stand up, and the key goes on to the player so you walk off.
 *   Esc      in walk mode with the room panel, the tablet or the drawer card open: close it, consumed, so the overview's Esc
 *            handler (which flies the camera up) never sees it. In the overview, or with a menu open, Esc is not ours.
 *
 * `decideKey` is pure and tested; `installKeys` wires it to the window (capture phase: ahead of the other hotkeys).
 */
import { DEFAULT_KEYMAP } from '@/sim/types'
import { presentActive } from '@/ui/present/presentation.store'

export type KeyAction = 'interact' | 'standUp' | 'closeOverlay' | 'none'

export interface KeyFacts {
  code: string
  repeat: boolean
  /** Ctrl, Meta or Alt is held. */
  modifier: boolean
  /** The focus is in a field or a list. */
  typing: boolean
  /** You are in walk mode (not the overview, not mid-flight). */
  walking: boolean
  seated: boolean
  /** A panel, tablet or menu owns the keyboard and mouse. */
  overlayOpen: boolean
  /** One of the walk-mode panels is open and Esc would close it (and no menu is). */
  closable: boolean
}

const MOVE_KEYS: ReadonlySet<string> = new Set([
  DEFAULT_KEYMAP.forward,
  DEFAULT_KEYMAP.back,
  DEFAULT_KEYMAP.left,
  DEFAULT_KEYMAP.right,
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

export function decideKey(k: KeyFacts): KeyAction {
  if (k.modifier || k.typing || k.repeat) return 'none'
  if (k.code === DEFAULT_KEYMAP.overview) return k.walking && k.closable ? 'closeOverlay' : 'none'
  if (!k.walking) return 'none'
  if (k.code === DEFAULT_KEYMAP.interact) return k.overlayOpen ? 'none' : k.seated ? 'standUp' : 'interact'
  if (k.seated && !k.overlayOpen && MOVE_KEYS.has(k.code)) return 'standUp'
  return 'none'
}

/** What the listener needs to know and do; the real ones come from the stores in index.tsx. */
export interface KeyEnv {
  walking(): boolean
  seated(): boolean
  overlayOpen(): boolean
  closable(): boolean
  typing(target: EventTarget | null): boolean
  interact(): boolean
  standUp(): void
  closeOverlays(): void
}

export function installKeys(env: KeyEnv): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const action = decideKey({
      code: e.code,
      repeat: e.repeat,
      modifier: e.ctrlKey || e.metaKey || e.altKey,
      typing: env.typing(e.target),
      walking: env.walking(),
      seated: env.seated(),
      overlayOpen: env.overlayOpen(),
      closable: env.closable(),
    })
    switch (action) {
      case 'interact':
        // presentation mode (C) shows no panels or prompts, so nothing may open one (an unseen panel would hold your input): E is not heard
        if (presentActive()) break
        if (env.interact()) {
          e.preventDefault()
          e.stopPropagation()
        }
        break
      case 'standUp':
        // the move key is not consumed: the player system sees it and walks you off
        env.standUp()
        if (e.code === DEFAULT_KEYMAP.interact) {
          e.preventDefault()
          e.stopPropagation()
        }
        break
      case 'closeOverlay':
        env.closeOverlays()
        e.preventDefault()
        e.stopPropagation()
        break
      default:
        break
    }
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
