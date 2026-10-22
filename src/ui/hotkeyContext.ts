/** The live facts `hotkeyAllowed` (hotkeys.ts) needs, read from the stores when a key is pressed (never per frame). */
import { useWarmup } from '@/scene/warmup/warmup.store'
import { useGoTo } from './goTo.store'
import { useJump } from './jump.store'
import { usePresentation } from './present/presentation.store'
import type { HotkeyContext } from './hotkeys'
import { isTyping } from './walk/typing'

/** `menuOpen` is the Jump menu or the Go-to menu; `ownMenu: 'goTo'` leaves the Go-to menu out (the G key that closes it). */
export function hotkeyContext(target: EventTarget | null, ownMenu?: 'goTo'): HotkeyContext {
  return {
    entered: useWarmup.getState().entered,
    presenting: usePresentation.getState().on,
    menuOpen: useJump.getState().open || (ownMenu !== 'goTo' && useGoTo.getState().open),
    typing: isTyping(target),
  }
}
