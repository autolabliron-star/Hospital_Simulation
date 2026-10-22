/**
 * Which global hotkeys may act right now (F-04, F-07). One pure table, used by the HUD hotkeys, the room keys and the presenter keys, so the
 * rules cannot drift apart:
 *
 *   Esc            always: its handlers decide what it closes (a select, a menu, the walkthrough)
 *   M              always, in every mode and on the loading screen, except while you type in a field
 *   (nothing else) before the presenter has pressed Enter, or while typing in a field
 *   C, N, Space, 1 2 4 0 3   once entered, in every mode (the presenter's own keys and the clock; a pill shows a pause or a speed while the HUD is hidden)
 *   P, J, H, R, G, ] (the keys that open or change game UI)   once entered, not while presenting (no UI to show it), not under an open menu
 */
import { DEFAULT_KEYMAP } from '@/sim/types'
import { PRESENT_KEY, PRESENT_NEXT_KEY } from './present/presentation.store'
import { REALISM_KEY } from './walk/realism.store'

export interface HotkeyContext {
  /** The presenter pressed Enter on the loading screen: the day has started. */
  entered: boolean
  /** Presentation mode (C) is on. */
  presenting: boolean
  /** The Jump menu or the Go-to menu is open. */
  menuOpen: boolean
  /** The focus is in a field or a list. */
  typing: boolean
}

const km = DEFAULT_KEYMAP

/** The presenter's keys and the clock's keys. */
const ALWAYS_AFTER_ENTER: ReadonlySet<string> = new Set([PRESENT_KEY, PRESENT_NEXT_KEY, km.pause, km.speed1, km.speed2, km.speed4, km.speed10, km.speed30])

/** The keys that open, close or change a piece of game UI. */
const UI_KEYS: ReadonlySet<string> = new Set([km.prescribe, km.jump, km.cleanScreen, km.goTo, km.skip, REALISM_KEY])

export function hotkeyAllowed(code: string, ctx: HotkeyContext): boolean {
  if (code === km.overview) return true
  if (code === km.mute) return !ctx.typing
  if (ctx.typing || !ctx.entered) return false
  if (ALWAYS_AFTER_ENTER.has(code)) return true
  if (UI_KEYS.has(code)) return !ctx.presenting && !ctx.menuOpen
  return true
}
