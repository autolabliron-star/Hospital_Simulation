/**
 * What the Room panel shows for a ward room about the living day (L1): who is in the bed now (the synthetic patient, or the
 * admitted ER patient), the day of stay, today's plan (next dose, the current or next meal, the planned discharge), and the
 * bed state. Read from `sim.life` and the day plan in src/content/patients.json, and returned as plain strings, so the panel's
 * 4 Hz poll re-renders only when a word changes. The drawer, orders and "in the room now" parts stay in roomSnapshot.ts.
 * Pure: it takes the sim as an argument, so node tests can feed it fixtures.
 */
import { PATIENTS } from '@/content/catalogue'
import { CONFIG } from '@/sim/config'
import { clockText, hourOf } from '@/sim/events'
import type { BedState, LivingDayView, Order, RoomMeal, RoomStatus } from '@/sim/types'
import { BED_COLOR, isBedTaken } from './bedStyle'
import { hourText } from './dayStats'
import { dayHour } from './jumpModel'
import { fillCopy, L1_COPY } from './l1Copy'

const COPY = L1_COPY.room
const PLAN_BY_ID = new Map(PATIENTS.map((p) => [p.id, p]))

/** What the view reads from a Simulation. */
export interface WardLifeSource {
  readonly t: number
  readonly life: LivingDayView
  readonly meds: { readonly orders: ReadonlyMap<string, Order> }
}

export interface WardPlanView {
  nextDose: string
  meals: string
  discharge: string
}

export interface WardLifeView {
  roomId: string
  bed: BedState
  bedLabel: string
  bedDetail: string
  bedColor: string
  /** "since 12:40". */
  bedSince: string
  /** A patient is lying here (occupied, discharge signed, leaving). */
  hasPatient: boolean
  /** The patient's name, or "Ready for the next patient" and its siblings for an empty bed. */
  headline: string
  /** "Day 4 of stay" or "Admitted from the ER". */
  stay: string | null
  age: number | null
  reason: string | null
  /** A reserved bed: who is coming and, if boarding in the ER, for how long. */
  notice: string | null
  /** Only while a patient is in the bed. */
  plan: WardPlanView | null
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** "ER bay 3" from a bay id that ends in its number; any other id is shown as it is. */
export function bayLabel(bayId: string): string {
  const m = /(\d+)\s*$/.exec(bayId)
  return m ? fillCopy(COPY.bay, { n: m[1] }) : bayId
}

function nextDoseText(sim: WardLifeSource, roomId: string, dayNow: number): string {
  let next: Order | undefined
  for (const o of sim.meds.orders.values()) {
    if (o.roomId !== roomId || o.stage === 'given' || o.cancelledAt !== undefined) continue
    if (next === undefined || o.doseAt < next.doseAt) next = o
  }
  if (next) return fillCopy(next.doseAt <= sim.t ? COPY.nextDoseDue : COPY.nextDoseAt, { time: clockText(next.doseAt) })
  const wave = CONFIG.doseWaves.hours.find((h) => h > dayNow)
  return wave === undefined ? COPY.noMoreDoses : fillCopy(COPY.nextDoseWave, { time: hourText(wave) })
}

/** The meal line: the meal in its window (or just after it) with how the tray is doing, otherwise the next meal. */
export function mealText(dayNow: number, meal: RoomMeal): string {
  const windows = Object.entries(CONFIG.meals.windows).sort((a, b) => a[1][0] - b[1][0])
  let current: { name: string; end: number } | null = null
  for (const [kind, w] of windows) if (w[0] <= dayNow) current = { name: capitalise(kind), end: w[1] }
  if (current && (dayNow <= current.end + 1 || meal !== 'none')) {
    if (meal === 'eaten') return fillCopy(COPY.mealEaten, { meal: current.name })
    if (meal === 'served') return fillCopy(COPY.mealServed, { meal: current.name })
    return fillCopy(dayNow <= current.end ? COPY.mealBeingServed : COPY.mealNotServed, { meal: current.name })
  }
  const next = windows.find(([, w]) => w[0] > dayNow)
  return next ? fillCopy(COPY.mealNext, { meal: capitalise(next[0]), time: hourText(next[1][0]) }) : COPY.mealsDone
}

function dischargeText(room: RoomStatus, planned: { atHour: number } | null): string {
  if (room.bed === 'dischargeSigned') return COPY.dischargeSigned
  if (room.bed === 'leaving') return COPY.dischargeLeaving
  if (planned) return fillCopy(COPY.dischargeGoing, { time: hourText(planned.atHour) })
  return room.patientId !== null && PLAN_BY_ID.has(room.patientId) ? COPY.dischargeStaying : COPY.dischargeNotPlanned
}

export function wardLifeView(sim: WardLifeSource, roomId: string): WardLifeView | null {
  const room = sim.life.rooms.get(roomId)
  if (!room) return null
  const copy = L1_COPY.bedStates[room.bed]
  const hasPatient = isBedTaken(room.bed) && room.patientId !== null
  const record = room.patientId !== null ? PLAN_BY_ID.get(room.patientId) : undefined
  const dayNow = dayHour(hourOf(sim.t))
  const name = room.patientName ?? room.patientId ?? ''

  let headline = name
  let notice: string | null = null
  if (!hasPatient) {
    if (room.bed === 'reserved') {
      headline = fillCopy(COPY.reservedFor, { name })
      notice = room.boarding
        ? fillCopy(COPY.boardingIn, { name, bay: bayLabel(room.boarding.bayId), n: Math.max(0, Math.floor((sim.t - room.boarding.since) / 60)) })
        : fillCopy(COPY.onTheWay, { name })
    } else if (room.bed === 'needsCleaning') headline = COPY.emptyNeedsCleaning
    else if (room.bed === 'cleaning') headline = COPY.emptyCleaning
    else headline = room.bed === 'ready' ? COPY.emptyReady : copy.label
  }

  let stay: string | null = null
  if (hasPatient) stay = record ? fillCopy(COPY.dayOfStay, { n: record.dayOfStay }) : COPY.admittedFromEr

  const planned = record && record.stay.kind === 'goingHome' ? { atHour: record.stay.atHour } : null
  return {
    roomId,
    bed: room.bed,
    bedLabel: copy.label,
    bedDetail: copy.detail,
    bedColor: BED_COLOR[room.bed],
    bedSince: fillCopy(COPY.since, { time: clockText(room.since) }),
    hasPatient,
    headline,
    stay,
    age: hasPatient && record ? record.age : null,
    reason: hasPatient && record ? record.reason : null,
    notice,
    plan: hasPatient ? { nextDose: nextDoseText(sim, roomId, dayNow), meals: mealText(dayNow, room.meal), discharge: dischargeText(room, planned) } : null,
  }
}
