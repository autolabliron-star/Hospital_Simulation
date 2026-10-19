/**
 * The L key (KeyMap.level): toggles the overview between Level 1 and Level 2 (R2). One window listener, installed by the HUD root (Hud.tsx), so it
 * works with the HUD hidden (H) too. It does nothing while you walk, while a menu is open or while you type. `env` holds everything it reads and
 * does, so node tests drive it with a fake window and fake stores.
 */
import { chooseLevel } from '@/scene/camera/roomFocus'
import { useOverviewLevel } from '@/scene/levels/levelView'
import { useWalk } from '@/scene/player/state'
import { DEFAULT_KEYMAP, type PlayerMode } from '@/sim/types'
import type { LevelId } from '@/sim/levels'
import { useGoTo } from './goTo.store'
import { useJump } from './jump.store'
import { levelKeyApplies, otherLevel } from './levelSwitchModel'
import { isTyping } from './walk/typing'

export interface LevelKeyEnv {
  mode(): PlayerMode
  menuOpen(): boolean
  typing(target: EventTarget | null): boolean
  /** The level the overview shows now. */
  level(): LevelId
  choose(level: LevelId): void
}

/** The real stores. */
export const levelKeyEnv: LevelKeyEnv = {
  mode: () => useWalk.getState().mode,
  menuOpen: () => useGoTo.getState().open || useJump.getState().open,
  typing: isTyping,
  level: () => useOverviewLevel.getState().level,
  choose: chooseLevel,
}

/** Listen for the key on `target` (the window); returns the function that stops. */
export function installLevelKey(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, env: LevelKeyEnv = levelKeyEnv, keyCode: string = DEFAULT_KEYMAP.level): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const hit = levelKeyApplies(
      { code: e.code, repeat: e.repeat, modifier: e.ctrlKey || e.metaKey || e.altKey, typing: env.typing(e.target), mode: env.mode(), menuOpen: env.menuOpen() },
      keyCode,
    )
    if (!hit) return
    e.preventDefault()
    env.choose(otherLevel(env.level()))
  }
  target.addEventListener('keydown', onKey)
  return () => target.removeEventListener('keydown', onKey)
}
