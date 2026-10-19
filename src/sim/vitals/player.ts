/**
 * W4 health kiosks: YOUR session. The scene's interaction (E at a kiosk) moves you onto the platform and the stool; the station only runs the state
 * and the reading, with the same phases and poses as anybody else's, squeezed into CONFIG.vitals.playerSessionSeconds. You are not a `KioskSubject`
 * who gets walked about: this stand-in takes every callback and does nothing.
 *
 * The session ends when you finish it, when you call `cancelPlayer`, or when you walk away: further than `playerLeaveMetres` from the stand spot
 * (after a short grace so the interaction can carry you there).
 */
import type { Spot } from '../places'
import type { Entity } from '../types'
import type { KioskSubject } from './ports'
import { TUNING } from './tuning'

export class PlayerSubject implements KioskSubject {
  readonly id = 'player'
  readonly name = 'You'
  kioskCalled(): void {}
  kioskSit(): void {}
  kioskDone(): void {}
}

/** Have you walked away from the kiosk? `elapsed` is the seconds since the session began. */
export function playerTooFar(e: Entity, stand: Spot, elapsed: number): boolean {
  if (elapsed < TUNING.playerGraceSeconds) return false
  return Math.hypot(e.position.x - stand.at.x, e.position.z - stand.at.z) > TUNING.playerLeaveMetres
}
