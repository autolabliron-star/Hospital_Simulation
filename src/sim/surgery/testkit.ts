/**
 * Test helpers for the surgery suite (not imported by the sim): a MiniHospital (../lifts/testkit) with the suite in it and the day started, with the
 * building's seats or only the level-1 ones (so the synthetic fallback seats are exercised), and readers over the suite's state.
 */
import { levelOf } from '../levels'
import { SURGERY } from '../places'
import { MiniHospital, type MiniOptions } from '../lifts/testkit'
import { timeAtHour } from '../population/schedule'
import { defaultSeats } from '../seats'
import type { OpeningKind, SeatSpec } from '../types'

export { DT, MiniHospital, testPerson } from '../lifts/testkit'

export type SeatMode = 'layout' | 'bare' | 'withOr'

/**
 * The OR agent's seats as the contract names them (the table, the two console seats and the anaesthetist's stool), written out here so a test can
 * prove the suite uses real registry seats for them too: the day must be the same with these in the registry as with its own synthetic ones.
 */
export function orSeats(): SeatSpec[] {
  const t = SURGERY.table
  const sc = SURGERY.consoles.surgeon.seat
  const tc = SURGERY.consoles.teach.seat
  const st = SURGERY.anaesthesia.stool
  const seat = (id: string, kind: SeatSpec['kind'], at: { x: number; z: number }, heading: number, pose: SeatSpec['pose'], height: number, approach: { x: number; z: number }): SeatSpec => ({
    id,
    kind,
    area: 'l2Or',
    x: at.x,
    z: at.z,
    heading,
    pose,
    height,
    approach,
  })
  return [
    seat('orTable:0', 'orTable', t.at, t.heading, 'lie', t.height, t.approach),
    seat('console:or:surgeon', 'console', sc.at, sc.heading, 'sit', 0.5, { x: sc.at.x - 0.1, z: sc.at.z + 0.95 }),
    seat('console:or:teach', 'console', tc.at, tc.heading, 'sit', 0.5, { x: tc.at.x - 0.1, z: tc.at.z - 0.95 }),
    seat('console:or:anaes', 'console', st.at, st.heading, 'sit', 0.55, { x: st.at.x + 0.8, z: st.at.z + 0.2 }),
  ]
}

/**
 * The seats a mini hospital gets: the building's (all levels, whatever the layout agents have exported so far), `bare` (level 1 only: the suite
 * makes its own from the anchors), or `withOr` (the building's plus the OR's seats above, where the layout does not have them yet).
 */
export function seatsFor(mode: SeatMode): SeatSpec[] {
  const all = defaultSeats()
  if (mode === 'bare') return all.filter((s) => levelOf(s.x) === 1)
  if (mode === 'withOr') {
    const have = new Set(all.map((s) => s.id))
    return [...all, ...orSeats().filter((s) => !have.has(s.id))]
  }
  return all
}

export interface SuiteOptions extends Omit<MiniOptions, 'surgery' | 'seats' | 't0'> {
  seats?: SeatMode
  /** The clock hour to start at (default: 07:30, the sim's own start). */
  hour?: number
  /** S1: how the day opens (default 'quiet'). */
  opening?: OpeningKind
}

/** A mini hospital with the surgery suite and its day started at `hour`. */
export function suite(seed: number, opts: SuiteOptions = {}): MiniHospital {
  const t0 = opts.hour === undefined ? 0 : timeAtHour(opts.hour)
  const h = new MiniHospital(seed, { crowd: opts.crowd, seats: seatsFor(opts.seats ?? 'layout'), surgery: true, t0 })
  h.surgery!.startDay(t0, opts.opening ?? 'quiet')
  return h
}

/** Step until the clock hour `hour` (a Jump-style wait). */
export function runToHour(h: MiniHospital, hour: number, dt: number): void {
  const end = timeAtHour(hour)
  while (h.t < end) h.step(dt)
}
