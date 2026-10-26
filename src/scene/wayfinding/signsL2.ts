/**
 * Hanging wayfinding signs of level 2 (R2), in the same shape as `SIGNS` in places.ts (the contract keeps level 1's; these are agent B's, in the
 * level-2 strip of the flat sim, `l2(drawn x)`). The walk-mode building hangs `[...SIGNS, ...L2_SIGNS]` (layout/walk/signage.ts), the words come
 * from src/content/signs.json like every other sign, and the arrows are worked out from the geometry.
 *
 *   l2-corridor-north  in the theatre corridor just past lift A, facing the people coming from the north (heading pi: its front looks north)
 *   l2-corridor-south  in the same corridor just past lift B, facing the people coming from the south
 *   l2-hall            at the mouth of the theatre hall, facing the people coming in from the corridor (heading +pi/2: its front looks east)
 */
import { l2 } from '@/sim/levels'
import type { SignAnchor } from '@/sim/places'

export const L2_SIGNS: SignAnchor[] = [
  { id: 'l2-corridor-north', at: { x: l2(-42), z: -14.8 }, heading: Math.PI, points: ['l2PreOp', 'l2Or', 'l2Pacu'] },
  { id: 'l2-corridor-south', at: { x: l2(-42), z: 14.8 }, heading: 0, points: ['l2Pacu', 'l2Cryo', 'l2Or'] },
  { id: 'l2-hall', at: { x: l2(-45.3), z: 0 }, heading: Math.PI / 2, points: ['l2Or', 'l2Sterile', 'l2Lounge'] },
]

/** Every hanging sign of the building, both levels. */
export function allSigns(signs: readonly SignAnchor[]): SignAnchor[] {
  return [...signs, ...L2_SIGNS]
}
