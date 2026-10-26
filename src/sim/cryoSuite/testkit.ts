/**
 * Test helpers for the cryoablation suite (not imported by the sim): a MiniHospital (../lifts/testkit: the world, the lifts, the seats, the
 * crowd and the surgery suite, whose recovery bays the cryo patients share) with the cryo suite stepped after it, and a day runner that watches
 * the suite's invariants once a sampled second.
 */
import { clockText } from '../events'
import { levelOf } from '../levels'
import { MiniHospital, type MiniOptions } from '../lifts/testkit'
import { isWalkable } from '../nav/layout'
import { DOORS } from '../places'
import { timeAtHour } from '../population/schedule'
import { defaultSeats } from '../seats'
import type { Actor } from '../er/actor'
import type { CryoStep, OpeningKind, SeatSpec } from '../types'
import { CryoSuite } from './index'
import { CRYO_STEPS } from '../types'

export { DT } from '../lifts/testkit'

export type SeatMode = 'layout' | 'bare'

/** The building's seats, or `bare`: without the suite's own (so the synthetic fallbacks are exercised). */
export function cryoSeats(mode: SeatMode): SeatSpec[] {
  const all = defaultSeats()
  if (mode === 'bare') return all.filter((s) => !/cryo/.test(s.id))
  return all
}

export class CryoHospital extends MiniHospital {
  readonly cryo: CryoSuite

  constructor(seed: number, opts: Omit<MiniOptions, 'surgery'> = {}) {
    super(seed, { ...opts, surgery: true })
    this.cryo = new CryoSuite(this.world, this.rng.fork('cryoSuite'), this.walkerFor)
    this.world.cryoSuite = this.cryo
  }

  /** One fixed step: the hospital (surgery included), then the suite. */
  override step(dt?: number): void {
    super.step(dt)
    this.cryo.step(this.t, dt ?? 1 / 60)
  }
}

export interface CryoDayOptions {
  crowd?: boolean
  seats?: SeatMode
  /** The clock hour to start at (default 07:30). */
  hour?: number
  /** Also run the surgery suite's day (default false: only its recovery bays are used). */
  surgeryDay?: boolean
  /** S1: how the day opens (default 'quiet'). */
  opening?: OpeningKind
}

/** A mini hospital with the cryo suite's day started at `hour`. */
export function cryoSuite(seed: number, opts: CryoDayOptions = {}): CryoHospital {
  const t0 = opts.hour === undefined ? 0 : timeAtHour(opts.hour)
  const h = new CryoHospital(seed, { crowd: opts.crowd, seats: cryoSeats(opts.seats ?? 'layout'), t0 })
  if (opts.surgeryDay === true) h.surgery!.startDay(t0, opts.opening ?? 'quiet')
  h.cryo.startDay(t0, opts.opening ?? 'quiet')
  return h
}

const STEP_INDEX = new Map<CryoStep, number>(CRYO_STEPS.map((s, i) => [s, i]))

interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** Every level-2 doorway as a small rectangle in the wall opening. */
const DOORWAYS: { id: string; r: Rect }[] = DOORS.filter((d) => d.id.startsWith('l2')).map((d) => {
  const half = d.width / 2
  const r =
    d.wallAxis === 'x'
      ? { x0: d.center.x - half, x1: d.center.x + half, z0: d.center.z - 0.35, z1: d.center.z + 0.35 }
      : { x0: d.center.x - 0.35, x1: d.center.x + 0.35, z0: d.center.z - half, z1: d.center.z + half }
  return { id: d.id, r }
})

export interface CryoTrace {
  h: CryoHospital
  /** The room's steps as they changed: [t, step, caseId]. */
  steps: { t: number; step: CryoStep; caseId: string | null }[]
  /** Broken invariants (the first few of each rule). */
  problems: string[]
  /** People who stood still in a level-2 doorway for more than 2 s. */
  stills: string[]
}

/**
 * Run the day to `until` (default 20:00) at `dt`, checking every step: the step order within a case, the robot never aiming or aligned with the
 * table in, a needle in only after it was aligned and staying in until the needles come out, the ice never shrinking within a freeze; and once
 * a second: nobody still in a level-2 doorway for more than 2 s, nobody off the floor, no seat held twice, nobody changing level in view.
 */
export function runCryoDay(seed: number, opts: CryoDayOptions & { until?: number; dt?: number } = {}): CryoTrace {
  const h = cryoSuite(seed, opts)
  const s = h.cryo.state
  const dt = opts.dt ?? 0.1
  const end = timeAtHour(opts.until ?? 20)
  const tr: CryoTrace = { h, steps: [], problems: [], stills: [] }
  const note = (rule: string, text: string) => {
    if (tr.problems.filter((p) => p.startsWith(rule)).length < 4) tr.problems.push(`${rule}: ${clockText(h.t)} ${text}`)
  }
  const still = new Map<string, number>()
  const levelOfId = new Map<string, number>()
  const aligned = new Set<string>()
  let lastKey = ''
  let lastIce = 0
  let nextSample = h.t
  // (a warm start may open with needles already in: they were aligned before the run began)
  for (const n of s.needles) if (n.inserted > 0) aligned.add(`${s.caseId}:${n.index}`)
  for (;;) {
    const key = `${s.step}:${s.caseId}`
    if (key !== lastKey) {
      const prev = tr.steps[tr.steps.length - 1]
      // within a case the steps only go forward (idle and turnover come between cases)
      if (prev !== undefined && prev.caseId !== null && prev.caseId === s.caseId && STEP_INDEX.get(s.step)! <= STEP_INDEX.get(prev.step)!) note('order', `${s.caseId} went from ${prev.step} to ${s.step}`)
      tr.steps.push({ t: h.t, step: s.step, caseId: s.caseId })
      lastKey = key
      lastIce = s.ice
    }
    if (s.tablePos > 0 && (s.robot.phase === 'aiming' || s.robot.phase === 'aligned')) note('robot', `robot ${s.robot.phase} with the table at ${s.tablePos.toFixed(2)}`)
    for (const n of s.needles) {
      const id = `${s.caseId}:${n.index}`
      if (s.step === 'aim' && s.robot.needle === n.index && s.robot.phase === 'aligned') aligned.add(id)
      if (n.inserted > 0 && !aligned.has(id)) note('needle', `${id} inserted ${n.inserted.toFixed(2)} before it was aligned`)
      const between = ['checkCt', 'freeze1', 'thaw', 'freeze2', 'activeThaw'].includes(s.step)
      if (between && n.inserted !== 1) note('needle', `${id} inserted ${n.inserted} in ${s.step}`)
    }
    if (s.step === 'freeze1' || s.step === 'freeze2') {
      if (s.ice < lastIce - 1e-9) note('ice', `the ice shrank in ${s.step}: ${lastIce} -> ${s.ice}`)
    }
    lastIce = s.ice
    if (h.t >= nextSample - 1e-9) {
      nextSample += 1
      sample(h, note, tr, still, levelOfId)
    }
    if (h.t >= end) break
    h.step(dt)
  }
  return tr
}

const inside = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1

function sample(h: CryoHospital, note: (rule: string, text: string) => void, tr: CryoTrace, still: Map<string, number>, levelOfId: Map<string, number>): void {
  const seatedBy = new Map<string, string>()
  for (const p of h.people) {
    const e = p.entity
    const w = p.walker
    const fade = e.fade ?? 1
    const lv = levelOf(w.x)
    const was = levelOfId.get(e.id)
    if (was !== undefined && was !== lv && fade > 0.01) note('level', `${e.name} changed level while visible`)
    levelOfId.set(e.id, lv)
    if (e.seated) {
      const other = seatedBy.get(e.seated.seatId)
      if (other) note('seat', `${e.seated.seatId} holds ${other} and ${e.id}`)
      seatedBy.set(e.seated.seatId, e.id)
    } else if (lv === 2 && fade >= 1 && !e.riding && (p as Actor).mode !== 'slide') {
      if (!isWalkable(w.x, w.z, 0)) note('walkable', `${e.name} (${e.role}) at (${(w.x - 150).toFixed(2)}, ${w.z.toFixed(2)}) off walkable ground`)
    }
    if (e.seated || e.riding || fade < 1 || lv !== 2) {
      still.delete(e.id)
      continue
    }
    const door = w.speed < 0.05 ? DOORWAYS.find((d) => inside(d.r, w.x, w.z)) : undefined
    if (!door) {
      still.delete(e.id)
      continue
    }
    const held = (still.get(e.id) ?? 0) + 1
    still.set(e.id, held)
    if (held > 2 + 1e-9 && held <= 3 && tr.stills.length < 20) tr.stills.push(`${clockText(h.t)} ${e.name} (${e.role}) still in ${door.id} for more than 2 s`)
  }
}
