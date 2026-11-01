/**
 * R2: the frozen interface of the robotic surgery suite (src/sim/surgery), for the scene, the panels and your teaching-console session.
 * Contract glue, owned by the orchestrator. See docs/R2-SURGERY.md.
 *
 * One da Vinci 5 OR on level 2 runs a seeded list each day (CONFIG.surgery): every patient arrives at the entrance with a companion,
 * rides lift A up, waits in a pre-op bay, is wheeled into the OR, goes through the theatre phases with the robot docked for the console
 * phase, recovers in PACU, and goes home (a day case, by way of a lounge recliner) or up to the surgical ward (the lift fade). Everything
 * is synthetic, display-only and replayed exactly by the seed: no clinical decisions.
 */
import type { SurgeryCaseView, SurgeryProcedure, SurgeryState, WatchResult } from '../types'

export interface SurgeryPort {
  /** The theatre, the robot and the bays, read by the scene every frame; mutated in place, `version` bumped on change. */
  readonly state: SurgeryState
  /** Today's list (the same objects as `state.theatre.cases`). */
  readonly cases: readonly SurgeryCaseView[]
  /** You sat at (true) or left (false) the teaching console, or the OR panel's "Watch the endoscope view" opened or closed. */
  setTeaching(on: boolean): void
  /**
   * R5 "Watch step by step" (docs/R5-PROCEDURES.md). With the room free, a compressed case of `procedure` is wheeled in now ('started');
   * during a turnover it is booked for when the room is ready ('queued'). With a case already in the room the answer is 'following' (watch
   * that one from its current step), unless `fromStart`, which books the watch case right after it ('queued'): the panel can then skip
   * you to `watchStartsAt`. 'busy': a watch case is already booked; 'noTeam': outside the team's hours.
   */
  startWatch(procedure: SurgeryProcedure, opts?: { fromStart?: boolean }): WatchResult
  /** R5: when the booked watch case is wheeled in (sim seconds); null when none is booked or it has started. */
  readonly watchStartsAt: number | null
}
