/**
 * The seat registry: who sits where. Pure and deterministic (no randomness, no React, no three.js).
 *
 * The seats come from the building layout (`getLayout().seats`, see src/scene/building/layout): every place someone
 * sits or lies, with its true seat height and a walkable `approach` spot. The sim hands them out here, so a seat is
 * never double-booked:
 *
 *   const seat = seats.claim(patient.id, { kind: 'waiting', group: 'er' }, patient.position)   // nearest free one
 *   walker.goTo(seat.approach)                                                                 // then ...
 *   walker.place(seat.x, seat.z, seat.heading)                                                 // ... snap on, pose 'sit' | 'lie'
 *   seats.release(seat.id)                                                                     // on standing up
 *
 * Seat ids read `<kind>:<group>:<local>` (`waiting:er:S1:2`, `bed:A3`, `visitor:A3`, `cafe:T1:a`, `erBay:bay:4`). The
 * `group` is the second token. For waiting seats it says which door the row serves: `triage` (the north rows, by the
 * triage door) or `er` (the south rows, by the ER door; the ER has no seats of its own, so its patients wait there).
 *
 * The blood-draw chairs (`drawChair:*`, area `diagnostics`) have their own kind, so ambient lounge fill never sits anyone
 * there; the ER claims them by area.
 */
import { getLayout } from '@/scene/building/layout'
import type { SeatKind, SeatSpec, Vec2 } from './types'

/** Which seats a query is about. Every field narrows the set; an empty filter matches every seat. */
export interface SeatFilter {
  kind?: SeatKind | readonly SeatKind[]
  /** An AreaId from places.ts, e.g. `'lobby'`, `'atrium'`, `'room:A3'`, `'loungeA'`. */
  area?: string
  ids?: readonly string[]
  /** The second token of the seat id (`'er'` or `'triage'` for waiting seats, `'atrium'` or `'spine'` for benches). */
  group?: string
}

/** The seats of the building, in a stable order (sorted by id). */
export function defaultSeats(): SeatSpec[] {
  return getLayout().seats.slice()
}

/** The group of a seat: the second token of its id (`waiting:er:S1:2` -> `er`; `bed:A3` -> `A3`). */
export function seatGroup(seat: SeatSpec): string {
  return seat.id.split(':')[1] ?? ''
}

/** Seats a kind-less, area-less filter must not hand out (none any more: blood-draw chairs have their own kind). */
function isReserved(_seat: SeatSpec): boolean {
  return false
}

function matches(seat: SeatSpec, f: SeatFilter): boolean {
  if (f.kind !== undefined) {
    if (typeof f.kind === 'string' ? seat.kind !== f.kind : !f.kind.includes(seat.kind)) return false
  }
  if (f.area !== undefined && seat.area !== f.area) return false
  if (f.ids !== undefined && !f.ids.includes(seat.id)) return false
  if (f.group !== undefined && seatGroup(seat) !== f.group) return false
  if (isReserved(seat) && f.area !== seat.area && !(f.ids?.includes(seat.id) ?? false)) return false
  return true
}

export class SeatRegistry {
  readonly all: readonly SeatSpec[]
  private readonly index = new Map<string, number>()
  private readonly taken: (string | null)[]
  /** occupant -> the seats they hold, in the order claimed (the last is `seatOf`). */
  private readonly held = new Map<string, string[]>()

  constructor(seats: readonly SeatSpec[]) {
    this.all = seats
    this.taken = seats.map(() => null)
    seats.forEach((s, i) => {
      if (this.index.has(s.id)) throw new Error(`Duplicate seat id ${s.id}`)
      this.index.set(s.id, i)
    })
  }

  /** The seat with this id. Throws if there is none. */
  byId(id: string): SeatSpec {
    const i = this.index.get(id)
    if (i === undefined) throw new Error(`Unknown seat ${id}`)
    return this.all[i]
  }

  /**
   * The free seat matching `filter` nearest to `near` (the first in id order if `near` is omitted; ties go to the lower id),
   * now held by `occupantId`. Null if none is free.
   */
  claim(occupantId: string, filter: SeatFilter, near?: Vec2): SeatSpec | null {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.all.length; i++) {
      if (this.taken[i] !== null || !matches(this.all[i], filter)) continue
      if (near === undefined) {
        best = i
        break
      }
      const d = Math.hypot(this.all[i].x - near.x, this.all[i].z - near.z)
      if (d < bestD - 1e-9) {
        best = i
        bestD = d
      }
    }
    if (best < 0) return null
    this.take(best, occupantId)
    return this.all[best]
  }

  /** Reserve a particular seat (a ward bed, a command desk). False if it is taken. */
  claimId(seatId: string, occupantId: string): boolean {
    const i = this.index.get(seatId)
    if (i === undefined) throw new Error(`Unknown seat ${seatId}`)
    if (this.taken[i] !== null) return false
    this.take(i, occupantId)
    return true
  }

  /**
   * Free a seat (nobody there: no-op). With `occupantId`, only if that occupant still holds it: a stale handle to a seat
   * that has passed to somebody else must not free it under them.
   */
  release(seatId: string, occupantId?: string): void {
    const i = this.index.get(seatId)
    if (i === undefined) throw new Error(`Unknown seat ${seatId}`)
    const who = this.taken[i]
    if (who === null || (occupantId !== undefined && who !== occupantId)) return
    this.taken[i] = null
    const list = this.held.get(who)
    if (list) {
      const k = list.indexOf(seatId)
      if (k >= 0) list.splice(k, 1)
      if (list.length === 0) this.held.delete(who)
    }
  }

  /** Free every seat held by this occupant (a person who leaves). */
  releaseBy(occupantId: string): void {
    const list = this.held.get(occupantId)
    if (!list) return
    for (const id of list.slice()) this.release(id)
  }

  /** Who holds the seat, or null. */
  occupant(seatId: string): string | null {
    const i = this.index.get(seatId)
    if (i === undefined) throw new Error(`Unknown seat ${seatId}`)
    return this.taken[i]
  }

  /** The seat this occupant claimed last and still holds, or null. */
  seatOf(occupantId: string): SeatSpec | null {
    const list = this.held.get(occupantId)
    return list && list.length > 0 ? this.byId(list[list.length - 1]) : null
  }

  /** Every free seat matching the filter, in id order. */
  free(filter: SeatFilter): SeatSpec[] {
    const out: SeatSpec[] = []
    for (let i = 0; i < this.all.length; i++) if (this.taken[i] === null && matches(this.all[i], filter)) out.push(this.all[i])
    return out
  }

  /** How many matching seats are held, out of how many there are. */
  occupancy(filter: SeatFilter): { taken: number; total: number } {
    let taken = 0
    let total = 0
    for (let i = 0; i < this.all.length; i++) {
      if (!matches(this.all[i], filter)) continue
      total++
      if (this.taken[i] !== null) taken++
    }
    return { taken, total }
  }

  private take(i: number, occupantId: string): void {
    this.taken[i] = occupantId
    const list = this.held.get(occupantId)
    if (list) list.push(this.all[i].id)
    else this.held.set(occupantId, [this.all[i].id])
  }
}
