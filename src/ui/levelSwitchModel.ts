/**
 * The overview's Level switch as data (R2, pure): the two options with their words (src/content/surgeryUi.json `level`), which level a press
 * of the L key goes to, and when the key counts at all. The switch only exists in the overview (walking, you are on your level), so every
 * rule here says "overview" and nothing else.
 */
import { SURGERY_UI } from '@/content/surgeryUi'
import type { LevelId } from '@/sim/levels'
import type { PlayerMode } from '@/sim/types'

export interface LevelOption {
  level: LevelId
  /** "Level 1" and "Level 2 · Surgery". */
  label: string
  /** The line under the switch while this level is shown ("Entrance, ER and wards"). */
  caption: string
}

/** The two options, in order. */
export function levelOptions(): readonly LevelOption[] {
  const c = SURGERY_UI.level
  return [
    { level: 1, label: c.one, caption: c.oneCaption },
    { level: 2, label: c.two, caption: c.twoCaption },
  ]
}

/** The level the L key goes to from `level`: the other one. */
export function otherLevel(level: LevelId): LevelId {
  return level === 1 ? 2 : 1
}

/** The line under the switch for the level on screen. */
export function captionOf(level: LevelId): string {
  const c = SURGERY_UI.level
  return level === 2 ? c.twoCaption : c.oneCaption
}

/** Is the Level switch on the glass in this mode? Only in the overview itself: not while walking, and not during the flights between the two. */
export function switchShown(mode: PlayerMode): boolean {
  return mode === 'overview'
}

/** What the key handler needs to know about the keypress and the screen. */
export interface LevelKeyFacts {
  code: string
  repeat: boolean
  /** Ctrl, Meta or Alt is held. */
  modifier: boolean
  /** The focus is in a field. */
  typing: boolean
  mode: PlayerMode
  /** The Go to… or Jump to… menu is open (it owns the keyboard). */
  menuOpen: boolean
}

/** Does this keypress toggle the level? The L key, in the overview, with no field focused and no menu open. */
export function levelKeyApplies(k: LevelKeyFacts, keyCode: string): boolean {
  if (k.code !== keyCode || k.repeat || k.modifier || k.typing || k.menuOpen) return false
  return switchShown(k.mode)
}
