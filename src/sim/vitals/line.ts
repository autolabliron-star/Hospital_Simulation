/**
 * W4 health kiosks: the one shared line in front of both towers (HEALTH_LINE: the front spot, then back along -z at `pitch`, room for `capacity`).
 * First come, first served: whoever frees a kiosk first takes the head of the line. The people in the line are the ones NOT yet at a kiosk; somebody
 * called leaves the line at once and everybody behind steps up.
 *
 * Pure bookkeeping, no clock and no randomness: the service decides who is called and when.
 */
import { CONFIG } from '../config'
import { HEALTH_LINE, type Spot } from '../places'
import type { HealthSessionKind } from '../types'
import type { KioskSubject } from './ports'

/**
 * Two optional calls on top of the frozen `KioskSubject`: a subject that has them is told more, one that has not simply carries on as before.
 * The ER patient waits in their seat and has neither.
 */
export interface KioskSubjectExtras {
  /** Your place in the line (0 = the front) and the spot to stand on: called when you join and whenever the line moves. */
  kioskQueued?(spot: Spot, place: number): void
  /** You were called but never reached the platform in time (stuck behind somebody): the kiosk starts anyway; get onto the platform now. */
  kioskForced?(stand: Spot): void
}

/** A subject that wants to know where to stand in the line. */
export type QueueAwareSubject = KioskSubject & Required<Pick<KioskSubjectExtras, 'kioskQueued'>> & KioskSubjectExtras

export function isQueueAware(s: KioskSubject): s is QueueAwareSubject {
  return typeof (s as KioskSubjectExtras).kioskQueued === 'function'
}

export interface LineEntry {
  id: string
  name: string
  subject: KioskSubject
  kind: HealthSessionKind
  /** Sim time they joined. */
  joinedAt: number
  /** The place the subject was last told (-1: not yet told). */
  told: number
}

export class HealthLine {
  private readonly list: LineEntry[] = []
  /** Bumped by every change. */
  version = 0

  constructor(
    readonly capacity: number = HEALTH_LINE.capacity,
    /** An ER 'vitals' session is only offered when at most this many are in the line (a short wait: triage may call them any minute). */
    readonly erMaxAhead: number = CONFIG.vitals.erMaxAhead,
  ) {}

  get length(): number {
    return this.list.length
  }

  /** Everyone in the line, front first. */
  get members(): readonly LineEntry[] {
    return this.list
  }

  has(id: string): boolean {
    return this.indexOf(id) >= 0
  }

  indexOf(id: string): number {
    for (let i = 0; i < this.list.length; i++) if (this.list[i].id === id) return i
    return -1
  }

  /** Is there room for a session of this kind? */
  canJoin(kind: HealthSessionKind): boolean {
    if (this.list.length >= this.capacity) return false
    if (kind === 'vitals' && this.list.length > this.erMaxAhead) return false
    return true
  }

  /** Join the back of the line: the place (0 = the front), or -1 when there is no room (or for the kind, see `canJoin`). Joining twice keeps the place. */
  join(entry: Omit<LineEntry, 'told'>): number {
    const have = this.indexOf(entry.id)
    if (have >= 0) return have
    if (!this.canJoin(entry.kind)) return -1
    this.list.push({ ...entry, told: -1 })
    this.version++
    return this.list.length - 1
  }

  /** Leave from anywhere in the line; those behind step up. Returns the entry, or null if they were not in it. */
  leave(id: string): LineEntry | null {
    const i = this.indexOf(id)
    if (i < 0) return null
    const [e] = this.list.splice(i, 1)
    this.version++
    return e
  }

  /** The head of the line, who is called to the kiosk that has just freed up. */
  shift(): LineEntry | null {
    if (this.list.length === 0) return null
    const e = this.list.shift()!
    this.version++
    return e
  }

  /** The spot for a place: the front, then back along -z. They face the kiosks (+z). */
  spotFor(place: number): Spot {
    return { at: { x: HEALTH_LINE.front.x, z: HEALTH_LINE.front.z - place * HEALTH_LINE.pitch }, heading: HEALTH_LINE.heading }
  }

  clear(): void {
    this.list.length = 0
    this.version++
  }
}
