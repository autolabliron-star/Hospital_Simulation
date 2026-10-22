/**
 * The pharmacist's allergy query (patient record): an order for a medicine of the class of a recorded allergy is held with an "allergy" query,
 * listed first, and nothing is verified, picked or delivered until the presenter confirms or cancels it.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { EventLog } from '../events'
import { patientHistory } from '../records/history'
import { PATIENTS } from '@/content/catalogue'
import { MedSystem, type Occupancy } from './system'

const DT = CONFIG.sim.step

function world(occupancy?: Occupancy) {
  const log = new EventLog()
  const meds = new MedSystem(log, { name: (id) => `Staff ${id}` })
  if (occupancy) meds.setOccupancy(occupancy)
  let t = 0
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      t += DT
      meds.step(DT, t)
    }
  }
  return { log, meds, run }
}

const presenter = (meds: MedSystem, roomId: string, ...medIds: string[]) =>
  meds.prescribe({ roomId, items: medIds.map((medId) => ({ medId, qty: 1 })), prescriberId: 'presenter', source: 'presenter' })

describe('the allergy query', () => {
  it('A2 has a recorded penicillin allergy: amoxicillin is queried as an allergy, first, and held', () => {
    const a2 = PATIENTS.find((p) => p.id === 'pt-A2')!
    expect(patientHistory(a2).allergies[0].classId).toBe('penicillin')
    const w = world()
    const r = presenter(w.meds, 'A2', 'amoxicillin')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.query?.status).toBe('open')
    expect(r.query?.reasons[0]).toMatchObject({ kind: 'allergy', medId: 'amoxicillin', id: 'allergy-penicillin' })
    expect(r.query?.reasons[0].text).toMatch(/^ALLERGY: Bruno Varga has a recorded Penicillin allergy \(rash, mild\)\. Amoxicillin is a penicillin\./)
    // held: never verified or loaded while the query is open
    w.run(600)
    expect(r.order.stage).toBe('prescribed')
    expect(w.log.events.some((e) => e.type === 'orderVerified' && e.orderId === r.order.id)).toBe(false)
    expect(w.meds.drawers.get('A2')!.state).toBe('empty')
  })

  it('a cancelled allergy query never dispenses; a confirmed one goes on like any order', () => {
    const w = world()
    const r = presenter(w.meds, 'A2', 'amoxicillin')
    if (!r.ok) throw new Error('not ok')
    expect(w.meds.cancelQuery(r.order.id)).toBe(true)
    w.run(900)
    expect(r.order.cancelledAt).toBeDefined()
    expect(r.order.stage).toBe('prescribed')
    expect(w.meds.drawers.get('A2')!.items).toHaveLength(0)

    const w2 = world()
    const r2 = presenter(w2.meds, 'A2', 'amoxicillin')
    if (!r2.ok) throw new Error('not ok')
    expect(w2.meds.confirmQuery(r2.order.id)).toBe(true)
    w2.run(900)
    expect(['verified', 'picking', 'enRoute', 'inDrawer']).toContain(r2.order.stage)
  })

  it('a medicine the patient is not allergic to is not queried for an allergy', () => {
    const w = world()
    const r = presenter(w.meds, 'A2', 'paracetamol')
    expect(r.ok && r.query).toBeFalsy()
  })

  it('reads the allergies of the patient in the bed from the bed board, not the catalogue', () => {
    // a new admission in A2 who is not the catalogue's Bruno Varga: their own record decides
    const occupant = { id: 'er-99', name: 'Ines Moro', age: 40, reason: 'Allergic reaction, observed after treatment', usualMeds: ['cetirizine'] }
    const w = world({ occupantOf: () => ({ id: occupant.id, name: occupant.name }), recordOf: () => occupant })
    const blocked = patientHistory(occupant).allergies.some((a) => a.classId === 'penicillin')
    const r = presenter(w.meds, 'A2', 'amoxicillin')
    if (!r.ok) throw new Error('not ok')
    expect(r.query?.reasons.some((x) => x.kind === 'allergy') ?? false).toBe(blocked)
  })
})
