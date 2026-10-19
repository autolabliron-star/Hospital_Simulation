/**
 * The cover for your lift ride (R2): a full-screen fade that comes in over 400 ms while you are put in the other level's lobby behind it, holds about
 * 700 ms with the name of the level and a soft ding, and lifts over 500 ms. The Jump cover's look (jumpMenu.css `.jm-cover`) with its own phases (liftFlow.ts).
 * Mount it once, in App, next to `JumpFade`.
 *
 * It also keeps your clothes right after a Jump: the new hospital's avatar is in your coat, so on level 2 the theatre scrubs go back on (`syncPlayerOutfit`).
 */
import { useEffect } from 'react'
import { useJump } from './jump.store'
import { syncPlayerOutfit, useLiftRide } from './liftRide.store'
import './liftCover.css'

export interface LiftCoverViewProps {
  phase: 'idle' | 'fadingOut' | 'holding' | 'fadingIn'
  caption: string | null
}

/** The markup, with the state as props (so it renders in node). */
export function LiftCoverView({ phase, caption }: LiftCoverViewProps) {
  const covered = phase === 'fadingOut' || phase === 'holding'
  return (
    <div className="lc-cover" data-phase={phase} data-covered={covered} role="status" aria-live="polite" aria-hidden={phase === 'idle'}>
      {caption && (
        <div className="lc-cover__text">
          <p className="lc-cover__caption">{caption}</p>
        </div>
      )}
    </div>
  )
}

export function LiftCover() {
  const phase = useLiftRide((s) => s.phase)
  const trip = useLiftRide((s) => s.trip)

  // a Jump swaps the hospital (its generation changes) and makes a new you in your coat: back into the clothes of your level
  useEffect(
    () =>
      useJump.subscribe((s, prev) => {
        if (s.generation !== prev.generation) syncPlayerOutfit()
      }),
    [],
  )

  return <LiftCoverView phase={phase} caption={trip?.caption ?? null} />
}
