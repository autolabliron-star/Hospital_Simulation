/**
 * Who is visiting which ward patient: at most two parties per patient, one chair and two window spots per room.
 * Pure bookkeeping (the chair itself is a seat in the seat registry). Tested on its own.
 *
 * L1: visits go only to a room with a patient lying in the bed. The bed flow sets `openRoom` (a room with a patient in bed);
 * `leastVisited` then never returns an empty, reserved or being-cleaned room.
 */
import type { RoomId } from '../types'

export const WINDOW_SLOTS = 2
export const MAX_PARTIES_PER_ROOM = 2

export class VisitBook {
  /** Which rooms may be visited (the bed flow sets it); null: every room (a book on its own, as in the M3 tests). */
  openRoom: ((room: RoomId) => boolean) | null = null
  private readonly parties = new Map<RoomId, number>()
  private readonly windows = new Map<RoomId, (string | null)[]>()

  partiesIn(room: RoomId): number {
    return this.parties.get(room) ?? 0
  }

  /** The room with the fewest parties (below the cap) among `rooms`, in the order given; null if all are full. */
  leastVisited(rooms: readonly RoomId[]): RoomId | null {
    let best: RoomId | null = null
    let bestN = Infinity
    for (const r of rooms) {
      if (this.openRoom !== null && !this.openRoom(r)) continue
      const n = this.partiesIn(r)
      if (n < MAX_PARTIES_PER_ROOM && n < bestN) {
        best = r
        bestN = n
      }
    }
    return best
  }

  addParty(room: RoomId): void {
    this.parties.set(room, this.partiesIn(room) + 1)
  }

  endParty(room: RoomId): void {
    this.parties.set(room, Math.max(0, this.partiesIn(room) - 1))
  }

  /** Take a window spot; its index, or -1 if both are taken. */
  claimWindow(room: RoomId, who: string): number {
    let slots = this.windows.get(room)
    if (!slots) {
      slots = new Array<string | null>(WINDOW_SLOTS).fill(null)
      this.windows.set(room, slots)
    }
    const i = slots.indexOf(null)
    if (i < 0) return -1
    slots[i] = who
    return i
  }

  releaseWindow(room: RoomId, who: string): void {
    const slots = this.windows.get(room)
    if (!slots) return
    const i = slots.indexOf(who)
    if (i >= 0) slots[i] = null
  }
}
