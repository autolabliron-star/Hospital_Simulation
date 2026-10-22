import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { EventLog } from '../events'
import { MedSystem, type Occupancy } from './system'

const DT = CONFIG.sim.step
const names = { name: (id: string) => `Staff ${id}` }

function world(occupancy?: Occupancy) {
  const log = new EventLog()
  const meds = new MedSystem(log, names)
  if (occupancy) meds.setOccupancy(occupancy)
  let t = 0
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      t += DT
      meds.step(DT, t)
    }
  }
  return { log, meds, run, now: () => t }
}

const presenter = (meds: MedSystem, roomId: string, ...medIds: string[]) =>
  meds.prescribe({ roomId, items: medIds.map((medId) => ({ medId, qty: 1 })), prescriberId: 'presenter', source: 'presenter' })

describe('the pharmacist queries a presenter order (F-25)', () => {
  it('a second paracetamol is queried; the first one is not', () => {
    const w = world()
    const first = presenter(w.meds, 'A1', 'paracetamol')
    expect(first.ok && first.query).toBeFalsy()
    const second = presenter(w.meds, 'A1', 'paracetamol')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.query?.status).toBe('open')
    expect(second.query?.reasons[0]).toMatchObject({ kind: 'duplicate', id: 'duplicate-pending' })
    expect(second.query?.reasons[0].text).toMatch(/^Queried: Paracetamol 500 mg is already ordered for Grace Adeyemi/)
  })

  it('five paracetamols in a row: only the first is sent on', () => {
    const w = world()
    for (let i = 0; i < 5; i++) presenter(w.meds, 'A1', 'paracetamol')
    expect(w.meds.openQueries()).toHaveLength(4)
    expect(w.meds.verifyBacklog('A')).toBe(1)
  })

  it('a dose given a moment ago is queried as too soon', () => {
    const w = world()
    const r = presenter(w.meds, 'A1', 'paracetamol')
    if (!r.ok) throw new Error('prescribe failed')
    w.meds.orders.get(r.order.id)!.stage = 'given'
    const again = presenter(w.meds, 'A1', 'paracetamol')
    expect(again.ok && again.query?.reasons[0].id).toBe('duplicate-recent')
    expect(again.ok && again.query?.reasons[0].text).toMatch(/within the last 4 hours/)
  })

  it('an NSAID for the apixaban bed (A4) is queried for bleeding', () => {
    const w = world()
    const r = presenter(w.meds, 'A4', 'ibuprofen')
    expect(r.ok && r.query?.reasons.map((x) => x.id)).toEqual(['nsaid-anticoagulant'])
  })

  it('an NSAID for the heart-failure bed (A2) is queried; paracetamol there is not', () => {
    const w = world()
    const r = presenter(w.meds, 'A2', 'ibuprofen')
    // A2 is on furosemide and has heart failure: both clear interactions are named
    expect(r.ok && r.query?.reasons.map((x) => x.id)).toEqual(['nsaid-heart-failure', 'nsaid-loop-diuretic'])
    expect(presenter(w.meds, 'A2', 'paracetamol').ok).toBe(true)
    expect(w.meds.openQueries()).toHaveLength(1)
  })

  it('a sensible single drug is not queried and flows as before', () => {
    const w = world()
    const r = presenter(w.meds, 'A3', 'cetirizine')
    expect(r.ok && r.query).toBeFalsy()
    expect(w.meds.openQueries()).toEqual([])
    expect(w.meds.verifyBacklog('A')).toBe(1)
  })

  it('a queried order is held: nothing is verified, picked or loaded until the presenter confirms', () => {
    const w = world()
    const r = presenter(w.meds, 'A4', 'ibuprofen')
    if (!r.ok) throw new Error('prescribe failed')
    w.run(600)
    const o = w.meds.orders.get(r.order.id)!
    expect(o.stage).toBe('prescribed')
    expect(o.podId).toBeUndefined()
    expect(o.cancelledAt).toBeUndefined()
    expect(w.meds.drawers.get('A4')!.state).toBe('empty')
    expect(w.meds.verifyBacklog('A')).toBe(0)
    expect(w.meds.openQueries().map((q) => q.orderId)).toEqual([r.order.id])
  })

  it('confirm sends it on to the drawer; the query is settled', () => {
    const w = world()
    const r = presenter(w.meds, 'A4', 'ibuprofen')
    if (!r.ok) throw new Error('prescribe failed')
    expect(w.meds.confirmQuery(r.order.id)).toBe(true)
    expect(w.meds.confirmQuery(r.order.id)).toBe(false)
    expect(w.meds.openQueries()).toEqual([])
    expect(w.meds.queryOf(r.order.id)?.status).toBe('confirmed')
    w.run(400)
    expect(w.meds.orders.get(r.order.id)!.stage).toBe('inDrawer')
    expect(w.meds.drawers.get('A4')!.state).toBe('loaded')
  })

  it('cancel keeps it from ever being dispensed', () => {
    const w = world()
    const r = presenter(w.meds, 'A4', 'ibuprofen')
    if (!r.ok) throw new Error('prescribe failed')
    expect(w.meds.cancelQuery(r.order.id)).toBe(true)
    expect(w.meds.confirmQuery(r.order.id)).toBe(false)
    w.run(600)
    const o = w.meds.orders.get(r.order.id)!
    expect(o.cancelledAt).toBeDefined()
    expect(o.stage).toBe('prescribed')
    expect(w.meds.drawers.get('A4')!.state).toBe('empty')
    expect(w.meds.queryOf(r.order.id)?.status).toBe('cancelled')
  })

  it('a queried order for a patient who has left the bed is cancelled by itself', () => {
    let here: { id: string; name: string } | null = { id: 'pt-A4', name: 'Walter Quinlan' }
    const w = world({ occupantOf: () => here })
    const r = presenter(w.meds, 'A4', 'ibuprofen')
    if (!r.ok) throw new Error('prescribe failed')
    here = null
    w.run(1)
    expect(w.meds.openQueries()).toEqual([])
    expect(w.meds.orders.get(r.order.id)!.cancelledAt).toBeDefined()
  })

  it('uses the bed board record when there is one (reason and usual medicines)', () => {
    const record = { reason: 'Heart failure, new admission', usualMeds: ['apixaban'] }
    const w = world({ occupantOf: () => ({ id: 'ward-9', name: 'Test Person' }), recordOf: () => record })
    const r = presenter(w.meds, 'A1', 'ibuprofen')
    expect(r.ok && r.query?.reasons.map((x) => x.id)).toEqual(['nsaid-anticoagulant', 'nsaid-heart-failure'])
  })

  it('the rounds and the dose waves are unchanged: they are never queried', () => {
    const w = world()
    const r = w.meds.prescribe({ roomId: 'A4', items: [{ medId: 'ibuprofen', qty: 1 }], prescriberId: 'doc', source: 'sim' })
    expect(r.ok && r.query).toBeFalsy()
  })

  it('is deterministic: the same orders give the same queries and events', () => {
    const play = () => {
      const w = world()
      presenter(w.meds, 'A1', 'paracetamol')
      presenter(w.meds, 'A1', 'paracetamol')
      presenter(w.meds, 'A4', 'ibuprofen', 'paracetamol')
      w.run(30)
      const q = w.meds.openQueries()
      w.meds.confirmQuery(q[0].orderId)
      w.meds.cancelQuery(q[1].orderId)
      w.run(300)
      return JSON.stringify({ q: w.meds.openQueries(), e: w.log.events, o: [...w.meds.orders.values()] })
    }
    expect(play()).toBe(play())
  })
})
