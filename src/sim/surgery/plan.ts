/**
 * R2: the robotic day's plan. PURE and SEEDED (no world, no people, no clock): `planDay(rng)` draws today's list from CONFIG.surgery and
 * returns, for every case, the times and durations the surgery suite then follows. The same seed gives the same plan, whatever hour a
 * Jump starts at, so a warm start can place every case from `timelineOf(case)` and a replay is exact.
 *
 *   list        one template of CONFIG.surgery.templates; the first case is wheeled in at firstInHour, each next one at the previous
 *               planned wheels-in plus that room time plus its turnover; none starts after lastStartHour
 *   delays      now and then a case runs late (an overrunning anaesthetic visit, a late bed): the delay carries on to the next cases
 *               through the turnover chain (`nominalIn` is when the room is really free)
 *   room time   drawn inside CONFIG.surgery.roomMinutes (and the console time inside consoleMinutes, both shrunk by a minute so a few
 *               seconds of walking never push a case out of its band); the other nine-minus-one phases are drawn from phaseMinutes and
 *               scaled together so the room time comes out as drawn
 *   exchanges   the bedside instrument swaps during the console phase, at seeded times
 *
 * Nothing here decides anything clinical: durations and the home-or-ward outcome are draws.
 */
import { SURGERY_COPY } from '@/content/surgery'
import { CONFIG } from '../config'
import { timeAtHour } from '../population/schedule'
import type { PortLayout } from '../places'
import type { Rng } from '../rng'
import type { SurgeryProcedure } from '../types'

/** The theatre phases a patient goes through in the room, in order. */
export const ROOM_PHASES = ['in', 'induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence', 'out'] as const
export type RoomPhase = (typeof ROOM_PHASES)[number]
export type PhaseSeconds = Record<RoomPhase, number>

/** Seconds from the arrival at the entrance until the party is upstairs and sitting in pre-op (nominal: check-in, the lift, the walk). */
export const ARRIVE_SECONDS = 300
/** The patient is ready (all pre-op visits done) this long before wheels-in, and the porter leaves for them this long before. */
export const READY_MARGIN = 240
export const PORTER_LEAD = 150
/** Moving the patient from the OR door to the PACU bay (nominal, for the timeline). */
export const TO_PACU_SECONDS = 90
/** The robot is draped this long before wheels-in (the drape window ends then). */
export const DRAPE_MARGIN = 210
/** The ward patient's porter ride from PACU to the lift (nominal). */
export const TO_WARD_SECONDS = 90
/** The leaving walk of a day case (lounge to the lift, the ride, the walk out): nominal, for the timeline only. */
export const LEAVE_SECONDS = 150

export interface PlannedExchange {
  /** Seconds into the console phase. */
  at: number
  /** The arm index (never 1: that is the endoscope). */
  arm: 0 | 2 | 3
  instrument: string
}

export interface PlannedCase {
  id: string
  index: number
  procedure: SurgeryProcedure
  layout: PortLayout
  outcome: 'home' | 'ward'
  /** The schedule's wheels-in (sim seconds), and how much later this case itself runs (a seeded delay). */
  plannedIn: number
  delay: number
  /** When the room really frees up for it: max(plannedIn + delay, the previous out + its turnover). The suite follows this one. */
  nominalIn: number
  arriveAt: number
  phases: PhaseSeconds
  roomSeconds: number
  consoleSeconds: number
  drapeSeconds: number
  preOp: { gown: number; nurse: number; anaes: number; surgeon: number }
  pacuSeconds: number
  /** Day cases only (0 for a ward patient). */
  phase2Seconds: number
  turnoverSeconds: number
  exchanges: PlannedExchange[]
  motionSeed: number
  /** Where the boom ends up when the arms have targeted (rad, relative to the cart). */
  boomYaw: number
}

/** Every nominal time of a case (sim seconds): the plan laid out in time. */
export interface Timeline {
  arriveAt: number
  upstairsBy: number
  preOpStart: number
  gownEnd: number
  nurseEnd: number
  anaesEnd: number
  readyAt: number
  toTheatreAt: number
  drapeStart: number
  drapeEnd: number
  phaseStart: PhaseSeconds
  phaseEnd: PhaseSeconds
  /** Wheels-out (the end of the 'out' phase) and the turnover that follows. */
  outAt: number
  turnoverEnd: number
  pacuIn: number
  pacuOut: number
  /** Day cases: when the lounge rest ends; ward cases: when the porter has taken them to the lift. */
  phase2End: number
  leftAt: number
}

function between(rng: Rng, band: readonly [number, number], shrinkMinutes = 0): number {
  const lo = band[0] + shrinkMinutes
  const hi = band[1] - shrinkMinutes
  return rng.between(lo <= hi ? [lo, hi] : band) * 60
}

const SHRINK = 1

/** Draw one case's room phases: the console time and the room time inside their bands, the rest scaled to fit. */
function drawPhases(rng: Rng, procedure: SurgeryProcedure): { phases: PhaseSeconds; room: number; console: number } {
  const c = between(rng, CONFIG.surgery.consoleMinutes[procedure], SHRINK)
  const natural = {} as PhaseSeconds
  let others = 0
  for (const p of ROOM_PHASES) {
    if (p === 'console') {
      natural.console = c
      continue
    }
    natural[p] = between(rng, CONFIG.surgery.phaseMinutes[p])
    others += natural[p]
  }
  const [rLo, rHi] = CONFIG.surgery.roomMinutes[procedure].map((m) => m * 60) as [number, number]
  const lo = rLo + SHRINK * 60
  const hi = rHi - SHRINK * 60
  const room = Math.min(hi, Math.max(lo, c + others))
  const scale = (room - c) / others
  const phases = {} as PhaseSeconds
  for (const p of ROOM_PHASES) phases[p] = p === 'console' ? c : natural[p] * scale
  return { phases, room, console: c }
}

/** The instrument swaps of one case, from the procedure's copy (the swapped-in names), each arm never repeating what it holds. */
function drawExchanges(rng: Rng, procedure: SurgeryProcedure, consoleSeconds: number): PlannedExchange[] {
  const copy = SURGERY_COPY.procedures[procedure]
  const rate = rng.between(CONFIG.surgery.exchangesPerHour)
  const n = Math.max(1, Math.round((rate * consoleSeconds) / 3600))
  const times: number[] = []
  for (let i = 0; i < n; i++) times.push(rng.range(0.1, 0.92) * consoleSeconds)
  times.sort((a, b) => a - b)
  const held = copy.instruments.slice()
  const pool = [...copy.exchanges, ...copy.instruments.filter((_, i) => i !== 1)]
  const arms = [0, 2, 3] as const
  const out: PlannedExchange[] = []
  times.forEach((at, i) => {
    const arm = arms[(i + rng.int(0, 2)) % 3]
    const options = pool.filter((name) => !held.includes(name))
    const instrument = rng.pick(options.length > 0 ? options : pool)
    held[arm] = instrument
    out.push({ at, arm, instrument })
  })
  return out
}

/** Today's list. */
export function planDay(root: Rng): PlannedCase[] {
  const template = root.fork('template').pick(CONFIG.surgery.templates)
  const cases: PlannedCase[] = []
  const lastStart = timeAtHour(CONFIG.surgery.lastStartHour)
  let plannedIn = timeAtHour(CONFIG.surgery.firstInHour)
  let freeAt = -Infinity
  for (let k = 0; k < template.length; k++) {
    if (plannedIn > lastStart) break
    const procedure = template[k]
    const rng = root.fork(`case:${k}`)
    const { phases, room, console: consoleSeconds } = drawPhases(rng, procedure)
    const turnoverSeconds = between(rng, CONFIG.surgery.turnoverMinutes)
    const outcome: 'home' | 'ward' = rng.chance(CONFIG.surgery.homeShare[procedure]) ? 'home' : 'ward'
    // a case runs late now and then (a late first case is rarer), and the delay is passed on through the turnover chain
    const delay = rng.chance(k === 0 ? 0.15 : 0.25) ? rng.range(5, 18) * 60 : 0
    const nominalIn = Math.max(plannedIn + delay, freeAt)
    const arriveAt = plannedIn - between(rng, CONFIG.surgery.arriveBeforeMinutes)
    const preOp = {
      gown: between(rng, CONFIG.surgery.preOpMinutes.gown),
      nurse: between(rng, CONFIG.surgery.preOpMinutes.nurse),
      anaes: between(rng, CONFIG.surgery.preOpMinutes.anaesthetist),
      surgeon: between(rng, CONFIG.surgery.preOpMinutes.surgeon),
    }
    const pacuSeconds = between(rng, CONFIG.surgery.pacuMinutes)
    const phase2Seconds = outcome === 'home' ? between(rng, CONFIG.surgery.phase2Minutes) : 0
    const drapeSeconds = between(rng, CONFIG.surgery.drapeMinutes)
    cases.push({
      id: `sx-${k + 1}`,
      index: k,
      procedure,
      layout: SURGERY_COPY.procedures[procedure].portLayout,
      outcome,
      plannedIn,
      delay,
      nominalIn,
      arriveAt,
      phases,
      roomSeconds: room,
      consoleSeconds,
      drapeSeconds,
      preOp,
      pacuSeconds,
      phase2Seconds,
      turnoverSeconds,
      exchanges: drawExchanges(rng.fork('exchanges'), procedure, consoleSeconds),
      motionSeed: rng.int(1, 0x3fffffff),
      boomYaw: rng.range(-0.35, 0.35),
    })
    freeAt = nominalIn + room + turnoverSeconds
    plannedIn = plannedIn + room + turnoverSeconds
  }
  return cases
}

/** The plan laid out in time (nominal: the suite follows these times, a few seconds late for walking). */
export function timelineOf(c: PlannedCase): Timeline {
  const preOpTotal = c.preOp.gown + c.preOp.nurse + c.preOp.anaes + c.preOp.surgeon
  const readyAt = c.nominalIn - READY_MARGIN
  const preOpStart = readyAt - preOpTotal
  const gownEnd = preOpStart + c.preOp.gown
  const nurseEnd = gownEnd + c.preOp.nurse
  const anaesEnd = nurseEnd + c.preOp.anaes
  const phaseStart = {} as PhaseSeconds
  const phaseEnd = {} as PhaseSeconds
  let t = c.nominalIn
  for (const p of ROOM_PHASES) {
    phaseStart[p] = t
    t += c.phases[p]
    phaseEnd[p] = t
  }
  const outAt = t
  const pacuIn = outAt + TO_PACU_SECONDS
  const pacuOut = pacuIn + c.pacuSeconds
  const phase2End = c.outcome === 'home' ? pacuOut + c.phase2Seconds : pacuOut
  return {
    arriveAt: c.arriveAt,
    upstairsBy: c.arriveAt + ARRIVE_SECONDS,
    preOpStart,
    gownEnd,
    nurseEnd,
    anaesEnd,
    readyAt,
    toTheatreAt: c.nominalIn - PORTER_LEAD,
    drapeStart: c.nominalIn - DRAPE_MARGIN - c.drapeSeconds,
    drapeEnd: c.nominalIn - DRAPE_MARGIN,
    phaseStart,
    phaseEnd,
    outAt,
    turnoverEnd: outAt + c.turnoverSeconds,
    pacuIn,
    pacuOut,
    phase2End,
    leftAt: phase2End + (c.outcome === 'home' ? LEAVE_SECONDS : TO_WARD_SECONDS),
  }
}
