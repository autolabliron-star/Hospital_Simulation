import { useEffect } from 'react'
import { usePower } from '@/app/power'
import { sim } from '@/sim'
import { DEPARTURES, DOORS, LIFTS, areaAt } from '@/sim/places'
import { useAudio } from './audio.store'
import { AmbienceEngine } from './ambience'

/** The auto doors' centres, once. Doors do not move, so there is nothing to re-read (the level-2 doors are in `DOORS`: sim coordinates, like you). */
const AUTO_DOORS = DOORS.filter((d) => d.kind === 'auto').map((d) => d.center)

/** The lift standing spots of both levels (R2): level 1's, then level 2's lobbies (the same spot of each shaft, in the level-2 strip of the sim). */
const LIFT_SPOTS = [...DEPARTURES.lifts, LIFTS.A[2].stretcher.at, LIFTS.B[2].stretcher.at]

/**
 * Starts the walking ambience (footsteps, room tone, door whooshes, the pod chime, the lift ding) while mounted. Renders
 * nothing. Mount it once, in App, beside ScannerSounds. The engine reads `sim` on every tick, so a Jump is picked up.
 */
export function Ambience(): null {
  useEffect(() => {
    const engine = new AmbienceEngine({
      player: () => sim.player,
      pods: () => sim.meds.fleet.drivers,
      area: (x, z) => areaAt(x, z),
      muted: () => useAudio.getState().muted,
      unlocked: () => useAudio.getState().unlocked,
      // the engine reads `hidden` as "stay silent": a hidden tab, or a paused demo (PowerLoop: hidden tab, or a blurred window outside presentation mode)
      hidden: () => (typeof document !== 'undefined' && document.hidden) || usePower.getState().paused,
      autoDoors: AUTO_DOORS,
      lifts: LIFT_SPOTS,
    })
    engine.start()
    return () => engine.stop()
  }, [])
  return null
}
