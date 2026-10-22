/**
 * The patient record behind the bedside tablet's "Record" tab: who the patient in front of you is, their past (history.ts), and everything that
 * happened since they arrived, newest first, plus what is current (problems, medicines with their next dose, pending results, today's plan).
 *
 * A READ-ONLY adapter: it reads the sim's own structures (the bed board, the orders and the pharmacist's queries, the lab orders, the imaging
 * exams and bookings, the kiosk and triage readings, the doctors' visits, the event log through chartIndex.ts) and never writes any of them, never
 * draws from a sim stream and never calls a method that changes state. What the sim does not model (the days of the stay before the sim started,
 * the ward observation rounds) is drawn from the stay template (src/content/patientHistory.json) with an Rng seeded by the patient, so the same
 * seed always gives the same record. The record is built only while the tablet shows it, at the tablet's 4 Hz poll (src/ui/rx/record).
 *
 * Times are "abs" seconds: since 00:00 of the demo's day 0 (sim t = 0 is 07:30 of day 0), so the days before the sim are negative days.
 */
import { doseHoursOf, isPrn, medicineById, PATIENTS } from '@/content/catalogue'
import { LAB_CATALOGUE, testById } from '@/content/lab'
import { recordText, stayTemplateFor, uiText, PATIENT_HISTORY, type StayTemplate } from '@/content/patientHistory'
import { HOSTS, NIGHT_STAFF, STAFF, staffName } from '@/content/staff'
import { CONFIG } from '../config'
import { Doctor } from '../people'
import { ROOMS, roomById } from '../places'
import type { Rng } from '../rng'
import type { Simulation } from '../Simulation'
import type { BedState, Order, SimEvent, SimEventType, WardId } from '../types'
import { profileFor } from '../vitals/model'
import { noteEvents, type ChartIndex } from './chartIndex'
import { blockedMeds, isChronicMed, patientHistory, recordRng, type PatientHistory, type RecordSubject } from './history'
import { obsOfReading, wardObs, type Baseline, type ObsSet } from './obs'

const DAY = 86400
const HOUR = 3600

/** The sim's clock as abs seconds (sim t = 0 is CONFIG.sim.startHour of day 0). */
export function absOf(t: number): number {
  return CONFIG.sim.startHour * HOUR + t
}

export type EntryKind = 'movement' | 'med' | 'obs' | 'result' | 'imaging' | 'note'
export const ENTRY_KINDS: readonly EntryKind[] = ['med', 'obs', 'result', 'imaging', 'note', 'movement'] as const

export type EntryFlag = 'allergy' | 'held' | 'review' | 'pending' | 'outside' | null

/** One line of the stay's timeline. */
export interface RecordEntry {
  at: number
  kind: EntryKind
  text: string
  /** Who did it, as the event line names them ("Nurse Maya"), or null. */
  by: string | null
  flag: EntryFlag
  /** The observation set of an obs entry. */
  obs?: ObsSet
}

export type SubjectKind = 'ward' | 'er' | 'surgery' | 'outpatient'

/** The patient the record is about, and where they are. */
export interface SubjectInfo extends RecordSubject {
  kind: SubjectKind
  roomId: string | null
  ward: WardId | null
  /** Day of stay (1 on the day of admission). */
  dayOfStay: number
}

/** A medicine on the current list. */
export interface ActiveMed {
  medId: string
  name: string
  strength: string
  /** 'regular' on the ward chart, 'prn' as needed, 'oneOff' a single order (yours, from the tablet). */
  status: 'regular' | 'prn' | 'oneOff'
  /** When it is next given: due now (a dose waiting, `at` its due time), next at `at`, held by a pharmacist query, or as needed (`at` the last dose). */
  next: { kind: 'due' | 'next' | 'held' | 'prn'; at: number | null }
  /** Started in this stay (not one of the home medicines). */
  newThisStay: boolean
}

export type RecordAlert =
  | { kind: 'allergy'; index: number }
  | { kind: 'falls'; level: 'high' | 'moderate' }
  | { kind: 'anticoagulant'; medId: string }
  | { kind: 'isolation'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'query'; meds: string; allergy: boolean }

export interface PatientRecordData {
  subject: SubjectInfo
  history: PatientHistory
  stay: StayTemplate
  /** abs seconds now, and when the sim's own data starts (the start of the sim). */
  now: number
  simStart: number
  arrivedAt: number
  /** When they reached their ward bed (null: not on a ward). */
  wardAt: number | null
  team: string
  doctor: string
  weightKg: number | null
  heightCm: number | null
  bed: BedState | null
  alerts: RecordAlert[]
  /** Newest first. */
  entries: RecordEntry[]
  /** Every observation set, oldest first. */
  obs: ObsSet[]
  problems: string[]
  meds: ActiveMed[]
  pending: string[]
  plan: string[]
  /** Earlier events were dropped from the log before the record could read them. */
  gap: boolean
}

// ---------------------------------------------------------------------------------------------
// Who is it
// ---------------------------------------------------------------------------------------------

const PLAN_BY_ID = new Map(PATIENTS.map((p) => [p.id, p]))

/** The ward record of the patient lying in a room (also while they get up to leave), as a subject; null for an empty or reserved bed. */
export function subjectInRoom(sim: Simulation, roomId: string): SubjectInfo | null {
  const room = sim.life.rooms.get(roomId)
  if (!room || room.patientId === null) return null
  let ward: WardId
  try {
    ward = roomById(roomId).ward
  } catch {
    return null
  }
  const rec = sim.beds.board.get(roomId)
  const record = rec.person !== null ? rec.record : null
  if (record && record.id === room.patientId) {
    return {
      id: record.id,
      name: record.name,
      age: record.age,
      reason: record.reason,
      usualMeds: record.usualMeds,
      variant: rec.person?.entity.variant,
      kind: 'ward',
      roomId,
      ward,
      dayOfStay: record.dayOfStay,
    }
  }
  return null
}

/** Any patient by entity id: in a ward bed, in the ER, on the surgery list, or an imaging outpatient. Null for somebody who is not a patient. */
export function subjectById(sim: Simulation, id: string): SubjectInfo | null {
  for (const [roomId, room] of sim.life.rooms) if (room.patientId === id) {
    const s = subjectInRoom(sim, roomId)
    if (s) return s
  }
  const er = sim.world.patients.get(id)
  if (er) return { id, name: er.entity.name, age: er.age, reason: er.c.reason, usualMeds: [], variant: er.entity.variant, kind: 'er', roomId: null, ward: null, dayOfStay: 1 }
  const sx = sim.surgery.state.theatre.cases.find((c) => c.patientId === id)
  if (sx) {
    const reason = recordText('surgeryReason', { procedure: sx.procedure })
    return { id, name: sx.name, age: drawnAge({ id, name: sx.name }), reason, usualMeds: [], kind: 'surgery', roomId: null, ward: null, dayOfStay: 1 }
  }
  const op = sim.imaging.outpatients.find((o) => o.entity.id === id)
  if (op) {
    const name = op.entity.name
    return { id, name, age: drawnAge({ id, name }), reason: recordText('outpatientReason', { protocol: op.booking.protocolName }), usualMeds: [], kind: 'outpatient', roomId: null, ward: null, dayOfStay: 1 }
  }
  return null
}

/** An age for a patient the sim has none for (a surgery case, an outpatient): 30 to 79, from their record's stream. */
function drawnAge(s: { id: string; name: string }): number {
  return recordRng(s).fork('age').int(30, 79)
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const medLabel = (id: string): string => {
  const m = medicineById(id)
  return `${m.name} ${m.strength}`
}
const medList = (ids: readonly string[]): string => ids.map(medLabel).join(', ')
const hhmm = (abs: number): string => {
  const m = Math.floor((((abs % DAY) + DAY) % DAY) / 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const dayOf = (abs: number): number => Math.floor(abs / DAY)
const wardDoctor = (ward: WardId | null): string => STAFF.find((s) => s.role === 'doctor' && s.ward === ward)?.name ?? staffName('doc-N')
const dayNurses = (ward: WardId | null): string[] => STAFF.filter((s) => s.role === 'nurse' && s.ward === ward).map((s) => s.name)
const nightNurse = (ward: WardId | null): string => NIGHT_STAFF.find((s) => s.role === 'nurse' && s.ward === ward)?.name ?? recordText('roleNight')
const ALL_STAFF = new Map([...STAFF, ...NIGHT_STAFF, ...HOSTS].map((s) => [s.id, s]))
const fill = (s: string, reason: string): string => s.replace('{reason}', reason)

/** The kind of a sim event in the timeline, or null for one the record leaves out (the pods' and robots' own trail). */
const KIND_OF: Partial<Record<SimEventType, EntryKind>> = {
  patientArrived: 'movement',
  checkedIn: 'movement',
  admitted: 'movement',
  discharged: 'movement',
  leftWithoutBeingSeen: 'movement',
  porterJob: 'movement',
  outpatientArrived: 'movement',
  bedAssigned: 'movement',
  patientBoarding: 'movement',
  admittedToWard: 'movement',
  wentHome: 'movement',
  surgeryArrived: 'movement',
  preOpReady: 'movement',
  theatreIn: 'movement',
  theatreOut: 'movement',
  pacuOut: 'movement',
  triaged: 'obs',
  seenByDoctor: 'note',
  testsOrdered: 'note',
  dischargeSigned: 'note',
  talkedTo: 'note',
  consoleStart: 'note',
  robotUndocked: 'note',
  resultsBack: 'result',
  scanDone: 'imaging',
  reportReady: 'imaging',
}

// ---------------------------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------------------------

interface Ctx {
  sim: Simulation
  s: SubjectInfo
  h: PatientHistory
  stay: StayTemplate
  rng: Rng
  now: number
  simStart: number
  idx: ChartIndex
  out: RecordEntry[]
  /** The days (dayOf) on which the patient was seen on a ward round. */
  roundDays: Set<number>
  /** The order entries were written in (at the same time, the later one is newer: the query after the order). */
  order: Map<RecordEntry, number>
}

function push(c: Ctx, at: number, kind: EntryKind, text: string, by: string | null = null, flag: EntryFlag = null, obs?: ObsSet): void {
  if (at > c.now) return
  const e: RecordEntry = obs ? { at, kind, text, by, flag, obs } : { at, kind, text, by, flag }
  c.order.set(e, c.out.length)
  c.out.push(e)
}

function baselineOf(sim: Simulation, s: SubjectInfo, rng: Rng): Baseline {
  const p = sim.vitals.profileIfDrawn(s.id) ?? profileFor(s.id, s.name, { age: s.age, variant: s.variant }, rng.fork('body'))
  return { sys: p.sys, dia: p.dia, pulse: p.pulse, spo2: p.spo2, tempC: p.tempC, rr: 14 + rng.fork('rr').int(0, 4) }
}

/** When the patient arrived and when they reached the ward bed (abs), and whether the sim saw the arrival itself. */
function arrivalOf(c: Ctx): { arrivedAt: number; wardAt: number | null; live: boolean } {
  const { sim, s, rng, simStart } = c
  const subjectEvents = c.idx.bySubject.get(s.id) ?? []
  const firstEvent = subjectEvents.find((e) => e.type === 'patientArrived' || e.type === 'surgeryArrived' || e.type === 'outpatientArrived')
  if (s.kind === 'ward') {
    const delivered = sim.beds.board.log.delivered.find((d) => d.patientId === s.id && d.roomId === s.roomId)
    if (delivered) {
      // admitted from the ER while the sim ran
      const wardAt = absOf(delivered.t)
      return { arrivedAt: firstEvent ? absOf(firstEvent.t) : wardAt - 3 * HOUR, wardAt, live: true }
    }
    const arng = rng.fork('arrival')
    if (PLAN_BY_ID.has(s.id) || s.dayOfStay > 1) {
      // a catalogue inpatient: admitted dayOfStay - 1 days before day 0 (independent of the start hour)
      const day = -(s.dayOfStay - 1)
      const elective = c.stay.route === 'elective'
      const arrive =
        s.dayOfStay === 1
          ? day * DAY + arng.range(0.5, 3) * HOUR
          : day * DAY + (elective ? arng.range(6.75, 7.5) : arng.range(9, 21)) * HOUR
      const toWard = arrive + (elective ? arng.range(0.5, 1) : arng.range(3, 4)) * HOUR
      return { arrivedAt: arrive, wardAt: toWard, live: false }
    }
    // admitted earlier today, before the sim started (a warm start): the bed has been theirs since `stageSince`
    const rec = sim.beds.board.get(s.roomId!)
    const wardAt = Math.min(absOf(rec.stageSince), simStart - 600)
    return { arrivedAt: wardAt - arng.range(2.5, 4) * HOUR, wardAt, live: false }
  }
  if (s.kind === 'er') {
    const p = sim.world.patients.get(s.id)
    return { arrivedAt: absOf(p ? p.c.arrivedAt : firstEvent?.t ?? sim.t), wardAt: null, live: true }
  }
  if (s.kind === 'surgery') {
    const cs = sim.surgery.state.theatre.cases.find((x) => x.patientId === s.id)
    return { arrivedAt: firstEvent ? absOf(firstEvent.t) : absOf((cs?.plannedIn ?? sim.t) - 1.5 * HOUR), wardAt: null, live: true }
  }
  const op = sim.imaging.outpatients.find((o) => o.entity.id === s.id)
  return { arrivedAt: firstEvent ? absOf(firstEvent.t) : absOf(op?.booking.apptAt ?? sim.t), wardAt: null, live: true }
}

/** The medicines on the ward chart that were added on today's round (they were not on the chart in the days before). */
function addedToday(c: Ctx): Set<string> {
  const out = new Set<string>()
  if (PLAN_BY_ID.has(c.s.id)) return out
  for (const o of c.sim.meds.orders.values()) if (o.patientId === c.s.id && o.source === 'sim') for (const i of o.items) out.add(i.medId)
  return out
}

/** The days of the stay before the sim started, drawn from the stay template (only for a patient who arrived before it). */
function synthStay(c: Ctx, arrivedAt: number, wardAt: number | null, base: Baseline): void {
  const { s, stay, simStart, rng } = c
  const until = Math.min(simStart, c.now)
  const reason = s.reason.toLowerCase()
  const R = PATIENT_HISTORY.routes
  push(c, arrivedAt, 'movement', R[stay.route].replace('{arrival}', fill(stay.arrival, reason)))
  const admObs = (at: number) => wardObs(base, stay, 0, at, rng.fork(`obs:${Math.round(at)}`), 'triage')
  if (stay.triage !== null) {
    const at = arrivedAt + 10 * 60
    if (at < until) push(c, at, 'obs', recordText('triaged', { n: stay.triage, label: PATIENT_HISTORY.triageLabels[stay.triage] }), recordText('roleTriage'), null, admObs(at))
  }
  const seenAt = arrivedAt + 35 * 60
  if (seenAt < until && stay.route !== 'elective') {
    const t = stay.route === 'clinic' ? recordText('seenClinic', { diagnosis: fill(stay.diagnosis, s.reason) }) : recordText('seenEr', { diagnosis: fill(stay.diagnosis, s.reason) })
    push(c, seenAt, 'note', t, stay.route === 'clinic' ? null : recordText('roleErDoctor'))
  }
  // the tests of the stay, on their day
  const day0 = dayOf(arrivedAt)
  stay.tests.forEach((test, i) => {
    const d = test.day ?? 1
    const at = d === 1 ? arrivedAt + (60 + 25 * i) * 60 : (day0 + d - 1) * DAY + (9 + 0.75 * i) * HOUR
    if (at >= until) return
    const kind = test.kind === 'imaging' ? 'imaging' : 'result'
    push(c, at, kind, recordText('testDone', { name: test.name, summary: test.summary }), null, test.review ? 'review' : null)
  })
  if (wardAt !== null && s.ward !== null && s.roomId !== null) {
    const decideAt = wardAt - 40 * 60
    if (decideAt < until && decideAt > arrivedAt) {
      push(c, decideAt, 'note', stay.route === 'elective' ? recordText('electiveAdmit', { team: stay.team }) : recordText('admitDecision', { team: stay.team }), stay.route === 'elective' ? null : recordText('roleErDoctor'))
    }
    if (wardAt < until) push(c, wardAt, 'movement', recordText('toWard', { ward: s.ward, room: s.roomId }))
    // the operation of the stay
    let acuteFrom = wardAt + 20 * 60
    let opAt: number | null = null
    if (stay.procedure) {
      const opDay = day0 + stay.procedure.day - 1
      const name = fill(stay.procedure.name, s.reason)
      const toTheatre = Math.max(opDay * DAY + 9 * HOUR, wardAt + 30 * 60)
      opAt = toTheatre
      // a planned operation: the stay's medicines start afterwards (an emergency admission has them from arrival on the ward)
      if (stay.route === 'elective') acuteFrom = toTheatre + 4 * HOUR + 15 * 60
      if (toTheatre < until) push(c, toTheatre, 'movement', recordText('toTheatre', { name }))
      if (toTheatre + 1.5 * HOUR < until) push(c, toTheatre + 1.5 * HOUR, 'note', recordText('operation', { name, note: stay.procedure.note }), recordText('roleTheatre'))
      if (toTheatre + 4 * HOUR < until) push(c, toTheatre + 4 * HOUR, 'movement', recordText('backOnWard'))
    }
    // medicines charted on arrival on the ward (after the operation for a surgical stay), and the pharmacist's reconciliation the next morning
    const added = addedToday(c)
    const chart = s.usualMeds.filter((m) => !added.has(m))
    const acute = chart.filter((m) => !isChronicMed(m))
    const continued = c.h.homeMeds.filter((h) => h.onChart).map((h) => h.medId)
    if (acute.length > 0 && acuteFrom < until) push(c, acuteFrom, 'med', recordText('charted', { meds: medList(acute) }), wardDoctor(s.ward))
    if (continued.length > 0 && wardAt + 21 * 60 < until) push(c, wardAt + 21 * 60, 'med', recordText('homeContinued', { meds: medList(continued) }), wardDoctor(s.ward))
    const medRecAt = (dayOf(wardAt) + 1) * DAY + 10.5 * HOUR
    if (medRecAt < until && c.h.homeMeds.length > 0) {
      const gap = c.h.homeMeds.filter((h) => !h.onChart).map((h) => h.medId)
      push(c, medRecAt, 'med', recordText('medRec', { n: c.h.homeMeds.length }), staffName(`pharm-${s.ward}`))
      if (gap.length > 0) push(c, medRecAt + 60, 'med', recordText('medRecGap', { meds: medList(gap) }), staffName(`pharm-${s.ward}`), 'review')
    }
    // every day on the ward: the morning handover, the round, the dose rounds
    const doctor = wardDoctor(s.ward)
    const roomIndex = ROOMS.filter((r) => r.ward === s.ward).findIndex((r) => r.id === s.roomId)
    const nurses = dayNurses(s.ward)
    const liveRoundDays = new Set<number>()
    for (const v of doctorVisits(c)) if (v.kind === 'round') liveRoundDays.add(dayOf(absOf(v.t)))
    let rounds = 0
    for (let d = dayOf(wardAt); d <= dayOf(until); d++) {
      const handoverAt = d * DAY + CONFIG.sim.startHour * HOUR
      if (handoverAt > wardAt && handoverAt < until) push(c, handoverAt, 'note', recordText('handover', { note: recordText('handoverNote') }), nightNurse(s.ward))
      let roundAt = d * DAY + (CONFIG.people.round.startHour * HOUR) + Math.max(0, roomIndex) * 9 * 60
      // on the day of the operation the doctor sees the patient before they go to theatre, not while they are in it
      if (opAt !== null && roundAt >= opAt - 30 * 60 && roundAt < opAt + 4 * HOUR) roundAt = opAt - 30 * 60
      if (roundAt > wardAt && roundAt < until && !liveRoundDays.has(d)) {
        c.roundDays.add(d)
        // the first round is the post-take review; before the operation it is the pre-operative check; then the stay's own note
        const note =
          opAt !== null && roundAt < opAt
            ? recordText('roundPreOp')
            : rounds === 0 && opAt === null
              ? recordText('roundFirst', { diagnosis: fill(stay.diagnosis, s.reason) })
              : stay.round
        rounds++
        push(c, roundAt, 'note', `${recordText('round', { doctor, note })} ${recordText('roundPlan', { plan: stay.plan.join('; ') })}`, doctor)
      }
      for (const h of CONFIG.doseWaves.hours) {
        const at = d * DAY + h * HOUR
        if (at <= wardAt + 30 * 60 || at >= until) continue
        const due = chart.filter((m) => !isPrn(m) && doseHoursOf(m).includes(h) && (isChronicMed(m) || at >= acuteFrom))
        if (due.length === 0) continue
        const night = h < CONFIG.sim.startHour || h >= CONFIG.sim.startHour + 12
        const by = night ? nightNurse(s.ward) : nurses[(d + Math.round(h)) % Math.max(1, nurses.length)] ?? null
        push(c, at, 'med', recordText('doseRound', { time: hhmm(at), meds: medList(due) }), by)
      }
    }
  }
}

/** The doctors' visits to this patient while the sim ran. */
function doctorVisits(c: Ctx): { t: number; kind: string; doctor: string }[] {
  const out: { t: number; kind: string; doctor: string }[] = []
  for (const p of c.sim.people) {
    if (!(p instanceof Doctor)) continue
    for (const v of p.visits) if (v.patientId === c.s.id) out.push({ t: v.t, kind: v.kind, doctor: p.entity.name })
  }
  return out
}

/** The ward observation rounds after arrival on the ward, up to now (06:00, 14:00, 22:00). */
function wardObsRounds(c: Ctx, arrivedAt: number, wardAt: number, base: Baseline, obs: ObsSet[]): void {
  for (let d = dayOf(wardAt); d <= dayOf(c.now); d++) {
    for (const h of [6, 14, 22]) {
      const at = d * DAY + h * HOUR
      if (at <= wardAt + 20 * 60 || at > c.now) continue
      const o = wardObs(base, c.stay, (at - arrivedAt) / HOUR, at, c.rng.fork(`obs:${at}`))
      obs.push(o)
      const night = h < CONFIG.sim.startHour || h >= CONFIG.sim.startHour + 12
      push(c, at, 'obs', recordText('obsRound'), night ? nightNurse(c.s.ward) : (dayNurses(c.s.ward)[d & 1] ?? null), null, o)
    }
  }
}

function sourceWord(o: Order): string {
  return o.source === 'presenter' ? uiText('sourcePresenter') : o.source === 'discharge' ? uiText('sourceDischarge') : o.source === 'schedule' ? uiText('sourceSchedule') : uiText('sourceSim')
}

/** The medicine trail of the orders for this patient (MAR-like): prescribed, queried, due, given, cancelled. */
function orderEntries(c: Ctx): void {
  const { sim, s } = c
  const roomEvents = c.idx.byRoom.get(s.roomId ?? '') ?? []
  for (const o of sim.meds.orders.values()) {
    if (o.patientId !== s.id) continue
    const meds = medList(o.items.map((i) => i.medId))
    const prescriber = o.source === 'presenter' ? recordText('you') : o.source === 'schedule' ? null : staffName(o.prescriberId)
    if (o.source !== 'schedule') push(c, absOf(o.createdAt), 'med', `${uiText('prescribed', { meds })} (${sourceWord(o)})`, prescriber)
    const q = sim.meds.queryOf(o.id)
    if (q) {
      const allergy = q.reasons.some((r) => r.kind === 'allergy')
      const pharm = staffName(`pharm-${o.ward}`)
      push(c, absOf(q.raisedAt), 'med', uiText('queried', { reasons: q.reasons.map((r) => r.text.replace(/^Queried: /, '')).join(' ') }), pharm, allergy ? 'allergy' : 'held')
      if (q.status === 'confirmed' && q.resolvedAt !== undefined) push(c, absOf(q.resolvedAt), 'med', uiText('queryConfirmed'), recordText('you'))
      if (q.status === 'cancelled' && q.resolvedAt !== undefined) push(c, absOf(q.resolvedAt), 'med', uiText('queryCancelled'), recordText('you'))
    }
    const given = o.stageAt.given
    if (o.stage === 'given' && given !== undefined) {
      const e = roomEvents.find((x) => x.type === 'medsGiven' && Math.abs(x.t - given) < 0.5)
      push(c, absOf(given), 'med', uiText('given', { meds }), e?.actorId ? staffName(e.actorId) : null)
    } else if (o.cancelledAt !== undefined) {
      if (!(q && q.status === 'cancelled')) push(c, absOf(o.cancelledAt), 'med', uiText('cancelled', { meds }))
    } else if (o.source === 'schedule' || o.source === 'sim') {
      push(c, Math.min(c.now, absOf(o.createdAt)), 'med', uiText('due', { meds, time: hhmm(absOf(o.doseAt)) }), null, q && q.status === 'open' ? 'held' : 'pending')
    }
  }
}

/** The lab's orders for this patient: a result line when complete, or a pending item. */
function labEntries(c: Ctx, pending: string[]): void {
  for (const o of c.sim.lab.ordersFor(c.s.id)) {
    const panel = LAB_CATALOGUE.panels[o.panel]?.name ?? o.panel
    if (o.completeAt === null) {
      const stage = recordText(o.receivedAt !== null ? 'labAtLab' : o.drawnAt !== null ? 'labOnWay' : 'labTaken')
      pending.push(uiText('labPending', { panel, stage }))
      continue
    }
    const outside: string[] = []
    for (const r of o.results) {
      let test
      try {
        test = testById(r.testId)
      } catch {
        continue
      }
      for (const v of r.values) {
        const a = test.analytes.find((x) => x.id === v.analyte)
        if (a && (v.value < a.low || v.value > a.high)) outside.push(`${a.name} ${v.value.toFixed(a.decimals)}${a.unit ? ` ${a.unit}` : ''}`)
      }
    }
    const summary = outside.length === 0 ? uiText('labAllNormal') : uiText('labOutside', { n: outside.length, list: outside.slice(0, 3).join(', ') })
    push(c, absOf(o.completeAt), 'result', uiText('labResult', { panel, summary }), null, outside.length > 0 ? 'outside' : null)
  }
}

/** The imaging reports and the scans still waiting. */
function imagingEntries(c: Ctx, pending: string[]): void {
  const { sim, s } = c
  for (const r of sim.imaging.reportsReady) {
    if (r.exam.patientId !== s.id) continue
    push(c, absOf(r.at), 'imaging', uiText('imagingReport', { protocol: r.exam.protocol }), null, 'review')
  }
  for (const b of sim.imaging.bookings) {
    if (b.patientId !== s.id || b.state === 'done') continue
    pending.push(uiText('imagingPending', { protocol: b.protocolName, state: recordText(b.state === 'active' ? 'scanActive' : 'scanWaiting') }))
  }
}

/** The sim's own events about the patient (ER pathway, bed flow, surgery, scans) and the ward's staff handovers. */
function eventEntries(c: Ctx, wardAt: number | null): void {
  const seen = new Set<number>()
  const add = (e: SimEvent) => {
    if (seen.has(e.id)) return
    const kind = KIND_OF[e.type]
    if (!kind) return
    seen.add(e.id)
    push(c, absOf(e.t), kind, e.text, null, null)
  }
  for (const e of c.idx.bySubject.get(c.s.id) ?? []) add(e)
  if (c.s.ward !== null && wardAt !== null) {
    for (const e of c.idx.handovers) {
      if (absOf(e.t) < wardAt) continue
      const ward = (e.actorId && ALL_STAFF.get(e.actorId)?.ward) ?? (e.subjectId && ALL_STAFF.get(e.subjectId)?.ward) ?? null
      if (ward !== c.s.ward) continue
      push(c, absOf(e.t), 'note', e.text, null, null)
    }
  }
}

/** The current medicine list: the ward chart with the next dose of each, then your own one-off orders still on their way. */
function currentMeds(c: Ctx): ActiveMed[] {
  const { sim, s, now } = c
  const out: ActiveMed[] = []
  const open = [...sim.meds.orders.values()].filter((o) => o.patientId === s.id && o.cancelledAt === undefined && o.source !== 'discharge')
  const nextOf = (medId: string): ActiveMed['next'] => {
    let held = false
    let due: number | null = null
    let lastGiven: number | null = null
    for (const o of open) {
      if (!o.items.some((i) => i.medId === medId)) continue
      if (o.stage === 'given') {
        const g = o.stageAt.given
        if (g !== undefined && (lastGiven === null || absOf(g) > lastGiven)) lastGiven = absOf(g)
        continue
      }
      const q = sim.meds.queryOf(o.id)
      if (q && q.status === 'open') held = true
      else due = due === null ? absOf(o.doseAt) : Math.min(due, absOf(o.doseAt))
    }
    if (held) return { kind: 'held', at: null }
    if (due !== null) return { kind: due <= now ? 'due' : 'next', at: due }
    if (isPrn(medId)) return { kind: 'prn', at: lastGiven }
    const hours = doseHoursOf(medId)
    const day = dayOf(now)
    for (let d = day; d <= day + 1; d++) for (const h of hours) if (d * DAY + h * HOUR > now) return { kind: 'next', at: d * DAY + h * HOUR }
    return { kind: 'next', at: null }
  }
  for (const medId of s.usualMeds) {
    const m = medicineById(medId)
    out.push({ medId, name: m.name, strength: m.strength, status: isPrn(medId) ? 'prn' : 'regular', next: nextOf(medId), newThisStay: !c.h.homeMeds.some((h) => h.medId === medId) })
  }
  const onChart = new Set(s.usualMeds)
  for (const o of open) {
    if (o.source !== 'presenter' || o.stage === 'given') continue
    for (const i of o.items) {
      if (onChart.has(i.medId) || out.some((x) => x.medId === i.medId)) continue
      const m = medicineById(i.medId)
      out.push({ medId: i.medId, name: m.name, strength: m.strength, status: 'oneOff', next: nextOf(i.medId), newThisStay: true })
    }
  }
  return out
}

/** Build the record of a patient (see the module comment). Read-only. */
export function buildRecord(sim: Simulation, s: SubjectInfo): PatientRecordData {
  const idx = noteEvents(sim.log)
  const h = patientHistory(s)
  const stay = h.stay ?? stayTemplateFor(s.reason, s.age)
  const rng = recordRng(s).fork('stay')
  const now = absOf(sim.t)
  const simStart = sim.life.startHour * HOUR
  const c: Ctx = { sim, s, h, stay, rng, now, simStart, idx, out: [], roundDays: new Set(), order: new Map() }
  const base = baselineOf(sim, s, rng)
  const { arrivedAt, wardAt, live } = arrivalOf(c)
  const obs: ObsSet[] = []

  if (!live) synthStay(c, arrivedAt, wardAt, base)
  if (live && wardAt !== null && s.usualMeds.length > 0) {
    push(c, wardAt + 10 * 60, 'med', recordText('charted', { meds: medList(s.usualMeds) }), wardDoctor(s.ward))
  }
  // the triage observations of the synthetic arrival join the series
  for (const e of c.out) if (e.obs) obs.push(e.obs)
  // the kiosk and triage readings the sim took
  for (const r of sim.vitals.readingsFor(s.id)) {
    const at = absOf(r.at)
    const o = obsOfReading(r, at)
    obs.push(o)
    push(c, at, 'obs', uiText(r.source === 'triage' ? 'triageObs' : 'kioskObs'), null, null, o)
  }
  if (wardAt !== null) wardObsRounds(c, arrivedAt, wardAt, base, obs)

  for (const v of doctorVisits(c)) {
    if (v.kind === 'sign') continue
    const at = absOf(v.t)
    if (v.kind === 'round') {
      c.roundDays.add(dayOf(at))
      push(c, at, 'note', `${recordText('round', { doctor: v.doctor, note: stay.round })} ${recordText('roundPlan', { plan: stay.plan.join('; ') })}`, v.doctor)
    } else push(c, at, 'note', `${recordText('review', { doctor: v.doctor, note: stay.round })} ${recordText('roundPlan', { plan: stay.plan.join('; ') })}`, v.doctor)
  }
  eventEntries(c, wardAt)
  orderEntries(c)
  const pending: string[] = []
  labEntries(c, pending)
  imagingEntries(c, pending)

  // the stay template's tests still to come, and its pending items (for a patient whose stay story is drawn)
  if (!live) {
    const day0 = dayOf(arrivedAt)
    for (const t of stay.tests) if (day0 + (t.day ?? 1) - 1 > dayOf(now)) pending.push(t.name)
    for (const p of stay.pending ?? []) pending.push(p)
  } else {
    for (const p of stay.pending ?? []) pending.push(p)
  }
  for (const q of sim.meds.openQueries()) {
    const o = sim.meds.orders.get(q.orderId)
    if (o && o.patientId === s.id) pending.push(uiText('openQuery', { meds: medList(q.medIds) }))
  }

  // alerts
  const alerts: RecordAlert[] = []
  h.allergies.forEach((_, i) => alerts.push({ kind: 'allergy', index: i }))
  for (const q of sim.meds.openQueries()) {
    const o = sim.meds.orders.get(q.orderId)
    if (o && o.patientId === s.id) alerts.push({ kind: 'query', meds: medList(q.medIds), allergy: q.reasons.some((r) => r.kind === 'allergy') })
  }
  if (h.falls !== 'low') alerts.push({ kind: 'falls', level: h.falls })
  if (s.usualMeds.includes('apixaban')) alerts.push({ kind: 'anticoagulant', medId: 'apixaban' })
  if (h.isolation) alerts.push({ kind: 'isolation', text: h.isolation })
  if (h.codeReview) alerts.push({ kind: 'code', text: h.codeStatus })

  // plan for today
  const room = s.roomId ? sim.life.rooms.get(s.roomId) : undefined
  const plan = stay.plan.map((p) => fill(p, s.reason))
  const planned = PLAN_BY_ID.get(s.id)
  if (room?.bed === 'dischargeSigned' || room?.bed === 'leaving') plan.unshift(uiText('dischargeSigned'))
  else if (planned && planned.stay.kind === 'goingHome') plan.unshift(uiText('dischargeToday', { time: hhmm(planned.stay.atHour * HOUR) }))
  if (s.kind === 'ward' && s.ward !== null && s.roomId !== null) {
    const roomIndex = ROOMS.filter((r) => r.ward === s.ward).findIndex((r) => r.id === s.roomId)
    const roundAt = dayOf(now) * DAY + CONFIG.people.round.startHour * HOUR + Math.max(0, roomIndex) * 9 * 60
    if (!c.roundDays.has(dayOf(now)) && now < roundAt) plan.push(uiText('roundDue', { time: hhmm(roundAt) }))
  }

  const weightHeight = sim.vitals.profileIfDrawn(s.id) ?? profileFor(s.id, s.name, { age: s.age, variant: s.variant }, rng.fork('body'))
  const entries = c.out.sort((a, b) => b.at - a.at || (c.order.get(b) ?? 0) - (c.order.get(a) ?? 0))
  obs.sort((a, b) => a.at - b.at)
  return {
    subject: s,
    history: h,
    stay,
    now,
    simStart,
    arrivedAt,
    wardAt,
    team: stay.team,
    doctor: s.ward !== null ? wardDoctor(s.ward) : recordText(s.kind === 'er' ? 'teamEr' : s.kind === 'surgery' ? 'teamSurgery' : 'teamClinic'),
    weightKg: weightHeight ? Math.round(weightHeight.weightKg * 10) / 10 : null,
    heightCm: weightHeight ? Math.round(weightHeight.heightCm) : null,
    bed: room?.bed ?? null,
    alerts,
    entries,
    obs: obs.filter((o) => o.at <= now),
    problems: stay.problems.map((p) => fill(p, s.reason)),
    meds: currentMeds(c),
    pending,
    plan,
    gap: idx.gap && live,
  }
}

/** The record of the patient in a ward room, or null when the bed has nobody in it. */
export function recordForRoom(sim: Simulation, roomId: string): PatientRecordData | null {
  const s = subjectInRoom(sim, roomId)
  return s ? buildRecord(sim, s) : null
}

/** The catalogue medicines the patient in a room must not be given without a query (their allergies' classes): the tablet marks them. */
export function allergyMedsInRoom(sim: Simulation, roomId: string): Set<string> {
  const s = subjectInRoom(sim, roomId)
  return s ? blockedMeds(patientHistory(s).allergies) : new Set()
}
