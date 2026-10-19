/**
 * E in a lift lobby (R2): the four lobbies (shaft A or B on level 1 or level 2) offer the ride. From level 1 the prompt reads "Take the lift to Level 2 · Surgery",
 * from level 2 "Take the lift to Level 1" (src/content/surgeryUi.json `lift`). E starts your ride (src/ui/liftFlow.ts: a cover, you are put in the other level's lobby, a
 * car shows it, the clothes of that level), and while a ride runs the prompt is locked, so a second E starts nothing.
 *
 *   lift:A, lift:B       the level-1 lobbies (the old ids, kept)
 *   lift:A:2, lift:B:2   the level-2 lobbies
 *
 * Each prompt stands at its lobby's `stretcher` spot (LIFTS in src/sim/places.ts), in SIM coordinates like every other interactable, so level 2's are in its strip
 * (x 98..) and only reach you there. They are `door`s: priority 1, outranking people and seats, with the radius of the old lift prompt. The ride itself is passed in (`LiftHost`),
 * so the registrations are tested with fakes; `realLiftHost` is the cover and the sim.
 */
import { SURGERY_UI } from '@/content/surgeryUi'
import type { Interactable } from '@/scene/interact.store'
import type { LevelId } from '@/sim/levels'
import { LIFTS, type ShaftId } from '@/sim/places'
import { useLiftRide } from '@/ui/liftRide.store'

/** How near the lobby's standing spot the prompt shows (the same as the old lift prompt). */
export const LIFT_RADIUS = 2.2

/** What the lift prompts need from the outside. */
export interface LiftHost {
  /** Start your ride from `from` in `shaft`'s lobby. */
  ride(shaft: ShaftId, from: LevelId): void
  /** A ride is running: the prompts are locked. */
  busy(): boolean
}

/** The cover and the sim. */
export const realLiftHost: LiftHost = {
  ride: (shaft, from) => {
    useLiftRide.getState().ride(shaft, from)
  },
  busy: () => useLiftRide.getState().phase !== 'idle',
}

/** The id of a lobby's prompt: level 1 keeps `lift:A` and `lift:B`. */
export function liftId(shaft: ShaftId, level: LevelId): string {
  return level === 1 ? `lift:${shaft}` : `lift:${shaft}:${level}`
}

/** The prompt of a lobby: where it leads. */
export function liftLabel(level: LevelId): string {
  return level === 1 ? SURGERY_UI.lift.toTwo : SURGERY_UI.lift.toOne
}

export function buildLiftInteractables(host: LiftHost = realLiftHost): Interactable[] {
  const out: Interactable[] = []
  for (const level of [1, 2] as const) {
    for (const shaft of ['A', 'B'] as const) {
      const at = LIFTS[shaft][level].stretcher.at
      out.push({
        id: liftId(shaft, level),
        kind: 'door',
        position: { x: at.x, y: 0, z: at.z },
        radius: LIFT_RADIUS,
        label: () => liftLabel(level),
        enabled: () => !host.busy(),
        onInteract: () => host.ride(shaft, level),
      })
    }
  }
  return out
}
