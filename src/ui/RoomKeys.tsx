/**
 * Room keys (R1): `G` opens or closes the "Go to…" menu; `Esc` closes the menu if it is open, otherwise closes the room
 * panel and flies back to the overview. Never while the presenter is typing in a field.
 */
import { useEffect } from 'react'
import { useFocus } from '@/scene/camera/focus.store'
import { unfocus } from '@/scene/camera/roomFocus'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { useGoTo } from './goTo.store'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

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
      if (isTyping(e.target)) return
      if (e.code === DEFAULT_KEYMAP.goTo) {
        e.preventDefault()
        goTo.setOpen(!goTo.open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}
