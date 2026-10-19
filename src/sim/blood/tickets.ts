/**
 * Queue numbers for the draw centre. Booked outpatients get P001, P002 ... ; priority patients (ER patients, outpatients aged
 * `config.blood.priorityAge` or more) get V001 ... . Call order: V before P, then first come (ticket issue order). A ticket is only
 * callable when its holder is present and its labelled tray is ready (the book itself knows nothing of robots or the nurse: the draw centre
 * passes the free-robot test in).
 */
import type { DrawTicket, TicketClass, TubeKind } from '../types'
import type { DrawSubject } from './subject'

/** One ticket and everything the draw centre holds about it. `ticket` is the contract object the screens read (mutated in place). */
export interface DrawEntry {
  ticket: DrawTicket
  subject: DrawSubject
  kind: 'outpatient' | 'er' | 'demo'
  /** Issue order across both classes (first come, first served). */
  seq: number
  /** The holder is at the draw centre (checked in; an ER patient arrived by porter). */
  ready: boolean
  readyAt: number
  /** The labelled tray is in the prep machine's output rack. */
  trayReady: boolean
  /** The lab order's tubes, in order of draw. */
  tubes: TubeKind[]
  sampleIds: string[]
  /** Seconds the holder waited from ready to the call (set when called). */
  waited: number | null
  /** The patient was drawn by the nurse (set when the draw ends). */
  drawnBy: 'robot' | 'nurse' | null
}

export function ticketId(cls: TicketClass, n: number): string {
  return `${cls}${String(n).padStart(3, '0')}`
}

/** V before P, then the order issued. */
export function callOrder(a: DrawEntry, b: DrawEntry): number {
  const ca = a.ticket.cls === 'V' ? 0 : 1
  const cb = b.ticket.cls === 'V' ? 0 : 1
  return ca - cb || a.seq - b.seq
}

export class TicketBook {
  private seq = 0
  private readonly counters: Record<TicketClass, number> = { P: 0, V: 0 }
  /** Entries still waiting to be called, in call order. */
  readonly waiting: DrawEntry[] = []
  /** Every entry whose ticket is not done yet (waiting, called, drawing), by ticket id. */
  readonly open = new Map<string, DrawEntry>()
  /** Every ticket ever issued, in order (tests read it). */
  readonly history: DrawTicket[] = []

  /** Start the day's numbers at a point other than 001 (a warm start at a later hour). */
  setCounters(p: number, v: number): void {
    this.counters.P = p
    this.counters.V = v
  }

  get issued(): { P: number; V: number } {
    return { ...this.counters }
  }

  /** The next number of a class without issuing it (for the player's ticket). */
  nextNumber(cls: TicketClass): string {
    return ticketId(cls, ++this.counters[cls])
  }

  issue(init: { cls: TicketClass; patientId: string; patientName: string; orderId: string; t: number; subject: DrawSubject; kind: DrawEntry['kind']; ready: boolean }): DrawEntry {
    const id = ticketId(init.cls, ++this.counters[init.cls])
    const ticket: DrawTicket = {
      id,
      cls: init.cls,
      patientId: init.patientId,
      patientName: init.patientName,
      orderId: init.orderId,
      issuedAt: init.t,
      calledAt: null,
      station: null,
      state: 'waiting',
    }
    const entry: DrawEntry = {
      ticket,
      subject: init.subject,
      kind: init.kind,
      seq: ++this.seq,
      ready: init.ready,
      readyAt: init.ready ? init.t : Number.NaN,
      trayReady: false,
      tubes: [],
      sampleIds: [],
      waited: null,
      drawnBy: null,
    }
    this.history.push(ticket)
    this.open.set(id, entry)
    // keep `waiting` sorted by call order (a new V goes ahead of every P)
    let i = this.waiting.length
    while (i > 0 && callOrder(this.waiting[i - 1], entry) > 0) i--
    this.waiting.splice(i, 0, entry)
    return entry
  }

  /** The first entry in call order for which `callable` holds, or null. Does not remove it. */
  next(callable: (e: DrawEntry) => boolean): DrawEntry | null {
    for (const e of this.waiting) if (e.ready && e.trayReady && callable(e)) return e
    return null
  }

  /** Take an entry off the waiting list (it was called). */
  take(entry: DrawEntry): void {
    const i = this.waiting.indexOf(entry)
    if (i >= 0) this.waiting.splice(i, 1)
  }

  /** The ticket is finished: forget it from the open set. */
  close(entry: DrawEntry): void {
    this.open.delete(entry.ticket.id)
    this.take(entry)
  }
}
