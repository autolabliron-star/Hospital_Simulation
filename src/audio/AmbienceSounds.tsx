import { useEffect } from 'react'
import { usePower } from '@/app/power'
import { sim } from '@/sim'
import { DEPARTURES, DOORS, areaAt } from '@/sim/places'
import { useAudio } from './audio.store'
import { AmbienceEngine } from './ambience'

/** The auto doors' centres, once. Doors do not move, so there is nothing to re-read. */
const AUTO_DOORS = DOORS.filter((d) => d.kind === 'auto').map((d) => d.center)

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
      lifts: DEPARTURES.lifts,
    })
    engine.start()
    return () => engine.stop()
  }, [])
  return null
}
