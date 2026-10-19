import { describe, expect, it } from 'vitest'
import { DRAW_CENTRE } from '../places'
import { binFor, PrepMachine } from './prep'
import type { DrawSubject } from './subject'
import { callOrder, TicketBook, ticketId, type DrawEntry } from './tickets'
import { Rng } from '../rng'

const subject = (id: string): DrawSubject => ({ id, name: id }) as unknown as DrawSubject

function issue(book: TicketBook, cls: 'P' | 'V', who: string, t: number, ready = true): DrawEntry {
  return book.issue({ cls, patientId: who, patientName: who, orderId: `L-${who}`, t, subject: subject(who), kind: 'outpatient', ready })
}

function callable(book: TicketBook, e: DrawEntry): DrawEntry {
  e.trayReady = true
  void book
  return e
}

describe('draw tickets', () => {
  it('numbers P and V separately: P001, P002 ... and V001 ...', () => {
    const book = new TicketBook()
    expect(issue(book, 'P', 'a', 1).ticket.id).toBe('P001')
    expect(issue(book, 'P', 'b', 2).ticket.id).toBe('P002')
    expect(issue(book, 'V', 'c', 3).ticket.id).toBe('V001')
    expect(issue(book, 'P', 'd', 4).ticket.id).toBe('P003')
    expect(ticketId('V', 12)).toBe('V012')
  })

  it('calls V before P, then first come', () => {
    const book = new TicketBook()
    const p1 = callable(book, issue(book, 'P', 'p1', 1))
    const p2 = callable(book, issue(book, 'P', 'p2', 2))
    const v1 = callable(book, issue(book, 'V', 'v1', 3))
    const v2 = callable(book, issue(book, 'V', 'v2', 4))
    const p3 = callable(book, issue(book, 'P', 'p3', 5))
    expect(book.waiting.map((e) => e.ticket.id)).toEqual(['V001', 'V002', 'P001', 'P002', 'P003'])
    const order: string[] = []
    for (;;) {
      const e = book.next(() => true)
      if (!e) break
      order.push(e.ticket.id)
      book.take(e)
    }
    expect(order).toEqual([v1.ticket.id, v2.ticket.id, p1.ticket.id, p2.ticket.id, p3.ticket.id])
    expect(callOrder(v1, p1)).toBeLessThan(0)
    expect(callOrder(p1, p2)).toBeLessThan(0)
  })

  it('a ticket is callable only when its holder is present and its tray is ready', () => {
    const book = new TicketBook()
    const er = issue(book, 'V', 'er', 1, false) // an ER patient still on the porter's way
    const p = issue(book, 'P', 'p', 2)
    expect(book.next(() => true)).toBeNull() // neither tray is ready
    p.trayReady = true
    expect(book.next(() => true)).toBe(p)
    er.trayReady = true
    expect(book.next(() => true)).toBe(p) // the V ticket is skipped while its holder is not here ...
    er.ready = true
    expect(book.next(() => true)).toBe(er) // ... and goes first as soon as they arrive
    expect(book.next((e) => e !== er)).toBe(p)
  })

  it('keeps open tickets by id until they are closed', () => {
    const book = new TicketBook()
    const e = issue(book, 'P', 'a', 1)
    expect(book.open.get('P001')).toBe(e)
    book.take(e)
    expect(book.waiting).toHaveLength(0)
    expect(book.open.has('P001')).toBe(true)
    book.close(e)
    expect(book.open.has('P001')).toBe(false)
    expect(book.history).toHaveLength(1)
  })

  it('a warm start numbers on from the day so far', () => {
    const book = new TicketBook()
    book.setCounters(41, 3)
    expect(issue(book, 'P', 'a', 1).ticket.id).toBe('P042')
    expect(issue(book, 'V', 'b', 2).ticket.id).toBe('V004')
    expect(book.nextNumber('P')).toBe('P043')
  })
})

describe('the tube-prep machine', () => {
  function make() {
    const ready: string[] = []
    const m = new PrepMachine(new Rng(3), { trayReady: (e) => ready.push(e.ticket.id) })
    return { m, ready }
  }
  const entry = (book: TicketBook, cls: 'P' | 'V', who: string, tubes: DrawEntry['tubes']): DrawEntry => {
    const e = issue(book, cls, who, 0)
    e.tubes = tubes
    return e
  }

  it('makes one tray per ticket in 10-12 s, picking each tube kind in turn, labelling, then the tray waits in the rack', () => {
    const { m, ready } = make()
    const book = new TicketBook()
    const e = entry(book, 'P', 'a', ['citrate', 'EDTA'])
    m.add(e)
    expect(m.state.queue).toBe(1)
    const bins = new Set<number>()
    const phases: string[] = []
    let t = 0
    while (ready.length === 0 && t < 30) {
      m.step(1 / 60)
      t += 1 / 60
      if (m.state.bin >= 0) bins.add(m.state.bin)
      if (phases[phases.length - 1] !== m.state.phase) phases.push(m.state.phase)
    }
    expect(t).toBeGreaterThanOrEqual(10)
    expect(t).toBeLessThanOrEqual(12.1)
    expect(phases).toEqual(['picking', 'labelling', 'output', 'idle'])
    // the gripper went to a citrate bin and to an EDTA bin (the colours the contract's bins hold), and only to those
    expect([...bins].map((b) => DRAW_CENTRE.prep.bins[b]).sort()).toEqual(['EDTA', 'citrate'])
    expect(m.state.rack).toEqual(['P001'])
    expect(m.state.traysToday).toBe(1)
    expect(m.state.phase).toBe('idle')
    expect(m.takeTray('P001')).toBe(true)
    expect(m.state.rack).toEqual([])
    expect(m.takeTray('P001')).toBe(false)
  })

  it('every tube kind has a bin of its colour, and a kind with several bins rotates through them', () => {
    for (const kind of ['citrate', 'serum', 'heparin', 'EDTA', 'fluoride'] as const) {
      const used = new Set<number>()
      for (let turn = 0; turn < 12; turn++) {
        const b = binFor(kind, turn)
        expect(DRAW_CENTRE.prep.bins[b]).toBe(kind)
        used.add(b)
      }
      expect(used.size).toBe(DRAW_CENTRE.prep.bins.filter((k) => k === kind).length)
    }
  })

  it('works its queue V first, then first come, and counts the patients waiting', () => {
    const { m, ready } = make()
    const book = new TicketBook()
    m.add(entry(book, 'P', 'a', ['EDTA']))
    m.add(entry(book, 'P', 'b', ['EDTA']))
    m.add(entry(book, 'V', 'c', ['EDTA']))
    expect(m.state.queue).toBe(3)
    for (let i = 0; i < 60 * 40; i++) m.step(1 / 60)
    expect(ready).toEqual(['V001', 'P001', 'P002'])
    expect(m.busy).toBe(false)
    expect(m.state.queue).toBe(0)
  })

  it('a demo job goes to the head of the queue', () => {
    const { m, ready } = make()
    const book = new TicketBook()
    m.add(entry(book, 'P', 'a', ['EDTA']))
    m.step(1 / 60) // a is now being made
    m.add(entry(book, 'P', 'b', ['EDTA']))
    m.add(entry(book, 'P', 'demo', ['EDTA']), true)
    for (let i = 0; i < 60 * 40; i++) m.step(1 / 60)
    expect(ready).toEqual(['P001', 'P003', 'P002'])
  })
})
