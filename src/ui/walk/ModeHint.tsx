/** A small hint of the keys, "Tab · Overview   V · First person   E · Use", that shows for a few seconds each time you start walking, then fades. */
import { useEffect, useState } from 'react'
import { keyLabel, WALK } from '@/content/walk'
import { useWalk } from '@/scene/player/state'
import { DEFAULT_KEYMAP } from '@/sim/types'

/** How long the hint stays before it fades (real milliseconds). */
export const HINT_MS = 7000

export function ModeHint() {
  const mode = useWalk((s) => s.mode)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    if (mode !== 'walk') {
      setVisible(false)
      return
    }
    setVisible(true)
    const id = window.setTimeout(() => setVisible(false), HINT_MS)
    return () => window.clearTimeout(id)
  }, [mode])

  return (
    <p className="walk-hint" data-visible={visible} aria-hidden={!visible}>
      {WALK.hint.map((h) => (
        <span key={h.action} className="walk-hint__item">
          <kbd className="hud-kbd">{keyLabel(DEFAULT_KEYMAP[h.action])}</kbd> {h.label}
        </span>
      ))}
    </p>
  )
}
