/**
 * R4: what the scene and the UI may use of the cryoablation suite (contract, owned by the orchestrator; docs/R4-CRYO-SUITE.md).
 */
import type { CryoCaseView, CryoSuiteState } from '../types'

export type CryoDemoResult = 'started' | 'queued' | 'noTeam' | 'busy'

export interface CryoSuitePort {
  /** Read by the scene every frame; mutated in place, `version` bumped on change. */
  readonly state: CryoSuiteState
  readonly cases: readonly CryoCaseView[]
  /**
   * "Start a cryoablation now": 'started' (wheeled out of lift B within CONFIG.cryoSuite.demoArrivalSeconds), 'queued' (room busy: next),
   * 'noTeam' (outside team hours: nothing booked), 'busy' (a demo already queued or running). Never throws.
   */
  startDemo(): CryoDemoResult
}
