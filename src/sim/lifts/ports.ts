/**
 * R2: the frozen interface of the lifts (src/sim/lifts), now real between level 1 and level 2. Contract glue, owned by the orchestrator.
 * See docs/R2-SURGERY.md. Level 3+ is still "upstairs": the ER admissions and ward fades keep their story, but take a lobby slot here.
 *
 * People change level only by riding: the two levels are separate strips of the flat sim (levels.ts), so a walked route between them
 * never exists. A ride (the agent's `LiftTrip`, used by the actors that need one) walks the party to its lobby's spots (places.ts
 * LIFTS), waits for a car and for room in the arrival lobby, fades them out at the car, moves them, and fades them in at the same spot
 * of the other level's lobby.
 */
import type { LevelId } from '../levels'
import type { ShaftId } from '../places'
import type { LiftsState } from '../types'

export interface LiftsPort {
  /** The cars (doors, travel), read by the scene every frame; mutated in place, `version` bumped on change. */
  readonly state: LiftsState
  /**
   * Hold a lobby's stretcher slot for a fade that leaves the building model ("admitted to a ward upstairs", a MealBot's service run):
   * true when granted (the owner may go to the lobby's stretcher spot); release it once the party has faded out.
   */
  claimFade(shaft: ShaftId, level: LevelId, ownerId: string): boolean
  releaseFade(ownerId: string): void
  /** You rode (the walk-mode lift prompt): a car opens on both levels, for show. */
  playerRide(shaft: ShaftId, from: LevelId, to: LevelId): void
}
