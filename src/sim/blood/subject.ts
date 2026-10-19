/**
 * Who the draw centre draws: the callbacks a patient implements. A booked outpatient (visitor.ts), the demo outpatient and an ER patient
 * (er/patient.ts) all play this part, so the robot station and the ticket book do not care which one they hold.
 */
import type { LabOrder, SeatSpec } from '../types'
import type { Actor } from '../er/actor'

export interface DrawSubject {
  readonly id: string
  readonly name: string
  /** The person: the station reads their seat and writes their arm pose through the methods below, never the entity directly. */
  readonly actor: Actor
  /**
   * Your ticket is called to robot `station`: get to its chair `seat`. An outpatient gets up and walks and sits; an ER patient is wheeled
   * there (the porter, who is waiting with them, takes them on from the holding spot).
   */
  drawCalled(station: number, seat: SeatSpec): void
  /** Sitting still on `seat`, so the robot may begin. */
  seatedOn(seat: SeatSpec): boolean
  /** Nobody needs `seat` any more: they stood up, or the porter lifted them onto the wheelchair. */
  offChair(seat: SeatSpec): boolean
  /** The arm goes into the robot's cradle (on) or comes out (off). */
  armIn(on: boolean): void
  /** The bandage is going on: an ER patient asks the porter now so the ride is there when the arm is free. */
  drawNearlyDone(): void
  /** The arm is free and the draw is over (by robot or by the nurse): an outpatient walks out; an ER patient's pathway hears DRAW_DONE. */
  drawReleased(): void
  /** The call was dropped because the holder never arrived (a safety net, not a normal path): carry on without the draw. */
  drawAborted(): void
  /** The lab verified every test of this subject's order (ER patients: REPORT_READY). Outpatients ignore it. */
  resultsReady(order: LabOrder): void
}
