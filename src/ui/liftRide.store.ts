/**
 * Your lift ride (R2): the phase of the ride in progress, for the cover (LiftCover.tsx) and for the lift prompts (src/scene/interact/lift.ts: no second ride
 * while one runs). A store so the interactables, the cover and the tests agree. The sequence is liftFlow.ts (pure, tested with fake timers); this file only wires
 * it to the running hospital:
 *
 *   placePlayer    the player system puts you in the other level's lobby (player/api.ts; a move to the other level puts the chase camera at rest there)
 *   playerRide     `sim.lifts.playerRide`: a car shows the ride, for show
 *   your outfit    the player entity (id 'player') wears theatre scrubs on level 2 and your coat ('role') on level 1; the crowd re-dresses it
 *   ding           the soft bell (audio/ambience.ts `cueLiftDing`, which respects the mute)
 *
 * `sim` is a live binding (a Jump swaps it): everything reads it when it is used. A Jump keeps you where you stand but makes a new avatar in your coat, so
 * `syncPlayerOutfit` puts the clothes of your level back on (LiftCover calls it after a Jump).
 */
import { create } from 'zustand'
import { cueLiftDing } from '@/audio/ambience'
import { placePlayer } from '@/scene/player/api'
import { sim } from '@/sim'
import { levelOf } from '@/sim/levels'
import { createLiftRide, outfitOf, arriveInLobby, type ArriveEnv, type LiftRideState } from './liftFlow'

export { LIFT_FADE_IN_MS, LIFT_FADE_OUT_MS, LIFT_HOLD_MS, type LiftPhase, type LiftRideState, type LiftTrip } from './liftFlow'

/** `fn` after `n` painted frames. A timer backs it up, because a hidden tab never paints. */
function afterFrames(n: number, fn: () => void): void {
  let done = false
  const run = (): void => {
    if (done) return
    done = true
    fn()
  }
  let left = n
  const tick = (): void => {
    if (--left <= 0) run()
    else requestAnimationFrame(tick)
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick)
  setTimeout(run, 120 * n + 200)
}

/** The real effects of the move. */
export const liftEnv: ArriveEnv = {
  placePlayer: (x, z, heading) => placePlayer(x, z, heading),
  rideCars: (shaft, from, to) => sim.lifts.playerRide(shaft, from, to),
  setOutfit: (outfit) => {
    const av = sim.playerAvatar
    if (av) av.outfit = outfit
  },
}

/** Put on the clothes of the level you stand on (a Jump makes a new avatar in your coat). No-op when you are not in the hospital or already wear them. */
export function syncPlayerOutfit(): void {
  const me = sim.player
  const av = sim.playerAvatar
  if (!me || !av) return
  const want = outfitOf(levelOf(me.x))
  if (av.outfit !== want) av.outfit = want
}

export const useLiftRide = create<LiftRideState>(
  createLiftRide({
    arrive: (trip) => arriveInLobby(trip, liftEnv),
    ding: cueLiftDing,
    after: (ms, fn) => {
      setTimeout(fn, ms)
    },
    frames: afterFrames,
    onError: (error) => console.error('The lift ride failed; you stay where you were.', error),
  }),
)
