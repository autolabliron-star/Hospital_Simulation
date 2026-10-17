/**
 * L1 "living day": the read-only view renderers and the HUD use for beds, meals and MealBots (`sim.life`).
 * Orchestrator glue. The bed-flow builder (src/sim/beds) and the meals builder (src/sim/meals) mutate these maps; until
 * the first change every room is simply occupied by its M1 inpatient.
 *
 * `setBed` is the one writer of the bed fields (`bed`, `patientId`, `patientName`, `since`, `boarding`): it bumps `version`
 * only when something a bedside screen or door tile shows has really changed, so canvases redraw only on change.
 */
import type { BedState, LivingDayView, MealBot, RoomId, RoomStatus } from './types'

/** The bed fields the bed board writes (everything the meals builder does not own). */
export interface BedFields {
  bed: BedState
  patientId: string | null
  patientName: string | null
  /** The occupant's synthetic details for the room panel; absent when the bed is empty or reserved. */
  patientAge?: number
  patientReason?: string
  dayOfStay?: number
  since: number
  boarding?: { bayId: string; since: number }
}

function setOptional<K extends 'patientAge' | 'patientReason' | 'dayOfStay'>(r: RoomStatus, key: K, value: RoomStatus[K]): void {
  if (value === undefined) delete r[key]
  else r[key] = value
}

export class LivingDay implements LivingDayView {
  readonly rooms = new Map<RoomId, RoomStatus>()
  readonly mealBots = new Map<string, MealBot>()

  constructor(
    readonly startHour: number,
    occupants: Iterable<{ roomId: RoomId; patientId: string; patientName: string }>,
  ) {
    for (const o of occupants) {
      this.rooms.set(o.roomId, {
        roomId: o.roomId,
        bed: 'occupied',
        patientId: o.patientId,
        patientName: o.patientName,
        since: 0,
        meal: 'none',
        recline: 0,
        version: 0,
      })
    }
  }

  /** Write a room's bed fields; true (and `version` + 1) if any of them changed. */
  setBed(roomId: RoomId, f: BedFields): boolean {
    const r = this.rooms.get(roomId)
    if (!r) return false
    const bo = r.boarding
    const same =
      r.bed === f.bed &&
      r.patientId === f.patientId &&
      r.patientName === f.patientName &&
      r.patientAge === f.patientAge &&
      r.patientReason === f.patientReason &&
      r.dayOfStay === f.dayOfStay &&
      r.since === f.since &&
      (bo === undefined ? f.boarding === undefined : f.boarding !== undefined && bo.bayId === f.boarding.bayId && bo.since === f.boarding.since)
    if (same) return false
    r.bed = f.bed
    r.patientId = f.patientId
    r.patientName = f.patientName
    setOptional(r, 'patientAge', f.patientAge)
    setOptional(r, 'patientReason', f.patientReason)
    setOptional(r, 'dayOfStay', f.dayOfStay)
    r.since = f.since
    if (f.boarding === undefined) delete r.boarding
    else r.boarding = { bayId: f.boarding.bayId, since: f.boarding.since }
    r.version++
    return true
  }
}
