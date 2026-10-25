/**
 * A small pill in walk mode: "Realism  R" with its state. The R key does the same (Hud.tsx).
 *
 * Step 3 (the picture dominates): it shows for a few seconds when you start walking and each time realism changes (R or a click), with the key
 * hint, then fades away; it stays where it is, so a free pointer brings it back by hovering the corner (and Tab focus does too).
 */
import { useEffect, useState } from 'react'
import { useWalk } from '@/scene/player/state'
import { HINT_MS } from './ModeHint'
import { isWalking, useRealism } from './realism.store'

export function RealismToggleView({ on, onToggle, visible = true }: { on: boolean; onToggle(): void; visible?: boolean }) {
  return (
    <button type="button" className="hud-card walk-realism" aria-pressed={on} data-visible={visible} onClick={(e) => {
        onToggle()
        // F-35: a mouse click must not leave the pill focused (the next Space would flip realism again instead of pausing)
        if (e.detail > 0) e.currentTarget.blur()
      }}
      title="Realism mode: hides emote icons and speech bubbles, tones down the glow panels">
      <span className="walk-realism__label">Realism</span>
      <kbd className="hud-kbd">R</kbd>
      <span className="walk-realism__state">{on ? 'On' : 'Off'}</span>
    </button>
  )
}

export function RealismToggle() {
  const mode = useWalk((s) => s.mode)
  const on = useRealism((s) => (isWalking(mode) ? s.walk : s.overview))
  const [visible, setVisible] = useState(true)
  // shown on entering walk mode and on every change, for as long as the key hint; then tucked away (R still works)
  useEffect(() => {
    if (mode !== 'walk') {
      setVisible(false)
      return
    }
    setVisible(true)
    const id = window.setTimeout(() => setVisible(false), HINT_MS)
    return () => window.clearTimeout(id)
  }, [mode, on])
  return <RealismToggleView on={on} visible={visible} onToggle={() => useRealism.getState().toggle(useWalk.getState().mode)} />
}
