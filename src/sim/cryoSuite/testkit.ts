/**
 * Test helpers for the cryoablation suite (not imported by the sim): a MiniHospital (../lifts/testkit: the world, the lifts, the seats, the
 * crowd and the surgery suite, whose recovery bays the cryo patients share) with the cryo suite stepped after it, and a day runner that watches
 * the suite's invariants once a sampled second.
 */
import { CONFIG } from '../config'
import { clockText } from '../events'
import { levelOf } from '../levels'
import { MiniHospital, type MiniOptions } from '../lifts/testkit'
import { isWalkable } from '../nav/layout'
import { DOORS, VEHICLE_AHEAD, VEHICLE_HALF } from '../places'
import { HopWalker } from './hop'
import { CRYO_FOOTPRINTS } from '@/scene/rooms/surgery/cryoRoom'
import { CRYO_STAFF } from '@/content/staff'
import { timeAtHour } from '../population/schedule'
import { defaultSeats } from '../seats'
import type { Actor } from '../er/actor'
import type { CryoStep, OpeningKind, SeatSpec } from '../types'
import { CryoSuite } from './index'
import { transferStepOf } from './script'
import { CRYO_STEPS } from '../types'
import { LEVEL2_DX } from '../levels'

export { DT } from '../lifts/testkit'

const CRYO_PORTER = CRYO_STAFF.find((m) => m.title === 'wardPorter')!.id
const CRYO_NURSE = CRYO_STAFF.find((m) => m.title === 'sedation')!.id

/**
 * R5 wave 3, fix round 2: where a stretcher pushed by somebody at (x, z) facing `heading` overlaps something solid in the scan room: its floor footprint
 * (half 0.4 x 1.05 m, centred 1.45 m ahead, places.ts VEHICLE_HALF / VEHICLE_AHEAD) against the CT table (table out: the patient lies on it), the gantry, the
 * robot's base, the console, the cylinders, the cabinet and the anaesthesia machine (their footprints, rotated into the sim's frame), and its sampled floor
 * points inside the room against the walls and furniture the nav layout knows. Names what it overlaps (touching is not overlapping: a depth under 2 mm).
 */
export function stretcherOverlaps(x: number, z: number, heading: number): string[] {
  const ahead = VEHICLE_AHEAD.stretcher
  const [hw, hl] = VEHICLE_HALF.stretcher
  const sx = Math.sin(heading)
  const sz = Math.cos(heading)
  const cx = x + sx * ahead
  const cz = z + sz * ahead
  const out: string[] = []
  // (the box's four corners, and the two axes along and across it)
  const corners: [number, number][] = []
  for (const u of [-1, 1]) for (const v of [-1, 1]) corners.push([cx + sx * hl * u + sz * hw * v, cz + sz * hl * u - sx * hw * v])
  const axes: [number, number][] = [[1, 0], [0, 1], [sx, sz], [sz, -sx]]
  for (const r of CRYO_FOOTPRINTS) {
    if (r.area !== 'l2Cryo' || r.overhead === true) continue
    const box: [number, number][] = [[r.x0 + LEVEL2_DX, r.z0], [r.x1 + LEVEL2_DX, r.z0], [r.x1 + LEVEL2_DX, r.z1], [r.x0 + LEVEL2_DX, r.z1]]
    let apart = false
    for (const [ax, az] of axes) {
      let a0 = Infinity
      let a1 = -Infinity
      let b0 = Infinity
      let b1 = -Infinity
      for (const [px, pz] of corners) {
        const d = px * ax + pz * az
        a0 = Math.min(a0, d)
        a1 = Math.max(a1, d)
      }
      for (const [px, pz] of box) {
        const d = px * ax + pz * az
        b0 = Math.min(b0, d)
        b1 = Math.max(b1, d)
      }
      if (Math.min(a1, b1) - Math.max(a0, b0) < 0.002) apart = true
    }
    if (!apart) out.push(r.id)
  }
  // (the walls: the sampled floor points of the box that lie inside the room, and in no footprint above, must be floor the nav layout calls walkable)
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 2; j++) {
      const px = cx + sx * hl * (i / 2 - 1) + sz * hw * (j - 1)
      const pz = cz + sz * hl * (i / 2 - 1) - sx * hw * (j - 1)
      if (px <= 88.05 || px >= 97.4 || pz <= 13.05 || pz >= 21.95 || isWalkable(px, pz, 0)) continue
      const inFurniture = CRYO_FOOTPRINTS.some((r) => r.area === 'l2Cryo' && r.overhead !== true && px >= r.x0 + LEVEL2_DX && px <= r.x1 + LEVEL2_DX && pz >= r.z0 && pz <= r.z1)
      if (!inFurniture) out.push(`wall(${px.toFixed(2)},${pz.toFixed(2)})`)
    }
  }
  return out
}

/** Where a point lies relative to a stretcher pushed by somebody at (x, z) facing `heading`: its distance to the stretcher's floor box (0 inside). */
export function distToStretcher(px: number, pz: number, x: number, z: number, heading: number): number {
  const ahead = VEHICLE_AHEAD.stretcher
  const [hw, hl] = VEHICLE_HALF.stretcher
  const sx = Math.sin(heading)
  const sz = Math.cos(heading)
  const dx = px - (x + sx * ahead)
  const dz = pz - (z + sz * ahead)
  const along = dx * sx + dz * sz
  const across = dx * sz - dz * sx
  return Math.hypot(Math.max(0, Math.abs(along) - hl), Math.max(0, Math.abs(across) - hw))
}

/**
 * The sampled floor points (a 9 x 5 grid over its box) of a stretcher pushed by somebody at (x, z) facing `heading` that are not walkable at clearance
 * `margin` (the nav layout: walls, doorframes, furniture, the beds of recovery); the names of the first few, as "(x, z)". Anywhere in the building, not
 * only the scan room. `allow` says which points of it are all right all the same (the bed a loaded stretcher is brought to lies where it ends).
 */
export function stretcherBlocked(x: number, z: number, heading: number, margin = 0, allow?: (px: number, pz: number) => boolean): string[] {
  const ahead = VEHICLE_AHEAD.stretcher
  const [hw, hl] = VEHICLE_HALF.stretcher
  const sx = Math.sin(heading)
  const sz = Math.cos(heading)
  const cx = x + sx * ahead
  const cz = z + sz * ahead
  const out: string[] = []
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 4; j++) {
      const px = cx + sx * hl * (i / 4 - 1) + sz * hw * (j / 2 - 1)
      const pz = cz + sz * hl * (i / 4 - 1) - sx * hw * (j / 2 - 1)
      if (!isWalkable(px, pz, margin) && out.length < 4 && (allow === undefined || !allow(px, pz))) out.push(`(${px.toFixed(2)},${pz.toFixed(2)})`)
    }
  }
  return out
}

/** Is a pusher at (x, z) in the scan room? */
export function inScanRoomBox(x: number, z: number): boolean {
  return x > 88.05 && x < 97.4 && z > 13.05 && z < 21.95
}

/**
 * Fix round 3: every tick, every stretcher the cryo team holds (the ward porter's or the sedation nurse's, empty or with the patient on it), from lift B to the
 * recovery bays: where it is driven along a lane or in the scan room it overlaps no furniture, wall or doorframe, nor the body of anybody (the radiographer, the
 * nurse, the radiologist, a visitor; not the case's own patient, who is moved on and off it); and at no tick does the stretcher's centre, or any person of
 * the suite, move more than `maxJump` m in a 0.1 s tick (a pop), while the stretcher is driven along a lane or in the scan room. (Not checked: the stretcher's
 * walk from a recovery bay to lift B, the crowd's own (empty on the porter's way back, or with the patient on it when the ward porter takes them up), whose
 * pivots at the bay and at the lift lobby's corner are not the lane's; and the loaded stretcher's last metres over its bay, which lies where the bed is.) `problems` has the first few of each rule, `ticks` the ticks
 * it saw a stretcher on the lane. It is the checker `runCryoDay` runs and the tests of the stretcher's way run.
 */
export class StretcherAudit {
  readonly problems: string[] = []
  ticks = 0
  private readonly prev = new Map<string, { cx: number; cz: number }>()
  private readonly prevPerson = new Map<string, { x: number; z: number }>()
  /** A point on a recovery bay's bed (the loaded stretcher ends over it). */
  private readonly atBay = (px: number, pz: number): boolean => this.h.cryo.sites.recovery.pacu.some((r) => Math.abs(px - r.seat.x) < 0.6 && Math.abs(pz - r.seat.z) < 1.2)

  constructor(
    private readonly h: CryoHospital,
    private readonly maxJump = 0.5,
  ) {}

  private note(rule: string, text: string): void {
    if (this.problems.filter((p) => p.startsWith(rule)).length < 6) this.problems.push(`${rule}: ${clockText(this.h.t)} ${text}`)
  }

  /** Check the world after a step of `dt` seconds. */
  tick(dt: number): void {
    const h = this.h
    const jump = this.maxJump * (dt / 0.1)
    const holders = new Set<string>()
    for (const p of h.people) {
      const e = p.entity
      if (e.vehicle !== 'stretcher' || e.riding === true || (e.id !== CRYO_PORTER && e.id !== CRYO_NURSE)) continue
      holders.add(e.id)
      const w = p.walker
      const cx = w.x + Math.sin(w.heading) * VEHICLE_AHEAD.stretcher
      const cz = w.z + Math.cos(w.heading) * VEHICLE_AHEAD.stretcher
      const was = this.prev.get(e.id)
      // (driven along a lane, or in the scan room: where the stretcher's way is fixed and must be clear of everything)
      const zone = inScanRoomBox(w.x, w.z) || (w instanceof HopWalker && w.isDriving)
      if (was !== undefined && zone && Math.hypot(cx - was.cx, cz - was.cz) > jump) this.note('jump', `the stretcher of ${e.id} moved ${Math.hypot(cx - was.cx, cz - was.cz).toFixed(2)} m in one step, to (${cx.toFixed(2)}, ${cz.toFixed(2)})`)
      this.prev.set(e.id, { cx, cz })
      if (!zone) continue
      this.ticks++
      const where = `pusher ${e.id} at (${w.x.toFixed(2)}, ${w.z.toFixed(2)}) facing ${w.heading.toFixed(2)}`
      const room = stretcherOverlaps(w.x, w.z, w.heading)
      if (room.length > 0) this.note('stretcher', `overlaps ${room.join(', ')} (${where})`)
      const blocked = stretcherBlocked(w.x, w.z, w.heading, 0, this.atBay)
      if (blocked.length > 0) this.note('stretcher', `on non-walkable floor ${blocked.join(' ')} (${where})`)
      // (solo walkers, with no crowd, know nobody else is there: the rule is for a hospital with its crowd)
      for (const q of h.crowd === null ? [] : h.people) {
        const qe = q.entity
        if (qe.id === e.id || qe.riding === true || qe.id.endsWith('-patient') || (qe.fade ?? 1) < 1) continue
        if (distToStretcher(q.walker.x, q.walker.z, w.x, w.z, w.heading) < 0.25) this.note('stretcherPeople', `${qe.id} at (${q.walker.x.toFixed(2)}, ${q.walker.z.toFixed(2)}) is inside the stretcher (${where})`)
      }
    }
    for (const id of [...this.prev.keys()]) if (!holders.has(id)) this.prev.delete(id)
    // (no person of the suite pops: the porter, the nurse and the team move at most a step's walk)
    for (const q of h.people) {
      const qe = q.entity
      if (!qe.id.startsWith('cryo-') || qe.id.endsWith('-patient') || (qe.fade ?? 1) < 1 || qe.riding === true) continue
      // (the porter's walk back from a bay with his empty stretcher is the crowd's)
      if (qe.id === CRYO_PORTER && qe.vehicle === 'stretcher' && (q as Actor).rider === null && !inScanRoomBox(q.walker.x, q.walker.z) && !(q.walker instanceof HopWalker && q.walker.isDriving)) {
        this.prevPerson.delete(qe.id)
        continue
      }
      const was = this.prevPerson.get(qe.id)
      const d = was === undefined ? 0 : Math.hypot(q.walker.x - was.x, q.walker.z - was.z)
      if (d > jump) this.note('jump', `${qe.id} moved ${d.toFixed(2)} m in one step, to (${q.walker.x.toFixed(2)}, ${q.walker.z.toFixed(2)})`)
      this.prevPerson.set(qe.id, { x: q.walker.x, z: q.walker.z })
    }
  }
}

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

/** R5 wave 3: a step of a script as it began (the published view's version changed). */
export interface ScriptMark {
  t: number
  caseId: string
  target: string
  stepId: string
  /** The flat step (the script's steps with the repeat run played once per needle), its unit and the repeat being played (0: not a repeat). */
  flat: number
  unit: string
  k: number
  airway: string
  position: string
  apnoea: boolean
  watch: boolean
}

export interface CryoTrace {
  h: CryoHospital
  /** The room's steps as they changed: [t, step, caseId]. */
  steps: { t: number; step: CryoStep; caseId: string | null }[]
  /** R5 wave 3: the script's steps as they began, in order. */
  script: ScriptMark[]
  /** R5 wave 3: the longest held breath seen (s), live and watch cases apart, and the cases that had a held breath at some moment. */
  longestHold: { live: number; watch: number }
  heldCases: string[]
  /** R5 wave 3: the script step under the clock each time a patient was moved from the stretcher onto the CT table. */
  unloads: { caseId: string; stepId: string; transferStepId: string }[]
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
  const tr: CryoTrace = { h, steps: [], script: [], longestHold: { live: 0, watch: 0 }, heldCases: [], unloads: [], problems: [], stills: [] }
  const note = (rule: string, text: string) => {
    if (tr.problems.filter((p) => p.startsWith(rule)).length < 4) tr.problems.push(`${rule}: ${clockText(h.t)} ${text}`)
  }
  const still = new Map<string, number>()
  // (fix round 3: every stretcher the team holds, every tick: nowhere solid, nobody inside it, no pop)
  const audit = new StretcherAudit(h)
  const levelOfId = new Map<string, number>()
  const aligned = new Set<string>()
  let lastKey = ''
  let lastIce = 0
  let lastVersion = s.procedure.version
  let nextSample = h.t
  // R5 wave 3: the held breath: when it began, and whether the push or scan step under the clock has had it (a step that began before the run is not judged)
  let holdSince = -1
  let open: { stepId: string; unit: string; target: string; must: boolean; held: boolean } | null = null
  const mounted = new Map<string, boolean>()
  const closeStep = () => {
    if (open !== null && open.must && !open.held) note('apnoea', `no breath held in ${open.unit} / ${open.stepId} of a ${open.target} case`)
    open = null
  }
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
    // R5 wave 3: the script's steps as they begin, and the held breath only in a scan or a needle push of the lung and the liver
    const v = s.procedure
    if (v.version !== lastVersion) {
      lastVersion = v.version
      closeStep()
      if (v.procedureId !== null) {
        tr.script.push({ t: h.t, caseId: v.caseId ?? '', target: s.target, stepId: v.stepId, flat: v.stepIndex, unit: v.unit, k: v.repeat?.k ?? 0, airway: v.patient.airway, position: v.patient.position, apnoea: s.apnoea, watch: v.watch })
        const scanUnit = v.unit === 'planningCt' || v.unit === 'checkCt' || v.unit === 'finalCt'
        open = { stepId: v.stepId, unit: v.unit, target: s.target, must: s.target !== 'kidney' && (scanUnit || v.stepId === 'pushNeedle') && h.cryo.team.present, held: false }
      }
    }
    // R5 wave 3: the held breath is a few seconds of a push or a scan, never longer than CONFIG.cryoSuite.apnoeaSeconds in the living day, and
    // true at some moment of every push and every scan of the lung and the liver (the step is judged as it ends)
    if (s.apnoea) {
      const scan = s.step === 'planningCt' || s.step === 'checkCt' || s.step === 'finalCt'
      if (s.target === 'kidney' || !(scan || (s.step === 'aim' && v.stepId === 'pushNeedle'))) note('apnoea', `breath held in ${s.step} / ${v.stepId} of a ${s.target} case`)
      if (holdSince < 0) holdSince = h.t
      if (v.caseId !== null && !tr.heldCases.includes(v.caseId)) tr.heldCases.push(v.caseId)
      const run = h.t - holdSince
      const kind = v.watch ? 'watch' : 'live'
      if (run > tr.longestHold[kind]) tr.longestHold[kind] = run
      if (kind === 'live' && run > CONFIG.cryoSuite.apnoeaSeconds + 0.5) note('apnoea', `breath held for ${run.toFixed(1)} s in ${s.step} / ${v.stepId} of a ${s.target} case`)
      if (open !== null) open.held = true
    } else holdSince = -1
    // R5 wave 3: the patient is moved from the porter's stretcher onto the CT table as the transfer step is under the clock
    for (const c of h.cryo.runs) {
      const p = c.stage === 'arriving' ? c.patient : null
      if (p === null || c.proc === null) {
        mounted.delete(c.id)
        continue
      }
      const was = mounted.get(c.id)
      mounted.set(c.id, p.mounted)
      if (was === true && !p.mounted && !tr.unloads.some((u) => u.caseId === c.id)) {
        const u = { caseId: c.id, stepId: v.caseId === c.id ? v.stepId : '', transferStepId: c.proc.steps.cs.script.steps[transferStepOf(c.proc.steps.cs)].id }
        tr.unloads.push(u)
        if (u.stepId !== u.transferStepId) note('transfer', `${c.id} was moved onto the CT table in "${u.stepId}", not in the transfer step "${u.transferStepId}"`)
      }
    }
    // R5 wave 3, fix round 2: the transfer step is not published while the patient is still on the porter's stretcher
    for (const c of h.cryo.runs) {
      if (c.stage === 'arriving' && c.patient !== null && c.patient.mounted && v.caseId === c.id && v.procedureId !== null && c.proc !== null && v.stepId === c.proc.steps.cs.script.steps[transferStepOf(c.proc.steps.cs)].id) {
        note('transfer', `${c.id}: "${v.stepId}" is under the clock with the patient still on the stretcher`)
      }
    }
    if (s.tablePos > 0 && (s.robot.phase === 'aiming' || s.robot.phase === 'aligned')) note('robot', `robot ${s.robot.phase} with the table at ${s.tablePos.toFixed(2)}`)
    for (const n of s.needles) {
      // R5 wave 3, fix round 2: a lung or liver needle is advanced only during the held breath, never while the patient breathes (taking the needles out is another step)
      if (v.procedureId !== null && s.target !== 'kidney' && s.step === 'aim' && n.inserted > 0 && n.inserted < 1 && !s.apnoea) note('apnoea', `needle ${s.caseId}:${n.index} moving (${n.inserted.toFixed(2)}) while the patient breathes (${s.step} / ${v.stepId}, ${v.watch ? 'watch' : 'live'})`)
      const id = `${s.caseId}:${n.index}`
      if (s.step === 'aim' && s.robot.needle === n.index && s.robot.phase === 'aligned') aligned.add(id)
      if (n.inserted > 0 && !aligned.has(id)) note('needle', `${id} inserted ${n.inserted.toFixed(2)} before it was aligned`)
      const between = ['checkCt', 'anchorFreeze', 'anchorThaw', 'freeze1', 'thaw', 'freeze2', 'activeThaw'].includes(s.step)
      if (between && n.inserted !== 1) note('needle', `${id} inserted ${n.inserted} in ${s.step}`)
    }
    if (s.step === 'anchorFreeze' || s.step === 'freeze1' || s.step === 'freeze2') {
      if (s.ice < lastIce - 1e-9) note('ice', `the ice shrank in ${s.step}: ${lastIce} -> ${s.ice}`)
    }
    lastIce = s.ice
    if (h.t >= nextSample - 1e-9) {
      nextSample += 1
      sample(h, note, tr, still, levelOfId)
      posePoints(h, note)
    }
    if (h.t >= end) break
    h.step(dt)
    audit.tick(dt)
  }
  closeStep()
  tr.problems.push(...audit.problems)
  return tr
}

/**
 * R5 wave 3, once a second: the patient in the room carries the view's own table pose object, and nobody else does (the pose is cleared when they leave
 * the CT table); a patient is on their back before they are moved to the stretcher; the tube only while the script has it in.
 */
function posePoints(h: CryoHospital, note: (rule: string, text: string) => void): void {
  const s = h.cryo.state
  for (const c of h.cryo.runs) {
    const p = c.patient
    if (p === null) continue
    const inRoom = c.stage === 'arriving' || c.stage === 'room'
    const pose = p.entity.patientPose ?? null
    if (inRoom && s.procedure.procedureId !== null && s.procedure.caseId === c.id) {
      if (pose !== s.procedure.patient) note('pose', `${c.id} is in the room without the published pose`)
    } else if (!inRoom && pose !== null) note('pose', `${c.id} (${c.stage}) still carries a table pose`)
    if (c.stage === 'toPacu' && s.procedure.caseId === c.id && s.procedure.patient.position !== 'supine') note('pose', `${c.id} was moved to the stretcher ${s.procedure.patient.position}`)
  }
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
