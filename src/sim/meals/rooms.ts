/**
 * The meal side of each ward room's `RoomStatus`: `meal` (none / served / eaten) and `recline` (the bed head, 0..1).
 * The bed-flow builder owns `bed`, `patientId` and the rest of the record; this file only writes `meal` and `recline`,
 * and bumps `version` when a bedside screen or door tile would show something different (a meal change, and a recline
 * that starts or ends: not every step of the 6 s it takes).
 */
import { CONFIG } from '../config'
import type { LivingDay } from '../life'
import type { Rng } from '../rng'
import type { BedState, MealKind, RoomId } from '../types'

/** A patient is in the room (in bed, or getting ready to leave it). */
export function holdsPatient(bed: BedState): boolean {
  return bed === 'occupied' || bed === 'dischargeSigned' || bed === 'leaving'
}

/** A meal is served only to a patient who lives in the bed (not one who is leaving, or an empty bed). */
export function servableBed(bed: BedState): boolean {
  return bed === 'occupied' || bed === 'dischargeSigned'
}

interface RoomRt {
  meal: MealKind | null
  servedAt: number
  eatAt: number
  /** Where the bed head is going: 0 or 1. */
  target: 0 | 1
  dish: string | null
}

interface RoomEntry {
  id: RoomId
  r: RoomRt
}

export class RoomMeals {
  private readonly rt = new Map<RoomId, RoomRt>()
  /** The same records as a plain array, so the per-step loop allocates nothing. */
  private readonly entries: RoomEntry[] = []

  constructor(
    private readonly life: LivingDay,
    private readonly rng: Rng,
  ) {
    for (const id of life.rooms.keys()) this.of(id)
  }

  private of(id: RoomId): RoomRt {
    let r = this.rt.get(id)
    if (!r) {
      r = { meal: null, servedAt: 0, eatAt: 0, target: 0, dish: null }
      this.rt.set(id, r)
      this.entries.push({ id, r })
    }
    return r
  }

  /** The meal on the table, and the dish name, or null. */
  tray(id: RoomId): { meal: MealKind; dish: string | null } | null {
    const r = this.rt.get(id)
    const st = this.life.rooms.get(id)
    if (!r || !st || st.meal === 'none' || r.meal === null) return null
    return { meal: r.meal, dish: r.dish }
  }

  /** The host has reached the bedside: the bed head starts to rise. */
  beginRecline(id: RoomId): void {
    this.of(id).target = 1
  }

  /** The host found nobody to serve: the bed head goes back down. */
  abortRecline(id: RoomId): void {
    const r = this.of(id)
    const st = this.life.rooms.get(id)
    if (st && st.meal === 'none') r.target = 0
  }

  /** The tray is on the over-bed table. */
  served(id: RoomId, meal: MealKind, dish: string, t: number): void {
    const st = this.life.rooms.get(id)
    if (!st) return
    const r = this.of(id)
    r.meal = meal
    r.dish = dish
    r.servedAt = t
    r.eatAt = t + this.rng.between(CONFIG.meals.eatSeconds)
    r.target = 1
    st.meal = 'served'
    st.version++
  }

  /** The tray is back on the shelf. */
  collected(id: RoomId): void {
    const st = this.life.rooms.get(id)
    const r = this.of(id)
    r.target = 0
    r.meal = null
    r.dish = null
    if (st && st.meal !== 'none') {
      st.meal = 'none'
      st.version++
    }
  }

  /**
   * A warm start: this room was served at `servedAt` (in the past) and it is now `now`. The patient is still eating
   * (bed head up) or has finished (bed head down, tray still on the table).
   */
  warmServed(id: RoomId, meal: MealKind, dish: string, servedAt: number, now: number): void {
    const st = this.life.rooms.get(id)
    if (!st) return
    const r = this.of(id)
    r.meal = meal
    r.dish = dish
    r.servedAt = servedAt
    r.eatAt = servedAt + this.rng.between(CONFIG.meals.eatSeconds)
    const eating = now < r.eatAt
    r.target = eating ? 1 : 0
    st.meal = eating ? 'served' : 'eaten'
    st.recline = r.target
    st.version++
  }

  /** Every step: patients finish eating, beds without a patient lose their tray, and the bed head moves. */
  step(t: number, dt: number): void {
    const k = dt / CONFIG.meals.reclineSeconds
    for (let i = 0; i < this.entries.length; i++) {
      const { id, r } = this.entries[i]
      const st = this.life.rooms.get(id)
      if (!st) continue
      if (!holdsPatient(st.bed)) {
        // the patient is gone: the tray was cleared with the room, and the bed head comes down
        if (st.meal !== 'none') {
          st.meal = 'none'
          st.version++
          r.meal = null
          r.dish = null
        }
        r.target = 0
      } else if (st.meal === 'served' && t >= r.eatAt) {
        st.meal = 'eaten'
        r.target = 0
        st.version++
      } else if (st.bed === 'leaving') {
        r.target = 0
      }
      const from = st.recline
      if (from !== r.target) {
        const to = from < r.target ? Math.min(r.target, from + k) : Math.max(r.target, from - k)
        st.recline = to
        if ((from === 0 && to > 0) || to === 0 || to === 1) st.version++
      }
    }
  }
}
