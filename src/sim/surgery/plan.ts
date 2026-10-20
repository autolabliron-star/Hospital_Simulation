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
import type { OpeningKind, SurgeryProcedure } from '../types'

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
/** An early patient (showcase) is in the building this long before the bay is wanted, on top of ARRIVE_SECONDS. */
const EARLY_SLACK = 120
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
  /**
   * S1 showcase: the early next patient (case 2) is in a pre-op bay from this time (pre-op starts then, not at the usual
   * readyAt - visits), and waits there until the theatre team is free for the visits (`Timeline.visitsAt`). null: the usual timing.
   */
  earlyBayAt: number | null
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
  /** When the anaesthetist's visit begins: the nurse's check ends here for a usual case; an early patient lies in the bay until then. */
  visitsAt: number
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

interface Drawn {
  phases: PhaseSeconds
  room: number
  console: number
  turnoverSeconds: number
  outcome: 'home' | 'ward'
  delay: number
  arriveBefore: number
  preOp: PlannedCase['preOp']
  pacuSeconds: number
  phase2Seconds: number
  drapeSeconds: number
  exchanges: PlannedExchange[]
  motionSeed: number
  boomYaw: number
}

/**
 * Every draw of one case, in the one fixed order (so a case's numbers never depend on where it sits in the day). `firstOfDay` only
 * picks the delay odds; `forceHome` (the showcase's early case) overrides the outcome after it was drawn.
 */
function drawCase(rng: Rng, procedure: SurgeryProcedure, firstOfDay: boolean, forceHome = false): Drawn {
  const { phases, room, console: consoleSeconds } = drawPhases(rng, procedure)
  const turnoverSeconds = between(rng, CONFIG.surgery.turnoverMinutes)
  const drawnHome = rng.chance(CONFIG.surgery.homeShare[procedure])
  const outcome: 'home' | 'ward' = drawnHome || forceHome ? 'home' : 'ward'
  // a case runs late now and then (a late first case is rarer), and the delay is passed on through the turnover chain
  const delay = rng.chance(firstOfDay ? 0.15 : 0.25) ? rng.range(5, 18) * 60 : 0
  const arriveBefore = between(rng, CONFIG.surgery.arriveBeforeMinutes)
  const preOp = {
    gown: between(rng, CONFIG.surgery.preOpMinutes.gown),
    nurse: between(rng, CONFIG.surgery.preOpMinutes.nurse),
    anaes: between(rng, CONFIG.surgery.preOpMinutes.anaesthetist),
    surgeon: between(rng, CONFIG.surgery.preOpMinutes.surgeon),
  }
  const pacuSeconds = between(rng, CONFIG.surgery.pacuMinutes)
  const phase2Seconds = outcome === 'home' ? between(rng, CONFIG.surgery.phase2Minutes) : 0
  const drapeSeconds = between(rng, CONFIG.surgery.drapeMinutes)
  return {
    phases,
    room,
    console: consoleSeconds,
    turnoverSeconds,
    outcome,
    delay,
    arriveBefore,
    preOp,
    pacuSeconds,
    phase2Seconds,
    drapeSeconds,
    exchanges: drawExchanges(rng.fork('exchanges'), procedure, consoleSeconds),
    motionSeed: rng.int(1, 0x3fffffff),
    boomYaw: rng.range(-0.35, 0.35),
  }
}

function makeCase(id: string, index: number, procedure: SurgeryProcedure, d: Drawn, plannedIn: number, delay: number, nominalIn: number): PlannedCase {
  return {
    id,
    index,
    procedure,
    layout: SURGERY_COPY.procedures[procedure].portLayout,
    outcome: d.outcome,
    plannedIn,
    delay,
    nominalIn,
    arriveAt: plannedIn - d.arriveBefore,
    earlyBayAt: null,
    phases: d.phases,
    roomSeconds: d.room,
    consoleSeconds: d.console,
    drapeSeconds: d.drapeSeconds,
    preOp: d.preOp,
    pacuSeconds: d.pacuSeconds,
    phase2Seconds: d.phase2Seconds,
    turnoverSeconds: d.turnoverSeconds,
    exchanges: d.exchanges,
    motionSeed: d.motionSeed,
    boomYaw: d.boomYaw,
  }
}

/** Seconds from wheels-in to the start of the console phase. */
function beforeConsole(phases: PhaseSeconds): number {
  let t = 0
  for (const p of ROOM_PHASES) {
    if (p === 'console') break
    t += phases[p]
  }
  return t
}

/**
 * The showcase's two opening cases, laid out backwards from the anchor hour (S1): case 1 (the console case) is `elapsed` minutes into its
 * console phase at the anchor, with no delay; case 0 (the early case) leaves the room one drawn turnover before case 1 comes in and is
 * still in recovery at the anchor with `left` minutes of it to go, going home afterwards. Its recovery time is whatever that makes
 * (the draw's own if it fits), trimmed by shortening `left` and `elapsed` toward their lower bounds if it would pass the recovery band.
 */
function showcaseOpening(root: Rng): PlannedCase[] {
  const sc = CONFIG.surgery.showcase
  const anchor = timeAtHour(sc.anchorHour)
  const pick = root.fork('showcase')
  let elapsed = between(pick, sc.consoleElapsedMinutes)
  let left = between(pick, sc.pacuLeftMinutes)
  const d0 = drawCase(root.fork('case:early'), sc.early, true, true)
  const d1 = drawCase(root.fork('case:console'), sc.atConsole, false)
  const pre1 = beforeConsole(d1.phases)
  // (the console must still be running at the anchor)
  elapsed = Math.min(elapsed, d1.console * 0.5)
  const pacuMax = CONFIG.surgery.pacuMinutes[1] * 60
  const pacuFor = () => left + pre1 + elapsed + d0.turnoverSeconds - TO_PACU_SECONDS
  let excess = pacuFor() - pacuMax
  if (excess > 0) {
    left -= Math.min(excess, left - sc.pacuLeftMinutes[0] * 60)
    excess = pacuFor() - pacuMax
  }
  if (excess > 0) elapsed -= Math.min(excess, elapsed - sc.consoleElapsedMinutes[0] * 60)
  const nominalIn1 = anchor - pre1 - elapsed
  const outAt0 = nominalIn1 - d0.turnoverSeconds
  d0.pacuSeconds = anchor + left - (outAt0 + TO_PACU_SECONDS)
  d0.delay = 0
  d1.delay = 0
  const nominalIn0 = outAt0 - d0.room
  return [makeCase('sx-1', 0, sc.early, d0, nominalIn0, 0, nominalIn0), makeCase('sx-2', 1, sc.atConsole, d1, nominalIn1, 0, nominalIn1)]
}

/**
 * Today's list. 'quiet' (the default) is the plain seeded template from firstInHour. 'showcase' (S1) opens on a busy theatre: an early
 * case in recovery and a case at the console at CONFIG.surgery.showcase.anchorHour, then the same seeded template chained after them
 * (the template's cases keep their forks and so their draws; only their times shift).
 */
export function planDay(root: Rng, opening: OpeningKind = 'quiet'): PlannedCase[] {
  const template = root.fork('template').pick(CONFIG.surgery.templates)
  const cases: PlannedCase[] = opening === 'showcase' ? showcaseOpening(root) : []
  const lead = cases.length
  const lastStart = timeAtHour(CONFIG.surgery.lastStartHour)
  let plannedIn = lead > 0 ? cases[lead - 1].nominalIn + cases[lead - 1].roomSeconds + cases[lead - 1].turnoverSeconds : timeAtHour(CONFIG.surgery.firstInHour)
  let freeAt = lead > 0 ? plannedIn : -Infinity
  for (let k = 0; k < template.length; k++) {
    if (plannedIn > lastStart) break
    const procedure = template[k]
    const d = drawCase(root.fork(`case:${k}`), procedure, k === 0)
    const nominalIn = Math.max(plannedIn + d.delay, freeAt)
    const c = makeCase(`sx-${lead + k + 1}`, lead + k, procedure, d, plannedIn, d.delay, nominalIn)
    if (lead > 0 && k === 0) {
      // the next patient is already lying in a pre-op bay at the opening: they come in early enough for that
      c.earlyBayAt = timeAtHour(CONFIG.surgery.showcase.nextBayHour)
      c.arriveAt = Math.min(c.arriveAt, c.earlyBayAt - ARRIVE_SECONDS - EARLY_SLACK)
    }
    cases.push(c)
    freeAt = nominalIn + d.room + d.turnoverSeconds
    plannedIn = plannedIn + d.room + d.turnoverSeconds
  }
  return cases
}

/** The plan laid out in time (nominal: the suite follows these times, a few seconds late for walking). */
export function timelineOf(c: PlannedCase): Timeline {
  const preOpTotal = c.preOp.gown + c.preOp.nurse + c.preOp.anaes + c.preOp.surgeon
  const readyAt = c.nominalIn - READY_MARGIN
  const preOpStart = c.earlyBayAt === null ? readyAt - preOpTotal : Math.min(c.earlyBayAt, readyAt - preOpTotal)
  const gownEnd = preOpStart + c.preOp.gown
  const nurseEnd = gownEnd + c.preOp.nurse
  // (an early patient lies in the bay after the nurse's check until the doctors' visits fit in front of wheels-in; for a usual case that is the same moment)
  const visitsAt = c.earlyBayAt === null ? nurseEnd : Math.max(nurseEnd, readyAt - c.preOp.anaes - c.preOp.surgeon)
  const anaesEnd = visitsAt + c.preOp.anaes
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
    visitsAt,
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
