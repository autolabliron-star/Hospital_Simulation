/**
 * R4: what the scene and the UI may use of the cryoablation suite (contract, owned by the orchestrator; docs/R4-CRYO-SUITE.md).
 */
import type { CryoCaseView, CryoSuiteState, CryoTarget, WatchResult } from '../types'

export type CryoDemoResult = 'started' | 'queued' | 'noTeam' | 'busy'

/**
 * Why a start was answered 'noTeam' (R5 wave 3; the answer itself is unchanged): 'hours', the team is not on site (before it comes in or after it has
 * gone home); 'late', the team is in but a whole case could not be finished before it goes home: a watch case is in the room for about 11 minutes and is
 * to be out five minutes before the team goes home at 17:30, so a start after about 17:13 is too late (the same for a booked case it would hold up).
 */
export type CryoNoTeamWhy = 'hours' | 'late'

export interface CryoSuitePort {
  /** Read by the scene every frame; mutated in place, `version` bumped on change. */
  readonly state: CryoSuiteState
  readonly cases: readonly CryoCaseView[]
  /**
   * "Start a cryoablation now": 'started' (wheeled out of lift B within CONFIG.cryoSuite.demoArrivalSeconds), 'queued' (room busy: next),
   * 'noTeam' (outside team hours: nothing booked), 'busy' (a demo already queued or running). Never throws.
   */
  startDemo(): CryoDemoResult
  /**
   * R5 wave 3, "Watch step by step": a compressed case of `target` (the script's watch seconds, 10-15 minutes in the room), booked in front of
   * the list. The room free: 'started' (wheeled out of lift B now). A turnover running: 'queued' (it starts at the turnover's end). A case in
   * the room: 'following' (watch that one from its current step), unless `fromStart`, which books the watch case right after it ('queued'): the
   * panel can then skip you to `watchStartsAt`. 'busy': a watch case is already booked or running; 'noTeam': outside the team's hours, or the
   * case (or a day case it pushes back) would not be out of the room before the team goes home.
   */
  startWatch(target: CryoTarget, opts?: { fromStart?: boolean }): WatchResult
  /** When the booked watch case is wheeled in (sim seconds); null when none is booked or it has started. */
  readonly watchStartsAt: number | null
  /** Why the last start was answered 'noTeam' (the panel says whether the team is out or it is too late for a whole case today); null before one was. */
  readonly whyNoTeam: CryoNoTeamWhy | null
}
