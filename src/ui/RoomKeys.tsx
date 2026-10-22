/**
 * Room keys (R1): `G` opens or closes the "Go to…" menu; `Esc` closes the menu if it is open, otherwise closes the room
 * panel and flies back to the overview. Never while the presenter is typing in a field.
 */
import { useEffect } from 'react'
import { useFocus } from '@/scene/camera/focus.store'
import { unfocus } from '@/scene/camera/roomFocus'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { useGoTo } from './goTo.store'
import { hotkeyAllowed } from './hotkeys'
import { hotkeyContext } from './hotkeyContext'

export function RoomKeys(): null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const goTo = useGoTo.getState()
      if (e.code === DEFAULT_KEYMAP.overview) {
        if (goTo.open) {
          e.preventDefault()
          goTo.setOpen(false)
        } else if (useFocus.getState().area) {
          e.preventDefault()
          unfocus()
        }
        return
      }
      // G is heard once the day has started, not while typing, not in presentation mode (the Go-to menu is not drawn there, so it must not
      // open behind the scenes) and not under the Jump menu; with the Go-to menu itself open it closes it
      if (e.code === DEFAULT_KEYMAP.goTo && hotkeyAllowed(e.code, hotkeyContext(e.target, goTo.open ? 'goTo' : undefined)) ) {
        e.preventDefault()
        goTo.setOpen(!goTo.open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}
