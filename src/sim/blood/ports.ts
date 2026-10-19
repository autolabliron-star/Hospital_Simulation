/**
 * W4: the frozen interface of the robot blood-draw centre (src/sim/blood), for the scene and the UI while it is being built. Contract glue,
 * owned by the orchestrator. ER patients are wired inside src/sim/blood's own changes to er/patient.ts.
 */
import type { DrawStationState, DrawTicket, TubePrepState } from '../types'

export interface DrawPort {
  /** The three robot stations, mutated in place. */
  readonly stations: readonly DrawStationState[]
  readonly prep: TubePrepState
  /** Tickets waiting or being called, in call order (V before P, then first come). */
  readonly queue: readonly DrawTicket[]
  /** The ticket on the queue screen now, or null. */
  readonly calling: DrawTicket | null
  /** The supervising nurse's id (null before she is on site). */
  readonly nurseId: string | null
  readonly stats: { draws: number; robotFirstPass: number; nurseDraws: number; medianWaitMin: number | null }
  /** The panel's "Call next patient": start a demo draw on a free robot now (a synthetic outpatient), or false when none is free. */
  startDemoDraw(): boolean
  /** You at the check-in kiosk: a ticket number to show (you are not drawn). */
  takePlayerTicket(): string
  /** Bumped whenever a panel or screen should repaint. */
  readonly version: number
}
