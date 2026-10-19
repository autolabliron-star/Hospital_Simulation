/**
 * The robotic OR panel's view model (R2): pure functions from the surgery state (what `sim.surgery.state` holds), the sim time and the theatre
 * team's whereabouts to plain strings, numbers and booleans. The panel (OrBody.tsx) polls it at 4 Hz through `usePoll`, never per frame; the node
 * tests run it on hand-made state. Every word comes from src/content/surgeryUi.json and src/content/surgery.json; the sim singleton is never
 * imported here. Everything shown is synthetic and display-only: the panel never decides anything, it reads.
 *
 * The shared helpers at the top (minutes, the HH:MM clock, the case of a bay) are also used by the recovery and pre-op panels (pacuView.ts,
 * preOpView.ts).
 */
import { SURGERY_COPY } from '@/content/surgery'
import { fillSurgery, SURGERY_UI } from '@/content/surgeryUi'
import { THEATRE_STAFF } from '@/content/staff'
import { clockText } from '@/sim/events'
import { areaById, type Rect } from '@/sim/places'
import type { CasePhase, RobotArmState, SurgeryBayState, SurgeryCaseView, SurgeryState } from '@/sim/types'

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** Shown where a value is not known yet (no reading, no instrument, no patient). */
export const NO_VALUE = '–'

/** "12 min" for a number of minutes. */
export function minutesText(n: number): string {
  return fillSurgery(SURGERY_UI.panel.kpiValue.minutes, { n: Math.round(n) })
}

/** "40%" for a share 0..1. */
export function percentText(share01: number): string {
  return fillSurgery(SURGERY_UI.panel.kpiValue.percent, { n: Math.round(Math.max(0, Math.min(1, share01)) * 100) })
}

/** Whole minutes between two sim times (never negative). */
export function minutesSince(from: number, now: number): number {
  return Math.max(0, Math.floor((now - from) / 60))
}

/** The case of a bay: by the patient in it, or by the bay seat the case says it is in. Null for an empty bay or a patient not on the list. */
export function caseOfBay(cases: readonly SurgeryCaseView[], bay: SurgeryBayState): SurgeryCaseView | null {
  if (bay.patientId === null) return null
  return cases.find((c) => c.patientId === bay.patientId) ?? cases.find((c) => c.bay === bay.seatId) ?? null
}

/** The bays of one kind, in order. */
export function baysOf(state: SurgeryState, kind: SurgeryBayState['kind']): SurgeryBayState[] {
  return state.bays.filter((b) => b.kind === kind)
}

// ---------------------------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------------------------

/** The phases a case goes through in the room, in order (the timeline). */
export const TIMELINE_PHASES = ['in', 'induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence', 'out'] as const satisfies readonly CasePhase[]

/** Phases before the room (a case in one of these has not reached the timeline) and after it. */
const BEFORE_ROOM: ReadonlySet<CasePhase> = new Set<CasePhase>(['scheduled', 'arrived', 'preOp', 'toTheatre'])

/** From the wheels out of the OR on: where the patient goes next is known. */
const OUTCOME_KNOWN: ReadonlySet<CasePhase> = new Set<CasePhase>(['out', 'pacu', 'phase2', 'leaving', 'done'])

export type StepState = 'done' | 'current' | 'upcoming'

export interface CaseRow {
  id: string
  patient: string
  /** The procedure's full name. */
  procedure: string
  /** Planned wheels-in as a 24-hour clock ("08:30"). */
  time: string
  /** The case's phase label ("Console time", "Scheduled"). */
  phase: string
  /** This is the case in the room. */
  current: boolean
  /** "Day case: home today" or "To the surgical ward upstairs", once the patient is out of the OR; null before. */
  outcome: string | null
}

export interface TimelineStep {
  phase: string
  label: string
  state: StepState
}

export interface CurrentCase {
  patient: string
  procedure: string
  /** The current in-room phase's label, and the time left in it ("12 min") while the theatre has an end for it; null otherwise. */
  phase: string
  timeLeft: string | null
  steps: TimelineStep[]
}

export interface ArmRow {
  index: number
  /** "Arm 1" .. "Arm 4". */
  label: string
  /** The fitted instrument, or "–". */
  instrument: string
  /** Arm index 1 holds the endoscope. */
  endoscope: boolean
  /** How far it has swung onto its port: "45%", and 0..100 for a bar. */
  engage: string
  engagePct: number
  /** Force feedback as 0..100 for a bar. */
  forcePct: number
  /** The sterile drape is on. */
  drape: boolean
}

/** One of the theatre team, as the panel reads it: `inOr` says whether they are inside the OR rectangle right now. */
export interface TeamInput {
  id: string
  name: string
  /** The staff post in the OR (a key of THEATRE_STAFF's `title`). */
  title: string
  inOr: boolean
}

export interface KpiRow {
  id: 'firstOnTime' | 'docking' | 'console' | 'turnover' | 'recovery' | 'utilisation'
  label: string
  value: string
}

export interface OrView {
  /** "Simulated", the longer note, and the room's name. */
  tag: string
  note: string
  room: string
  cases: CaseRow[]
  /** The case in the room, or null (the panel then says the theatre is free). */
  current: CurrentCase | null
  robot: { phase: string; arms: ArmRow[] }
  team: TeamInput[]
  kpis: KpiRow[]
}

function caseRow(c: SurgeryCaseView, inRoomId: string | null): CaseRow {
  return {
    id: c.id,
    patient: c.name,
    procedure: SURGERY_COPY.procedures[c.procedure].name,
    time: clockText(c.plannedIn),
    phase: SURGERY_COPY.phases[c.phase],
    current: c.id === inRoomId,
    outcome: OUTCOME_KNOWN.has(c.phase) ? SURGERY_COPY.outcomes[c.outcome] : null,
  }
}

/** The in-room timeline of a case: the steps before its phase are done, its own is current, the rest are upcoming (a case not yet in the room: all upcoming; out of it: all done). */
export function timelineSteps(phase: CasePhase): TimelineStep[] {
  const at = TIMELINE_PHASES.indexOf(phase as (typeof TIMELINE_PHASES)[number])
  const cursor = at >= 0 ? at : BEFORE_ROOM.has(phase) ? -1 : TIMELINE_PHASES.length
  return TIMELINE_PHASES.map((p, i) => ({ phase: p, label: SURGERY_COPY.phases[p], state: i < cursor ? 'done' : i === cursor ? 'current' : 'upcoming' }))
}

function currentCase(state: SurgeryState, t: number): CurrentCase | null {
  const th = state.theatre
  const c = th.caseId === null ? undefined : th.cases.find((x) => x.id === th.caseId)
  if (!c) return null
  const steps = timelineSteps(c.phase)
  const inRoom = steps.some((s) => s.state === 'current')
  return {
    patient: c.name,
    procedure: SURGERY_COPY.procedures[c.procedure].name,
    phase: SURGERY_COPY.phases[c.phase],
    timeLeft: inRoom && th.phaseEnds !== null ? minutesText(Math.max(0, Math.ceil((th.phaseEnds - t) / 60))) : null,
    steps,
  }
}

function clamp01(x: number): number {
  return x > 0 ? (x < 1 ? x : 1) : 0
}

function armRow(a: RobotArmState): ArmRow {
  return {
    index: a.index,
    label: fillSurgery(SURGERY_UI.console.arm, { arm: a.index + 1 }),
    instrument: a.instrument === '' ? NO_VALUE : a.instrument,
    endoscope: a.index === 1,
    engage: percentText(a.engage),
    engagePct: Math.round(clamp01(a.engage) * 100),
    forcePct: Math.round(clamp01(a.force) * 100),
    drape: a.drape > 0.5,
  }
}

function kpiRows(state: SurgeryState): KpiRow[] {
  const k = state.theatre.kpis
  const min = (v: number | null): string => (v === null ? NO_VALUE : minutesText(v))
  const first = k.firstCaseOnTime === null ? SURGERY_UI.panel.kpiValue.notYet : k.firstCaseOnTime ? SURGERY_UI.panel.kpiValue.yes : SURGERY_UI.panel.kpiValue.no
  return [
    { id: 'firstOnTime', label: SURGERY_UI.panel.kpi.firstOnTime, value: first },
    { id: 'docking', label: SURGERY_UI.panel.kpi.docking, value: min(k.dockingMin) },
    { id: 'console', label: SURGERY_UI.panel.kpi.console, value: min(k.consoleMin) },
    { id: 'turnover', label: SURGERY_UI.panel.kpi.turnover, value: min(k.turnoverMin) },
    { id: 'recovery', label: SURGERY_UI.panel.kpi.recovery, value: min(k.pacuMin) },
    { id: 'utilisation', label: SURGERY_UI.panel.kpi.utilisation, value: k.utilisation === null ? NO_VALUE : percentText(k.utilisation) },
  ]
}

/** The OR's rectangle (sim coordinates, level 2). */
export const OR_RECT: Rect = areaById('l2Or').rect

export function insideRect(x: number, z: number, r: Rect): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1
}

/** What the team reading needs of a person (the sim's `Entity` satisfies it). */
export interface PersonAt {
  position: { x: number; z: number }
}

/** The nine theatre staff with whether each is inside the OR now. A person who is not in the hospital (before the shift, after it) is outside. */
export function teamOf(people: ReadonlyMap<string, PersonAt>, rect: Rect = OR_RECT): TeamInput[] {
  return THEATRE_STAFF.map((m) => {
    const p = people.get(m.id)
    return { id: m.id, name: m.name, title: m.title, inOr: p !== undefined && insideRect(p.position.x, p.position.z, rect) }
  })
}

/** The whole view. `t` is sim seconds (the panel passes `sim.t`); `team` is `teamOf(sim.entities)`. */
export function orView(state: SurgeryState, t: number, team: readonly TeamInput[]): OrView {
  const inRoomId = state.theatre.caseId
  return {
    tag: SURGERY_UI.panel.tag,
    note: SURGERY_UI.panel.note,
    room: SURGERY_UI.panel.room,
    cases: state.theatre.cases.map((c) => caseRow(c, inRoomId)),
    current: currentCase(state, t),
    robot: { phase: SURGERY_COPY.robotPhases[state.robot.phase], arms: state.robot.arms.map(armRow) },
    team: team.map((m) => ({ id: m.id, name: m.name, title: m.title, inOr: m.inOr })),
    kpis: kpiRows(state),
  }
}
