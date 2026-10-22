/** A small pill in walk mode: "Realism  R" with its state. The R key does the same (Hud.tsx). */
import { useWalk } from '@/scene/player/state'
import { isWalking, useRealism } from './realism.store'

export function RealismToggleView({ on, onToggle }: { on: boolean; onToggle(): void }) {
  return (
    <button type="button" className="hud-card walk-realism" aria-pressed={on} onClick={(e) => {
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
  return <RealismToggleView on={on} onToggle={() => useRealism.getState().toggle(useWalk.getState().mode)} />
}
