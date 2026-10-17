/**
 * The numbers of the L1 day, derived from the event log and `sim.life` (never from React state per entity): beds
 * occupied and ready, today's discharges and how many were before noon, admissions, ER boarding (count and longest wait),
 * meals served on time, and the "predicted discharges today" line from the synthetic day plan (src/content/patients.json).
 *
 * The HUD's KPI card polls `read` at about 4 Hz (usePoll) and the command wall's Beds panel at 2 Hz, so both show the same
 * figures. `DayStatsTracker` walks the log incrementally (only the events it has not seen) and starts again whenever the
 * Simulation object changes (a Jump). Pure: it takes the sim as an argument, so node tests can feed it fixtures.
 *
 * After a Jump the event log only holds what happened since the new hospital was built. Discharges and admissions that the
 * warm start already did are added back from the room status and the day plan (and not counted twice when their event also
 * shows up). Meals are counted from the events the log holds, so after a Jump they start from the Jump.
 */
import { PATIENTS } from '@/content/catalogue'
import { CONFIG } from '@/sim/config'
import { hourOf } from '@/sim/events'
import type { LivingDayView, RoomStatus, SimEvent } from '@/sim/types'
import { isBedTaken } from './bedStyle'

/** What the stats read from a Simulation. */
export interface DayStatsSource {
  readonly t: number
  readonly life: LivingDayView
  readonly log: { since(afterId: number): SimEvent[] }
}

export interface DayStats {
  bedsTotal: number
  /** A patient still has the bed (occupied, discharge signed, leaving). */
  bedsOccupied: number
  bedsReady: number
  bedsReserved: number
  /** Empty and waiting for a cleaner, or being cleaned. */
  bedsToClean: number
  dischargesToday: number
  dischargesBeforeNoon: number
  admissionsToday: number
  boardingCount: number
  /** Whole minutes the longest-waiting boarder has been in an ER bay (0 with nobody boarding). */
  boardingLongestMin: number
  mealsServed: number
  mealsOnTime: number
  /** The day plan: discharges planned for today, how many are still in bed, and when the next one is due (a clock hour). */
  plannedDischarges: number
  plannedToCome: number
  nextPlannedHour: number | null
}

interface PlannedDischarge {
  id: string
  roomId: string
  atHour: number
}

/** Today's planned discharges, from the content (the sim signs them; it makes no clinical decision). */
export const PLANNED_DISCHARGES: readonly PlannedDischarge[] = PATIENTS.flatMap((p) => (p.stay.kind === 'goingHome' ? [{ id: p.id, roomId: p.roomId, atHour: p.stay.atHour }] : []))
const PLAN_IDS = new Set(PATIENTS.map((p) => p.id))

/** "07:45" for a clock hour (7.75). */
export function hourText(hour: number): string {
  const total = Math.round(hour * 60)
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Was a tray served at clock hour `h` inside its meal window? (After the window's end, or in the gap after it, it is late.) */
export function servedOnTime(h: number): boolean {
  let latestStart = -Infinity
  let end = Infinity
  for (const w of Object.values(CONFIG.meals.windows)) {
    if (w[0] <= h && w[0] > latestStart) {
      latestStart = w[0]
      end = w[1]
    }
  }
  return h <= end
}

/** Keys that tie a log event to a person or a room, so a warm start's baseline is not counted twice with its own event. */
function keysOf(e: SimEvent): string[] {
  const keys: string[] = []
  if (e.subjectId !== undefined) keys.push(e.subjectId)
  if (e.roomId !== undefined) keys.push(e.roomId)
  return keys
}

export class DayStatsTracker {
  private owner: DayStatsSource | null = null
  private lastId = 0
  private readonly homeKeys = new Set<string>()
  private readonly admitKeys = new Set<string>()
  private homeBeforeNoon = 0
  private homeCount = 0
  private admitCount = 0
  private mealsServed = 0
  private mealsOnTime = 0
  /** Bumped whenever a counter from the log changes; the wall's redraw check reads it. */
  rev = 0

  private reset(owner: DayStatsSource): void {
    this.owner = owner
    this.lastId = 0
    this.homeKeys.clear()
    this.admitKeys.clear()
    this.homeBeforeNoon = 0
    this.homeCount = 0
    this.admitCount = 0
    this.mealsServed = 0
    this.mealsOnTime = 0
    this.rev++
  }

  private absorb(src: DayStatsSource): void {
    const fresh = src.log.since(this.lastId)
    if (fresh.length === 0) return
    for (const e of fresh) {
      this.lastId = e.id
      if (e.type === 'wentHome') {
        this.homeCount++
        if (hourOf(e.t) < 12) this.homeBeforeNoon++
        for (const k of keysOf(e)) this.homeKeys.add(k)
        this.rev++
      } else if (e.type === 'admittedToWard') {
        this.admitCount++
        for (const k of keysOf(e)) this.admitKeys.add(k)
        this.rev++
      } else if (e.type === 'mealServed') {
        this.mealsServed++
        if (servedOnTime(hourOf(e.t))) this.mealsOnTime++
        this.rev++
      }
    }
  }

  /** Bring the tracker up to date with `src` and return the figures. */
  read(src: DayStatsSource): DayStats {
    if (this.owner !== src) this.reset(src)
    this.absorb(src)

    const rooms = src.life.rooms
    let occupied = 0
    let ready = 0
    let reserved = 0
    let toClean = 0
    let boarding = 0
    let longest = 0
    let reoccupied = 0
    rooms.forEach((r: RoomStatus) => {
      if (isBedTaken(r.bed)) occupied++
      else if (r.bed === 'ready') ready++
      else if (r.bed === 'reserved') reserved++
      else toClean++
      if (r.boarding) {
        boarding++
        longest = Math.max(longest, src.t - r.boarding.since)
      }
      // a warm start can put an admitted patient in a bed: counted as an admission unless the log already has it
      if (r.bed === 'occupied' && r.patientId !== null && !PLAN_IDS.has(r.patientId) && !this.admitKeys.has(r.patientId) && !this.admitKeys.has(r.roomId)) reoccupied++
    })

    const startHour = src.life.startHour
    let homeBaseline = 0
    let baselineBeforeNoon = 0
    let toCome = 0
    let nextHour: number | null = null
    for (const p of PLANNED_DISCHARGES) {
      const room = rooms.get(p.roomId)
      const stillThere = room !== undefined && room.patientId === p.id && isBedTaken(room.bed)
      if (stillThere) {
        toCome++
        if (nextHour === null || p.atHour < nextHour) nextHour = p.atHour
      } else if (p.atHour <= startHour && !this.homeKeys.has(p.id) && !this.homeKeys.has(p.roomId)) {
        // gone before the Jump: the warm start already sent them home
        homeBaseline++
        if (p.atHour < 12) baselineBeforeNoon++
      }
    }

    return {
      bedsTotal: rooms.size,
      bedsOccupied: occupied,
      bedsReady: ready,
      bedsReserved: reserved,
      bedsToClean: toClean,
      dischargesToday: this.homeCount + homeBaseline,
      dischargesBeforeNoon: this.homeBeforeNoon + baselineBeforeNoon,
      admissionsToday: this.admitCount + reoccupied,
      boardingCount: boarding,
      boardingLongestMin: Math.floor(longest / 60),
      mealsServed: this.mealsServed,
      mealsOnTime: this.mealsOnTime,
      plannedDischarges: PLANNED_DISCHARGES.length,
      plannedToCome: toCome,
      nextPlannedHour: nextHour,
    }
  }
}

/** The one tracker of the running hospital (the KPI card and the command wall share it). */
export const dayStatsTracker = new DayStatsTracker()
