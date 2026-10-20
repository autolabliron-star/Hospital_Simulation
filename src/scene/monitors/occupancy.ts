/**
 * R3 live patient monitors: who is on each monitor, read from the running sim through a narrow source (the tests pass a fake one).
 *
 *   OR        the patient on the table from wheels-in to wheels-out (`theatre.caseId`, the case's phase), with the robot's docking for the CO2
 *   PACU      the patient in recovery bay i (`surgery.bays`, kind 'pacu', seat surgeryBed:pacu:<i>); the central station's rows are the same bays
 *   pre-op    the patient in pre-op bay i (kind 'preOp')
 *   ER        the case holding ER bay i while lying on its trolley (not while wheeled away for tests)
 *   triage    the case being assessed at triage bay i (a spot check: connected only while the nurse assesses)
 *
 * Read-only: nothing here changes the sim. Pure apart from reading the source.
 */
import type { CasePhase, SurgeryState } from '@/sim/types'
import type { MonitorContext, Situation } from './vitals'

/** The part of an ER case the monitors read (src/sim/er/department.ts `ErCase` satisfies it). */
export interface ErCaseView {
  id: string
  name: string
  reason: string
  acuity: number
  state: string
  bay: number
  triageBay: number
  onTrolley: boolean
  trolleyAt: number
}

/** The part of the ER department the monitors read (`ErDepartment` satisfies it). */
export interface ErView {
  readonly bays: readonly { readonly seat: { readonly id: string }; readonly caseId: string | null }[]
  readonly triageBays: readonly { readonly seat: { readonly id: string }; readonly caseId: string | null }[]
  readonly cases: ReadonlyMap<string, ErCaseView>
}

export interface OccupancySource {
  surgery(): SurgeryState | null
  er(): ErView | null
}

/** Who is on a monitor row (filled in place). */
export interface Occupant {
  /** The patient's entity id (the key of their beats and of their kiosk profile), or the case id when they have no entity yet. */
  id: string
  name: string
  /** The ER reason (the profile's panel shifts), '' elsewhere. */
  reason: string
  context: MonitorContext
  /** Sim time they came onto this monitor, or NaN when the source does not know (the hub uses the time it first saw them). */
  since: number
  acuity: number
  phase: CasePhase | null
  procedure: Situation['procedure']
  dockedAt: number | null
  insufflationEnd: number | null
}

export function newOccupant(): Occupant {
  return { id: '', name: '', reason: '', context: 'er', since: NaN, acuity: 3, phase: null, procedure: null, dockedAt: null, insufflationEnd: null }
}

/** The theatre phases the patient lies on the table, connected to the anaesthesia monitor. */
export const ON_TABLE: ReadonlySet<CasePhase> = new Set<CasePhase>(['in', 'induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence', 'out'])

/** ER states in which the patient is away from the bay (wheeled to the lab and back): the monitor is disconnected. */
const AWAY: ReadonlySet<string> = new Set(['tests.toLab', 'tests.testing', 'tests.waitingReturn', 'tests.returning'])

function clear(o: Occupant, context: MonitorContext): void {
  o.reason = ''
  o.context = context
  o.since = NaN
  o.acuity = 3
  o.phase = null
  o.procedure = null
  o.dockedAt = null
  o.insufflationEnd = null
}

/** The OR table's occupant, or false. */
function orOccupant(s: SurgeryState, out: Occupant): boolean {
  const id = s.theatre.caseId
  if (id === null || s.theatre.phase === 'idle' || s.theatre.phase === 'turnover' || !ON_TABLE.has(s.theatre.phase)) return false
  const k = s.theatre.cases.find((c) => c.id === id)
  if (!k) return false
  clear(out, 'or')
  out.id = k.patientId ?? k.id
  out.name = k.name
  out.since = k.wheelsIn ?? NaN
  out.phase = s.theatre.phase
  out.procedure = k.procedure
  out.dockedAt = k.dockedAt
  out.insufflationEnd = k.consoleEnd
  return true
}

function bayOccupant(s: SurgeryState, seatId: string, kind: 'pacu' | 'preOp', out: Occupant): boolean {
  const bay = s.bays.find((b) => b.seatId === seatId && b.kind === kind)
  if (!bay || bay.patientId === null) return false
  const k = s.theatre.cases.find((c) => c.patientId === bay.patientId)
  clear(out, kind === 'pacu' ? 'pacu' : 'preop')
  out.id = bay.patientId
  out.name = k?.name ?? ''
  out.since = bay.since
  out.procedure = k?.procedure ?? null
  return true
}

function erOccupant(er: ErView, seatId: string, out: Occupant): boolean {
  const bay = er.bays.find((b) => b.seat.id === seatId)
  if (!bay || bay.caseId === null) return false
  const c = er.cases.get(bay.caseId)
  if (!c || !c.onTrolley || AWAY.has(c.state)) return false
  clear(out, 'er')
  out.id = c.id
  out.name = c.name
  out.reason = c.reason
  out.since = c.trolleyAt
  out.acuity = c.acuity
  return true
}

function triageOccupant(er: ErView, seatId: string, out: Occupant): boolean {
  const bay = er.triageBays.find((b) => b.seat.id === seatId)
  if (!bay || bay.caseId === null) return false
  const c = er.cases.get(bay.caseId)
  if (!c || c.state !== 'triage.assessing') return false
  clear(out, 'triage')
  out.id = c.id
  out.name = c.name
  out.reason = c.reason
  out.acuity = c.acuity
  return true
}

/** Fill `out` with whoever is on the monitor row watching `seatId` (a monitor of `context`); false when nobody is. */
export function occupantOf(src: OccupancySource, context: MonitorContext, seatId: string, out: Occupant): boolean {
  switch (context) {
    case 'or': {
      const s = src.surgery()
      return s !== null && orOccupant(s, out)
    }
    case 'pacu':
    case 'preop': {
      const s = src.surgery()
      return s !== null && bayOccupant(s, seatId, context === 'pacu' ? 'pacu' : 'preOp', out)
    }
    case 'er': {
      const er = src.er()
      return er !== null && erOccupant(er, seatId, out)
    }
    case 'triage': {
      const er = src.er()
      return er !== null && triageOccupant(er, seatId, out)
    }
  }
}
