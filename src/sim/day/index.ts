/**
 * The clock of the day: shifts, handovers, dose waves, the night footing (L1 day-rhythm builder).
 * Wired into Simulation by the orchestrator: constructed once per hospital, `warmStart` right after construction
 * (only for a start later than 07:30), then `step` every fixed step after the director.
 *
 *   roster.ts       who is at work at which hour, quiet hours, night, and the API the ward staff use (huddle, bedside
 *                   handover spots, night checks). Read its header first.
 *   shifts.ts       the shift manager: the ER, triage, reception, porters, cleaners, imaging staff and the coordinators
 *                   arrive (entrance, lockers), hand over beside their post and leave (lockers, entrance)
 *   doseWaves.ts    the scheduled dose waves
 *   deepCleaner.ts  the night cleaner's deep clean of the public areas
 *
 * The visitors, the café, the ER arrival curves and the ambient seats follow the same roster hours from
 * src/sim/population (director.ts, ambient.ts, schedule.ts).
 */
import type { World } from '../er/world'
import type { LivingDay } from '../life'
import type { MedSystem } from '../meds/system'
import type { Person } from '../people'
import type { Rng } from '../rng'
import { CONFIG } from '../config'
import { DoseWaves } from './doseWaves'
import { timeOfClockHour } from './roster'
import { ShiftManager } from './shifts'

export interface LifeServiceDeps {
  world: World
  life: LivingDay
  meds: MedSystem
  rng: Rng
  /**
   * The live list of everybody in the simulation (`Simulation.people`). Optional: without it the day rhythm cannot find the
   * coordinators (people.ts builds them) and leaves their shifts alone. Or call `attachPeople` after construction.
   */
  people?: readonly Person[]
}

export * from './roster'
export { DoseWaves } from './doseWaves'
export { ShiftManager } from './shifts'

export class DayRhythm {
  readonly shifts: ShiftManager
  readonly doseWaves: DoseWaves
  private readonly t0: number
  private started = false

  constructor(readonly deps: LifeServiceDeps) {
    this.t0 = timeOfClockHour(deps.life.startHour)
    this.shifts = new ShiftManager({ world: deps.world, rng: deps.rng.fork('shifts'), people: deps.people })
    this.doseWaves = new DoseWaves({ world: deps.world, life: deps.life, meds: deps.meds }, this.t0)
  }

  /** Give the day rhythm the live list of people (see `LifeServiceDeps.people`); call before the first step. */
  attachPeople(people: readonly Person[]): void {
    this.shifts.attachPeople(people)
  }

  /** Place this service's part of the hospital in a plausible state for a start at clock hour `hour`. */
  warmStart(hour: number): void {
    if (this.started) return
    this.started = true
    this.shifts.init(timeOfClockHour(hour), hour === CONFIG.sim.startHour)
  }

  step(t: number, dt: number): void {
    if (!this.started) {
      // the default start: no warm start was asked for, so the staff stand as built and only later changes play out
      this.started = true
      this.shifts.init(this.t0, true)
    }
    this.shifts.step(t, dt)
    this.doseWaves.step(t)
  }
}
