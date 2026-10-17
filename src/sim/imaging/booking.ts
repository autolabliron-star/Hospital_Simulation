/**
 * The booking queue of one scanner: who is waiting for it, in what order. Pure and deterministic.
 *
 *   demo (the presenter's "start a scan now")  first
 *   ER requests                                 by acuity (1 = most urgent), then by when they were asked for
 *   outpatients                                 by appointment time
 *
 * A booking is only offered to the scanner once the person is `ready` (an outpatient who has checked in and sits in the
 * imaging hall; an ER patient is ready from the start because a porter fetches them; the demo patient is ready when they
 * appear).
 */
import type { Actor } from '../er/actor'
import type { ScannerState } from '../types'
import type { ImagingModality } from '../types'
import type { ScannerSites } from './sites'

export type BookingKind = 'er' | 'outpatient' | 'demo'

/** What the scanner needs from the person being scanned: an outpatient controller or an ER patient. */
export interface ScanSubject {
  readonly actor: Actor
  readonly id: string
  readonly name: string
  /** True for ER patients: a porter brings them to the table and takes them back. */
  readonly transported: boolean
  /** The scanner has taken this booking. Walk-ins wait to be called; an ER patient asks for a porter. */
  scanAssigned(sites: ScannerSites, state: ScannerState): void
  /** The radiographer has called the patient by name (walk-ins). */
  scanCalled(): void
  /** The last sequence is done: an ER patient asks for the ride back. */
  scanRequestReturn(): void
  /** The table is out and the patient may be collected (ER: SCAN_DONE; a porter loads them). */
  scanFinished(): void
  /** Walk-ins: the patient has been told to get off the table and go on with their day. */
  scanReleased(): void
  /** The report is ready. */
  reportReady(): void
}

export interface Booking {
  id: string
  kind: BookingKind
  modality: ImagingModality
  protocolId: string
  /** Human name of the protocol, e.g. "MRI lumbar spine". */
  protocolName: string
  patientId: string
  patientName: string
  /** ER: 1 (most urgent) .. 5; others 5. */
  acuity: number
  requestedAt: number
  /** Outpatients: the appointment (sim seconds); others: the request time. */
  apptAt: number
  ready: boolean
  state: 'waiting' | 'active' | 'done'
  subject: ScanSubject | null
}

const RANK: Record<BookingKind, number> = { demo: 0, er: 1, outpatient: 2 }

export function bookingOrder(a: Booking, b: Booking): number {
  if (a.kind !== b.kind) return RANK[a.kind] - RANK[b.kind]
  if (a.kind === 'er') return a.acuity - b.acuity || a.requestedAt - b.requestedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return a.apptAt - b.apptAt || a.requestedAt - b.requestedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export class BookingQueue {
  private readonly list: Booking[] = []

  constructor(readonly modality: ImagingModality) {}

  add(b: Booking): void {
    let i = this.list.length
    while (i > 0 && bookingOrder(this.list[i - 1], b) > 0) i--
    this.list.splice(i, 0, b)
  }

  remove(b: Booking): void {
    const i = this.list.indexOf(b)
    if (i >= 0) this.list.splice(i, 1)
  }

  /** Everyone waiting, in order. */
  get waiting(): readonly Booking[] {
    return this.list
  }

  get length(): number {
    return this.list.length
  }

  /** The best booking whose person is ready (the demo booking is offered even before the patient appears). */
  next(): Booking | null {
    for (const b of this.list) if (b.ready) return b
    return null
  }
}
