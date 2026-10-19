/**
 * The view model of the robot blood-draw centre's room panel: a plain, JSON-serialisable snapshot of `sim.blood` with every sentence already
 * worded (src/content/drawUi.json), so the panel only lays it out and `usePoll` can compare snapshots cheaply. Pure: no React, no three.js. Polled
 * at about 4 Hz by the panel, never per frame. Every name and number is synthetic.
 */
import { DRAW_UI, fillDraw, phaseText } from '@/content/drawUi'
import type { DrawPort } from '@/sim/blood/ports'
import type { DrawPhase, DrawStationState } from '@/sim/types'

/** What the view reads of the draw centre (a `DrawPort` satisfies it). */
export type DrawSource = Pick<DrawPort, 'stations' | 'prep' | 'queue' | 'calling' | 'nurseId' | 'stats'>

export type RobotTone = 'idle' | 'busy' | 'live' | 'attention' | 'done'

export interface RobotCard {
  n: number
  phase: DrawPhase
  /** "Filling tube 2 of 4". */
  phaseText: string
  tone: RobotTone
  /** How far through the whole draw, 0..100. */
  percent: number
  /** The synthetic patient and ticket at the robot, or null when it is free. */
  patient: string | null
  ticket: string | null
  /** A tick for a draw that went in on the first attempt, a note for a second try, nothing otherwise. */
  attempt: 'first' | 'second' | null
  attemptText: string | null
  light: DrawStationState['light']
}

export interface DrawView {
  /** "P023 to Robot 2", or null. */
  calling: { ticket: string; robot: number; text: string } | null
  waiting: { ids: string[]; more: number; moreText: string | null }
  robots: RobotCard[]
  /** "1 nurse · 3 robots". */
  staff: string
  stats: { draws: string; firstAttempt: string; manual: string; wait: string }
  prep: { phase: string; ticket: string | null; percent: number; labels: number; trays: string; busy: boolean }
  disclaimer: string
}

/** Where each phase sits in the whole draw, as percent (start, end): the phase's own progress fills the span. */
export const PHASE_SPAN: Record<DrawPhase, readonly [number, number]> = {
  idle: [0, 0],
  calling: [0, 0],
  cardScan: [0, 6],
  armIn: [6, 14],
  cuff: [14, 22],
  sanitise: [22, 30],
  veinScan: [30, 45],
  needleIn: [45, 55],
  filling: [55, 90],
  needleOut: [90, 94],
  bandage: [94, 98],
  release: [98, 100],
  awaitPorter: [100, 100],
  armMoved: [50, 50],
  fallbackToNurse: [50, 50],
  reset: [100, 100],
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0)

export function toneOf(phase: DrawPhase): RobotTone {
  switch (phase) {
    case 'idle':
    case 'calling':
    case 'reset':
      return 'idle'
    case 'veinScan':
    case 'needleIn':
    case 'filling':
    case 'needleOut':
      return 'live'
    case 'armMoved':
    case 'fallbackToNurse':
      return 'attention'
    case 'bandage':
    case 'release':
    case 'awaitPorter':
      return 'done'
    default:
      return 'busy'
  }
}

/** How far through the whole draw a station is, 0..100 (filling counts whole tubes). */
export function drawPercent(s: Pick<DrawStationState, 'phase' | 'progress' | 'tube' | 'tubeFill' | 'tubes'>): number {
  const [a, b] = PHASE_SPAN[s.phase]
  let k = clamp01(s.progress)
  if (s.phase === 'filling' && s.tubes.length > 0) k = clamp01((s.tube + clamp01(s.tubeFill)) / s.tubes.length)
  return Math.round(a + (b - a) * k)
}

function attemptOf(s: DrawStationState): RobotCard['attempt'] {
  if (s.ticket === null) return null
  if (s.attempts > 1) return 'second'
  const inserted = s.phase === 'filling' || s.phase === 'needleOut' || s.phase === 'bandage' || s.phase === 'release' || s.phase === 'awaitPorter'
  return s.attempts === 1 && inserted ? 'first' : null
}

function robotCard(s: DrawStationState, n: number): RobotCard {
  const attempt = attemptOf(s)
  return {
    n,
    phase: s.phase,
    phaseText: phaseText(s.phase, s.tube, s.tubes.length),
    tone: toneOf(s.phase),
    percent: drawPercent(s),
    patient: s.patientName,
    ticket: s.ticket,
    attempt,
    attemptText: attempt === 'first' ? DRAW_UI.panel.firstTick : attempt === 'second' ? DRAW_UI.panel.secondTry : null,
    light: s.light,
  }
}

const pct = (v: number | null): string => (v === null ? DRAW_UI.panel.noData : `${v}%`)

/** The panel's snapshot of the draw centre. */
export function drawView(blood: DrawSource): DrawView {
  const call = blood.calling
  const calling = call ? { ticket: call.id, robot: (call.station ?? 0) + 1, text: fillDraw(DRAW_UI.panel.callLine, { ticket: call.id, robot: (call.station ?? 0) + 1 }) } : null

  const waitingTickets = blood.queue.filter((t) => t.state === 'waiting')
  const shown = waitingTickets.slice(0, 8).map((t) => t.id)
  const more = waitingTickets.length - shown.length

  const robots = blood.stations.map((s, i) => robotCard(s, i + 1))
  const nurses = blood.nurseId === null ? 0 : 1
  const staff = nurses === 0 ? fillDraw(DRAW_UI.panel.staffNone, { robots: robots.length }) : fillDraw(DRAW_UI.panel.staff, { nurses, robots: robots.length })

  const st = blood.stats
  const robotDraws = Math.max(0, st.draws - st.nurseDraws)
  const first = robotDraws > 0 ? Math.round((100 * st.robotFirstPass) / robotDraws) : null
  const manual = st.draws > 0 ? Math.round((100 * st.nurseDraws) / st.draws) : null
  const wait = st.medianWaitMin === null ? DRAW_UI.panel.noData : `${Math.round(st.medianWaitMin)} ${DRAW_UI.panel.waitUnit}`

  const prep = blood.prep
  return {
    calling,
    waiting: { ids: shown, more: Math.max(0, more), moreText: more > 0 ? fillDraw(DRAW_UI.panel.moreWaiting, { count: more }) : null },
    robots,
    staff,
    stats: { draws: String(st.draws), firstAttempt: pct(first), manual: pct(manual), wait },
    prep: {
      phase: DRAW_UI.prepPhase[prep.phase],
      ticket: prep.ticket,
      percent: prep.phase === 'idle' ? 0 : Math.round(clamp01(prep.progress) * 100),
      labels: prep.traysToday,
      trays: fillDraw(DRAW_UI.panel.tray, { count: prep.rack.length }),
      busy: prep.phase !== 'idle',
    },
    disclaimer: DRAW_UI.disclaimer,
  }
}
