/**
 * Standing queues: an ordered line of spots, with join / leave / advance semantics. Pure and deterministic (no
 * randomness, no clock, no nav graph): the people who queue walk to `spotFor(index)` and re-check `indexOf(me)` as the line
 * moves.
 *
 *   const line = makeQueue('kiosk0')
 *   const i = line.join(patient.id)          // 0 = at the front; -1 if the line is full
 *   walker.goTo(line.spotFor(i).at)
 *   ...each tick:  if (line.indexOf(me) !== myIndex) { myIndex = line.indexOf(me); walker.goTo(line.spotFor(myIndex).at) }
 *   line.leave(patient.id)                   // served (or gave up): everyone behind steps forward
 *
 * The spots of the lobby are laid out from the contract (`LOBBY`): a line running away from the reception desk, a line behind
 * each self check-in kiosk, and a short line at the café counter. Every spot is on walkable ground, clear of furniture, and
 * faces the one in front (the first faces the desk, kiosk or counter).
 */
import { ATRIUM, LOBBY } from '../places'
import type { Vec2 } from '../types'

export interface QueueSpot {
  at: Vec2
  heading: number
}

/** The first spot of a line where a person is served, then spots this far apart, one behind the other. */
const PITCH = 0.8

export class Queue {
  private list: string[] = []
  /** Bumped by every change, so a member can tell cheaply that the line moved. */
  version = 0

  constructor(
    readonly id: string,
    private readonly spot: (index: number) => QueueSpot,
    readonly capacity: number,
  ) {}

  /** Everyone in the line, front first. */
  get members(): readonly string[] {
    return this.list
  }

  get length(): number {
    return this.list.length
  }

  get isFull(): boolean {
    return this.list.length >= this.capacity
  }

  /** Join the back of the line. Returns the place (0 = front), or -1 if the line is full. Joining twice keeps your place. */
  join(memberId: string): number {
    const have = this.list.indexOf(memberId)
    if (have >= 0) return have
    if (this.list.length >= this.capacity) return -1
    this.list.push(memberId)
    this.version++
    return this.list.length - 1
  }

  /** Leave the line from anywhere in it; those behind move up one place. Not in the line: nothing happens. */
  leave(memberId: string): void {
    const i = this.list.indexOf(memberId)
    if (i < 0) return
    this.list.splice(i, 1)
    this.version++
  }

  /** The place in the line (0 = front), or -1. */
  indexOf(memberId: string): number {
    return this.list.indexOf(memberId)
  }

  /** The person at the front, or null. */
  head(): string | null {
    return this.list.length > 0 ? this.list[0] : null
  }

  /** The front person has been served: they leave and everyone moves up. Returns who left. */
  advance(): string | null {
    const who = this.head()
    if (who !== null) this.leave(who)
    return who
  }

  /** Where the person in place `index` stands (any index: spots are defined beyond the capacity too). */
  spotFor(index: number): QueueSpot {
    return this.spot(index)
  }
}

// ---------------------------------------------------------------------------------------------
// The lobby's and the café's lines
// ---------------------------------------------------------------------------------------------

/**
 * The reception desk: the first spot is at the desk front, the line runs east along the desk's axis, away from it. Everyone
 * faces west (toward the desk).
 */
export function receptionQueueSpot(index: number): QueueSpot {
  const desk = LOBBY.reception.at
  return { at: { x: desk.x + 1.8 + index * PITCH, z: desk.z }, heading: -Math.PI / 2 }
}

/** Self check-in kiosk `k` (0 or 1): the first spot is the guest spot of the kiosk, the line runs north behind it. Everyone faces south. */
export function kioskQueueSpot(k: number, index: number): QueueSpot {
  const kiosk = LOBBY.kiosks[k]
  if (!kiosk) throw new Error(`Unknown kiosk ${k}`)
  return { at: { x: kiosk.x, z: kiosk.z - index * PITCH }, heading: 0 }
}

/** The café counter: the line runs east from the counter front, everyone faces west. */
export function cafeQueueSpot(index: number): QueueSpot {
  const barista = ATRIUM.cafe.at
  return { at: { x: barista.x + 1.85 + index * PITCH, z: barista.z }, heading: -Math.PI / 2 }
}

export type QueueId = 'reception' | 'kiosk0' | 'kiosk1' | 'cafe'
export const QUEUE_IDS: readonly QueueId[] = ['reception', 'kiosk0', 'kiosk1', 'cafe'] as const

/** How many people each line holds before it is "full" (a person finding a full line waits in a seat instead). */
const QUEUE_CAPACITY: Record<QueueId, number> = { reception: 5, kiosk0: 4, kiosk1: 4, cafe: 3 }

/** The spot of place `index` in a named line (pure: no state). */
export function queueSpot(id: QueueId, index: number): QueueSpot {
  switch (id) {
    case 'reception':
      return receptionQueueSpot(index)
    case 'kiosk0':
      return kioskQueueSpot(0, index)
    case 'kiosk1':
      return kioskQueueSpot(1, index)
    case 'cafe':
      return cafeQueueSpot(index)
  }
}

/** A fresh, empty line for a named queue. */
export function makeQueue(id: QueueId): Queue {
  return new Queue(id, (i) => queueSpot(id, i), QUEUE_CAPACITY[id])
}
