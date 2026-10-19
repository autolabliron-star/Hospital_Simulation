/**
 * Test helper (not imported by the sim): run a whole robotic day in a mini hospital and watch it, collecting the robot's and the theatre's phase
 * changes and a list of broken invariants, sampled once a second of sim time. The tests assert on the trace; a failing invariant names the time,
 * the person and the rule.
 */
import { DOORS } from '../places'
import { clockText } from '../events'
import { l2, levelOf } from '../levels'
import type { Actor } from '../er/actor'
import type { MiniHospital } from '../lifts/testkit'
import { isWalkable } from '../nav/layout'
import { timeAtHour } from '../population/schedule'
import type { CasePhase, RobotPhase } from '../types'
import type { Surgery } from './index'
import { suite, type SuiteOptions } from './testkit'

interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** Every level-2 doorway as a small rectangle in the wall opening (the openings too: nobody stands still in them). */
const DOORWAYS: { id: string; r: Rect }[] = DOORS.filter((d) => d.id.startsWith('l2')).map((d) => {
  const half = d.width / 2
  const r =
    d.wallAxis === 'x'
      ? { x0: d.center.x - half, x1: d.center.x + half, z0: d.center.z - 0.35, z1: d.center.z + 0.35 }
      : { x0: d.center.x - 0.35, x1: d.center.x + 0.35, z0: d.center.z - half, z1: d.center.z + half }
  return { id: d.id, r }
})

const inside = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1

export interface Trace {
  h: MiniHospital
  surgery: Surgery
  robot: { t: number; kind: RobotPhase; caseId: string | null }[]
  theatre: { t: number; phase: CasePhase | 'idle' | 'turnover'; caseId: string | null }[]
  /** Broken invariants (the first few of each rule). */
  problems: string[]
  /** People who stood still in a level-2 doorway for more than 2 s. */
  stills: string[]
  /** The largest number of people on level 2 at once. */
  peak: number
}

export interface TraceOptions extends SuiteOptions {
  /** The clock hour to run to (default 19.5, after the team has gone home). */
  until?: number
  /** The step (s). Default 0.1 (cheap: the movement is exact at any step). */
  dt?: number
  /** Check invariants once per this many sim seconds (default 1). */
  every?: number
}

const LIGHT_PHASES: ReadonlySet<string> = new Set(['induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence'])

/** Which theatre phases each robot phase may stand in. */
function robotAllowed(kind: RobotPhase, phase: CasePhase | 'idle' | 'turnover'): boolean {
  switch (kind) {
    case 'stowed':
      return phase === 'idle' || phase === 'turnover' || phase === 'toTheatre'
    case 'draping':
    case 'draped':
      return ['idle', 'turnover', 'toTheatre', 'in', 'induction', 'positioning', 'ports'].includes(phase)
    case 'deploying':
    case 'driving':
    case 'docking':
    case 'targeting':
      return phase === 'docking'
    case 'docked':
      return phase === 'docking' || phase === 'console'
    case 'undocking':
    case 'returning':
      return phase === 'undocking'
    case 'cleaning':
      return ['closing', 'emergence', 'out', 'turnover', 'idle', 'toTheatre', 'in'].includes(phase) || phase === 'undocking'
  }
}

export function traceDay(seed: number, opts: TraceOptions = {}): Trace {
  const h = suite(seed, opts)
  const s = h.surgery!
  const dt = opts.dt ?? 0.1
  const every = opts.every ?? 1
  const end = timeAtHour(opts.until ?? 19.5)
  const trace: Trace = { h, surgery: s, robot: [], theatre: [], problems: [], stills: [], peak: 0 }
  const note = (rule: string, text: string) => {
    if (trace.problems.filter((p) => p.startsWith(rule)).length < 4) trace.problems.push(`${rule}: ${clockText(h.t)} ${text}`)
  }
  const still = new Map<string, number>()
  const levelOfId = new Map<string, number>()
  let lastRobot = ''
  let lastTheatre = ''
  let nextCheck = h.t
  // the first sample is the starting state
  for (;;) {
    const st = s.state
    if (st.robot.phase + ':' + (st.theatre.caseId ?? '') !== lastRobot) {
      lastRobot = st.robot.phase + ':' + (st.theatre.caseId ?? '')
      trace.robot.push({ t: h.t, kind: st.robot.phase, caseId: st.theatre.caseId })
    }
    const tk = st.theatre.phase + ':' + (st.theatre.caseId ?? '')
    if (tk !== lastTheatre) {
      lastTheatre = tk
      trace.theatre.push({ t: h.t, phase: st.theatre.phase, caseId: st.theatre.caseId })
    }
    if (h.t >= nextCheck - 1e-9) {
      nextCheck += every
      check(h, s, trace, note, still, levelOfId)
    }
    if (h.t >= end) break
    h.step(dt)
  }
  return trace
}

function check(h: MiniHospital, s: Surgery, trace: Trace, note: (rule: string, text: string) => void, still: Map<string, number>, levelOfId: Map<string, number>): void {
  const st = s.state
  const seatedBy = new Map<string, string>()
  let onL2 = 0
  const sample = 1
  for (const p of h.people) {
    const e = p.entity
    const w = p.walker
    const fade = e.fade ?? 1
    if (levelOf(w.x) === 2 && fade > 0) onL2++
    // a person changes level only while hidden in a lift car
    const lv = levelOf(w.x)
    const was = levelOfId.get(e.id)
    if (was !== undefined && was !== lv && fade > 0.01) note('level', `${e.name} (${e.role}) changed level while visible (fade ${fade.toFixed(2)})`)
    levelOfId.set(e.id, lv)
    if (e.seated) {
      const other = seatedBy.get(e.seated.seatId)
      if (other) note('seat', `${e.seated.seatId} holds ${other} and ${e.id}`)
      seatedBy.set(e.seated.seatId, e.id)
      if (h.seats.all.some((x) => x.id === e.seated!.seatId) && h.seats.occupant(e.seated.seatId) !== e.id) note('claim', `${e.name} sits on ${e.seated.seatId} held by ${h.seats.occupant(e.seated.seatId)}`)
    } else if (lv === 2 && fade >= 1 && !e.riding && p.mobile && (p as Actor).mode !== 'slide') {
      if (!isWalkable(w.x, w.z, 0)) note('walkable', `${e.name} (${e.role}) stands at (${(w.x - 150).toFixed(2)}, ${w.z.toFixed(2)}) off walkable ground`)
    }
    // nobody stands still in a doorway for more than 2 s
    if (!p.mobile || e.seated || e.riding || fade < 1 || lv !== 2) {
      still.delete(e.id)
      continue
    }
    const door = w.speed < 0.05 ? DOORWAYS.find((d) => inside(d.r, w.x, w.z)) : undefined
    if (!door) {
      still.delete(e.id)
      continue
    }
    const held = (still.get(e.id) ?? 0) + sample
    still.set(e.id, held)
    if (held > 2 + 1e-9 && held <= 2 + sample && trace.stills.length < 20) trace.stills.push(`${clockText(h.t)} ${e.name} (${e.role}) still in ${door.id} for more than 2 s`)
  }
  trace.peak = Math.max(trace.peak, onL2)
  // the theatre, the robot and the people agree
  const th = st.theatre
  const room = s.runs.filter((c) => c.inRoom)
  if (room.length > 1) note('room', `${room.length} cases in the room at once`)
  const lit = room.length === 1 && LIGHT_PHASES.has(room[0].stage)
  if (th.lights !== lit) note('lights', `lights ${th.lights} in phase ${th.phase}`)
  if (th.caseId !== null && th.phase !== 'toTheatre' && !room.some((c) => c.id === th.caseId)) note('theatre', `case ${th.caseId} is not in the room in phase ${th.phase}`)
  if (!robotAllowed(st.robot.phase, th.phase)) note('robot', `robot ${st.robot.phase} while the theatre is ${th.phase}`)
  if (th.surgeonAtConsole) {
    const surgeon = h.people.find((p) => p.entity.id === 'or-surgeon')
    if (th.phase !== 'console' || surgeon?.entity.anim !== 'console' || surgeon.entity.seated?.seatId !== 'console:or:surgeon') note('console', `surgeonAtConsole with the surgeon ${surgeon?.entity.anim} ${surgeon?.entity.seated?.seatId} in ${th.phase}`)
  }
  if (th.phase === 'console' && st.robot.phase !== 'docked') note('console', `console phase with the robot ${st.robot.phase}`)
  // the patient in the room lies on the table
  for (const c of room) {
    const pt = c.patient
    if (pt === null) continue
    if (c.stage !== 'out' && pt.mode !== 'slide' && pt.entity.seated?.seatId !== 'orTable:0') note('table', `${c.id} is ${c.stage} but the patient is ${pt.entity.seated?.seatId ?? 'not seated'}`)
  }
  // the cart stays on its drive path (x between park and dock, inside the room)
  const cart = st.robot.cart
  if (cart.x < l2(-53) || cart.x > l2(-44) || cart.z < 2 || cart.z > 10) note('cart', `cart at (${(cart.x - 150).toFixed(2)}, ${cart.z.toFixed(2)})`)
}
