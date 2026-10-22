/**
 * The emergency department's bookkeeping: bays and who may have them, pure and deterministic (no walking, no
 * rendering). The people (patients, nurses, doctors, porters, cleaners) are controllers that ask this board for
 * their next job and tell it what they finished, so every rule lives in one tested place.
 *
 *   ER bay      free -> occupied (promised to a patient from the moment it is assigned, until the patient is off the
 *               trolley) -> needsCleaning (a cleaner is on the way, or cleaning) -> free. A bay that needs cleaning is
 *               never given to a patient.
 *   Triage bay  free -> occupied -> free.
 *   Priority    the next free ER bay goes to an ambulance patient with acuity 1-2 first (preemption), then by acuity
 *               (1 = most urgent), then by arrival time. Triage and escorts are first-come first-served.
 *
 * Seats are claimed through the seat registry at assignment time, so a trolley or a triage chair is never double-booked.
 */
import type { SeatRegistry } from '../seats'
import type { SeatSpec, Vec2 } from '../types'
import type { PathwayState } from './pathway.machine'

export type BayState = 'free' | 'occupied' | 'needsCleaning'

export interface ErBay {
  /** 0-based; the text says "ER bay {index + 1}". */
  index: number
  seat: SeatSpec
  state: BayState
  caseId: string | null
  cleanerId: string | null
  /** Sim time the current state began. */
  since: number
}

export interface TriageBay {
  index: number
  seat: SeatSpec
  state: 'free' | 'occupied'
  caseId: string | null
}

/** One patient as the department sees them. The patient's own controller keeps it up to date. */
export interface ErCase {
  id: string
  name: string
  reason: string
  /** True acuity 1 (most urgent) .. 5. */
  acuity: number
  ambulance: boolean
  /** A priority 1-2 walk-in: no kiosk and no triage queue; a nurse wheels them straight to a bay. */
  critical: boolean
  arrivedAt: number
  state: PathwayState
  /** Waiting and in a place a nurse can walk to (seated, or standing at the stretcher hold). */
  ready: boolean
  /** Sim time the patient became ready in the current waiting state (first come, first served). */
  readyAt: number
  nurseId: string | null
  doctorId: string | null
  /** The ER nurse doing the care step (observations, cannula, ECG, bedside bloods). */
  careBy: string | null
  porterId: string | null
  /** Index of the triage bay held, or -1. */
  triageBay: number
  /** Index of the ER bay held, or -1. */
  bay: number
  /** Lying on the trolley, waiting for the doctor. */
  onTrolley: boolean
  trolleyAt: number
  /** Ambulance patients only: the paramedics' handover to an ER nurse. */
  handover: 'n/a' | 'wait' | 'doing' | 'done'
  handoverBy: string | null
  /** Where the patient is, to pick the nearest bay. */
  from: Vec2
}

export type Outcome = 'discharged' | 'admitted' | 'lwbs'

export interface FinishedCase {
  id: string
  outcome: Outcome
  acuity: number
  ambulance: boolean
  arrivedAt: number
  /** When the decision was made, or when the patient gave up. */
  endedAt: number
}

export function newCase(init: Pick<ErCase, 'id' | 'name' | 'reason' | 'acuity' | 'ambulance' | 'arrivedAt' | 'from'>): ErCase {
  return {
    ...init,
    critical: !init.ambulance && init.acuity <= 2,
    careBy: null,
    state: 'arriving',
    ready: false,
    readyAt: init.arrivedAt,
    nurseId: null,
    doctorId: null,
    porterId: null,
    triageBay: -1,
    bay: -1,
    onTrolley: false,
    trolleyAt: 0,
    handover: init.ambulance ? 'wait' : 'n/a',
    handoverBy: null,
  }
}

/** Ambulance and critical walk-in (priority 1-2) arrivals go ahead of everyone waiting. */
function tier(c: ErCase): number {
  return (c.ambulance || c.critical) && c.acuity <= 2 ? 0 : 1
}

/** Order for the next ER bay: preempting ambulances, then acuity, then arrival, then id (stable). */
export function bayOrder(a: ErCase, b: ErCase): number {
  return tier(a) - tier(b) || a.acuity - b.acuity || a.arrivedAt - b.arrivedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export class ErDepartment {
  readonly bays: ErBay[]
  readonly triageBays: TriageBay[]
  /** Insertion order is arrival order; iteration is deterministic. */
  readonly cases = new Map<string, ErCase>()
  /** Longest a bay has waited in needsCleaning (for the tests). */
  maxCleanWait = 0
  /** Every patient who has reached a terminal outcome, in order. */
  readonly finished: FinishedCase[] = []

  constructor(
    private readonly seats: SeatRegistry,
    private readonly log?: { bayFreed?: (bay: ErBay, t: number) => void },
  ) {
    this.bays = seats.all
      .filter((s) => s.kind === 'erBay')
      .map((seat, index) => ({ index, seat, state: 'free' as BayState, caseId: null, cleanerId: null, since: 0 }))
    this.triageBays = seats.all
      .filter((s) => s.kind === 'triageBay' && s.id.startsWith('triageBay:bay:'))
      .map((seat, index) => ({ index, seat, state: 'free' as const, caseId: null }))
  }

  add(c: ErCase): void {
    this.cases.set(c.id, c)
  }

  /** Forget a patient who is gone; frees anything they still hold. */
  remove(id: string): void {
    const c = this.cases.get(id)
    if (!c) return
    if (c.triageBay >= 0) this.releaseTriageBay(c)
    this.cases.delete(id)
  }

  // --- triage ------------------------------------------------------------------------------------

  /** The next patient for a triage nurse who works `allowed` bays, with one of those bays reserved for them. */
  claimTriage(nurseId: string, allowed: readonly number[]): { c: ErCase; bay: TriageBay } | null {
    const bay = allowed.map((i) => this.triageBays[i]).find((b) => b !== undefined && b.state === 'free')
    if (!bay) return null
    let best: ErCase | null = null
    for (const c of this.cases.values()) {
      if (c.state !== 'waitingTriage' || !c.ready || c.nurseId !== null) continue
      if (best === null || c.readyAt < best.readyAt) best = c
    }
    if (!best) return null
    if (!this.seats.claimId(bay.seat.id, best.id)) return null
    bay.state = 'occupied'
    bay.caseId = best.id
    best.nurseId = nurseId
    best.triageBay = bay.index
    return { c: best, bay }
  }

  releaseTriageBay(c: ErCase): void {
    const bay = this.triageBays[c.triageBay]
    if (!bay) return
    if (bay.caseId === c.id) {
      this.seats.release(bay.seat.id)
      bay.state = 'free'
      bay.caseId = null
    }
    c.triageBay = -1
    c.nurseId = null
  }

  // --- ER bays ------------------------------------------------------------------------------------

  get freeBays(): number {
    return this.bays.filter((b) => b.state === 'free').length
  }

  /**
   * Give every free bay to the best waiting patient (see `bayOrder`). Returns the patients who got one. A patient is
   * only a candidate once they are `ready` (seated in the waiting room, or held at the ambulance door).
   */
  assignBays(t: number): ErCase[] {
    const out: ErCase[] = []
    if (this.freeBays === 0) return out
    const waiting: ErCase[] = []
    for (const c of this.cases.values()) if (c.state === 'waitingDoctor' && c.ready && c.bay < 0) waiting.push(c)
    waiting.sort(bayOrder)
    for (const c of waiting) {
      let best: ErBay | null = null
      let bestD = Infinity
      for (const b of this.bays) {
        if (b.state !== 'free') continue
        const d = Math.hypot(b.seat.approach.x - c.from.x, b.seat.approach.z - c.from.z)
        if (d < bestD - 1e-9) {
          best = b
          bestD = d
        }
      }
      if (!best) break
      if (!this.occupyBay(c, best.index, t)) continue
      out.push(c)
    }
    return out
  }

  /**
   * Promise ER bay `index` to patient `c` from time `t`: claim its trolley seat and mark it occupied. False when the bay is not free or its
   * seat is taken. (The body of `assignBays` for one bay; S1 uses it to put a patient straight on a trolley at a warm start.)
   */
  occupyBay(c: ErCase, index: number, t: number): boolean {
    const bay = this.bays[index]
    if (!bay || bay.state !== 'free') return false
    if (!this.seats.claimId(bay.seat.id, c.id)) return false
    bay.state = 'occupied'
    bay.caseId = c.id
    bay.since = t
    c.bay = bay.index
    return true
  }

  /**
   * The next walk-in with a bay promised and no escort yet, with this nurse now assigned. `critical` picks only the priority 1-2 walk-ins (who
   * are wheeled in), `walking` only the others (who walk beside the nurse); `any` the best of both.
   */
  claimEscort(nurseId: string, kind: 'critical' | 'walking' | 'any' = 'any'): ErCase | null {
    let best: ErCase | null = null
    for (const c of this.cases.values()) {
      if (c.ambulance || c.state !== 'inBay.walking' || c.bay < 0 || c.nurseId !== null || !c.ready) continue
      if (kind === 'critical' && !c.critical) continue
      if (kind === 'walking' && c.critical) continue
      if (best === null || bayOrder(c, best) < 0) best = c
    }
    if (best) best.nurseId = nurseId
    return best
  }

  /** An ambulance patient on a trolley whose handover to a nurse has not started, oldest first. */
  claimHandover(nurseId: string): ErCase | null {
    let best: ErCase | null = null
    for (const c of this.cases.values()) {
      if (!c.ambulance || !c.onTrolley || c.handover !== 'wait' || c.handoverBy !== null) continue
      if (best === null || c.trolleyAt < best.trolleyAt) best = c
    }
    if (best) best.handoverBy = nurseId
    return best
  }

  /** Record a terminal outcome (once per patient). */
  finish(c: ErCase, outcome: Outcome, t: number): void {
    if (this.finished.some((f) => f.id === c.id)) return
    this.finished.push({ id: c.id, outcome, acuity: c.acuity, ambulance: c.ambulance, arrivedAt: c.arrivedAt, endedAt: t })
  }

  /**
   * The highest-priority patient lying on a trolley with no doctor yet and the nurse's care done (acuity, then who got there first). With
   * `maxAcuity`, only patients at least that urgent.
   */
  claimExam(doctorId: string, maxAcuity = 5): ErCase | null {
    let best: ErCase | null = null
    for (const c of this.cases.values()) {
      if (c.state !== 'inBay.waitingExam' || !c.onTrolley || c.doctorId !== null || c.acuity > maxAcuity) continue
      if (best === null || c.acuity < best.acuity || (c.acuity === best.acuity && c.trolleyAt < best.trolleyAt)) best = c
    }
    if (best) best.doctorId = doctorId
    return best
  }

  /** The most urgent patient on a trolley waiting for the nurse's care step (the ambulance handover, if any, is done). */
  claimCare(nurseId: string): ErCase | null {
    let best: ErCase | null = null
    for (const c of this.cases.values()) {
      if (c.state !== 'inBay.waitingCare' || !c.onTrolley || c.careBy !== null) continue
      if (c.ambulance && c.handover !== 'done') continue
      if (best === null || c.acuity < best.acuity || (c.acuity === best.acuity && c.trolleyAt < best.trolleyAt)) best = c
    }
    if (best) best.careBy = nurseId
    return best
  }

  /** The most urgent patient whose results are in and who waits for the doctor's review. */
  claimReview(doctorId: string): ErCase | null {
    let best: ErCase | null = null
    for (const c of this.cases.values()) {
      if (c.state !== 'inBay.waitingReview' || !c.onTrolley || c.doctorId !== null) continue
      if (best === null || c.acuity < best.acuity || (c.acuity === best.acuity && c.trolleyAt < best.trolleyAt)) best = c
    }
    if (best) best.doctorId = doctorId
    return best
  }

  /** The patient is off the trolley for good: the bay now needs cleaning. */
  vacate(c: ErCase, t: number): void {
    const bay = this.bays[c.bay]
    if (!bay || bay.caseId !== c.id) return
    this.seats.release(bay.seat.id)
    bay.state = 'needsCleaning'
    bay.caseId = null
    bay.cleanerId = null
    bay.since = t
    c.onTrolley = false
  }

  /** The bay that has waited longest for a cleaner, now yours. */
  claimClean(cleanerId: string): ErBay | null {
    let best: ErBay | null = null
    for (const b of this.bays) {
      if (b.state !== 'needsCleaning' || b.cleanerId !== null) continue
      if (best === null || b.since < best.since) best = b
    }
    if (best) best.cleanerId = cleanerId
    return best
  }

  finishClean(bay: ErBay, t: number): void {
    this.maxCleanWait = Math.max(this.maxCleanWait, t - bay.since)
    bay.state = 'free'
    bay.cleanerId = null
    bay.caseId = null
    bay.since = t
    this.log?.bayFreed?.(bay, t)
  }

  /** Called every step by the owner: tracks how long bays wait for cleaning. */
  trackCleaning(t: number): void {
    for (const b of this.bays) if (b.state === 'needsCleaning') this.maxCleanWait = Math.max(this.maxCleanWait, t - b.since)
  }
}
