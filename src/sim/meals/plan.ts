/**
 * Pure helpers of the meal service: the serving windows, the dish a patient chose, and the spots the MealBot and its
 * ward host use at a stop and at the service lift. Nothing here touches the simulation state.
 */
import { ADMISSION_PROFILES } from '@/content/admissions'
import { DIET, isNilByMouth } from '@/content/diet'
import { dishesFor, type Dish } from '@/content/meals'
import { CONFIG } from '../config'
import { MEAL_STOPS, SERVICE_LIFT, wardSign, type MealStop, type Spot } from '../places'
import { hashString, mixSeed } from '../rng'
import type { MealKind, Vec2, WardId } from '../types'

export const MEAL_ORDER: readonly MealKind[] = ['breakfast', 'lunch', 'dinner']

export interface MealWindow {
  meal: MealKind
  /** Clock hours. */
  start: number
  end: number
}

/** The serving windows, earliest first. */
export const MEAL_WINDOWS: readonly MealWindow[] = MEAL_ORDER.map((meal) => {
  const w = CONFIG.meals.windows[meal]
  if (!w) throw new Error(`CONFIG.meals.windows has no ${meal}`)
  return { meal, start: w[0], end: w[1] }
}).sort((a, b) => a.start - b.start)

/** The stops of a ward, west to east (the order the bot drives them). */
export const STOPS_OF: Record<WardId, readonly MealStop[]> = {
  A: MEAL_STOPS.filter((s) => s.ward === 'A'),
  B: MEAL_STOPS.filter((s) => s.ward === 'B'),
}

/**
 * The dish a patient chose for a meal: a pure function of the world seed, the meal and the patient, so the bedside
 * screen, the event line and the tray always agree. The menu is a fixed demo list (no diet logic).
 */
export function dishFor(seed: number, meal: MealKind, patientId: string): Dish {
  const dishes = dishesFor(meal)
  const h = mixSeed(seed, hashString(`${meal}:${patientId}`))
  return dishes[h % dishes.length]
}

/**
 * F-29: the ward reasons (`RoomStatus.patientReason`, the admission profile's `wardReason`) of patients kept nil by mouth: a reason whose
 * admission profile follows only ER reasons that `content/diet.ts` lists. A profile id is not on the room status, but its ward reason is,
 * and each profile has its own: this is the cleanest read-only path from a bed to the patient's original ER reason. Planned inpatients
 * (content/patients.json) have no profile, so they are never nil by mouth.
 */
const NBM_WARD_REASONS: ReadonlySet<string> = (() => {
  const byReason = new Map<string, boolean>()
  for (const p of ADMISSION_PROFILES) byReason.set(p.wardReason, (byReason.get(p.wardReason) ?? true) && p.reasons.every(isNilByMouth))
  return new Set([...byReason].filter(([, nbm]) => nbm).map(([reason]) => reason))
})()

/** Is the patient with this ward reason kept nil by mouth (no tray, and they say so)? */
export function isNilByMouthWardReason(reason: string | null | undefined): boolean {
  return reason !== null && reason !== undefined && NBM_WARD_REASONS.has(reason)
}

/** The bedside sign for a nil-by-mouth patient ("Nil by mouth"), or null. */
export function dietSignFor(reason: string | null | undefined): string | null {
  return isNilByMouthWardReason(reason) ? DIET.nilByMouth.sign : null
}

/** Where the host stands behind a parked bot (the cabinet door is at the back), and how far behind (m). */
export const HOST_BEHIND = 1.15

/** The host's spot at a stop: behind the parked bot, on the same line. The bot parks facing `stop.heading`. */
export function hostSpot(stop: MealStop, out: Vec2): Vec2 {
  out.x = stop.at.x - Math.sin(stop.heading) * HOST_BEHIND
  out.z = stop.at.z - Math.cos(stop.heading) * HOST_BEHIND
  return out
}

/** The service lift spots: the bot's, and the host's beside it (inside the ward's lift lobby). */
export function liftBotSpot(ward: WardId): Spot {
  return SERVICE_LIFT[ward]
}

export function liftHostSpot(ward: WardId): Spot {
  const s = SERVICE_LIFT[ward]
  const sign = wardSign(ward)
  return { at: { x: s.at.x + 0.95, z: s.at.z + sign * 0.5 }, heading: s.heading }
}

/** Clock hour of a sim time (not wrapped): 07:30 + t. */
export function clockHour(t: number): number {
  return CONFIG.sim.startHour + t / 3600
}

/** Sim time of a clock hour of day `day` (day 0 is the day the sim starts on). */
export function simTimeOf(day: number, hour: number): number {
  return (day * 24 + hour - CONFIG.sim.startHour) * 3600
}
