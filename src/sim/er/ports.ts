/**
 * The two services the ER code uses that other builders own, as the small interfaces it relies on. The real classes
 * (`SeatRegistry` in ../seats, `Queue` in ../nav/queue) satisfy them; tests can pass anything shaped the same.
 */
import type { Vec2 } from '../types'

export interface QueueSpot {
  at: Vec2
  heading: number
}

export interface QueueLike {
  /** Join at the back; the index in line, or -1 if the line is full. */
  join(member: string): number
  /** Leave; everyone behind advances. */
  leave(member: string): void
  indexOf(member: string): number
  head(): string | null
  readonly members: readonly string[]
  spotFor(index: number): QueueSpot
}
