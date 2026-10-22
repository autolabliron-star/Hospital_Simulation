import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EventLog } from '@/sim/events'
import { MedSystem } from '@/sim/meds/system'
import { PrescribePanel } from './PrescribePanel'
import { decideQuery, medRows, queryViews, RX_WORDS, sendOrder, type RxSim } from './rxModel'

function rxSim(): { sim: RxSim; meds: MedSystem } {
  const meds = new MedSystem(new EventLog(), { name: (id) => id })
  return {
    meds,
    sim: { prescribe: (roomId, items) => meds.prescribe({ roomId, items, prescriberId: 'presenter', source: 'presenter' }), meds },
  }
}

describe('the tablet model', () => {
  it('every medicine row carries its route and frequency from the catalogue', () => {
    const rows = medRows()
    expect(rows).toHaveLength(18)
    const para = rows.find((r) => r.id === 'paracetamol')!
    expect(para).toMatchObject({ strength: '500 mg', plan: 'by mouth · four times a day (08:00, 12:00, 18:00, 22:00)' })
    expect(rows.find((r) => r.id === 'salbutamol')!.plan).toBe('inhaled · as needed, at least 4 hours apart')
  })

  it('a plain send says where it went and never shows an order id', () => {
    const { sim } = rxSim()
    const out = sendOrder(sim, 'A3', ['cetirizine'])
    expect(out).toEqual({ kind: 'sent', text: 'Order sent to A3.' })
    expect(out.text).not.toMatch(/ord-/)
  })

  it('a second paracetamol shows as a query in the model and does not dispense until decided', () => {
    const { sim, meds } = rxSim()
    expect(sendOrder(sim, 'A1', ['paracetamol']).kind).toBe('sent')
    const out = sendOrder(sim, 'A1', ['paracetamol'])
    expect(out.kind).toBe('queried')
    const views = queryViews(meds)
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ roomId: 'A1', title: 'Grace Adeyemi in A1', meds: 'Paracetamol 500 mg', heldNote: expect.stringContaining('Nothing is dispensed') })
    expect(views[0].reasons[0]).toMatch(/^Queried: Paracetamol 500 mg is already ordered/)
    expect(meds.verifyBacklog('A')).toBe(1) // only the first order waits for the pharmacist
    const done = decideQuery(sim, views[0], 'cancel')
    expect(done).toEqual({ ok: true, text: 'Order for A1 cancelled.' })
    expect(queryViews(meds)).toEqual([])
  })

  it('NSAID with apixaban is queried; confirming sends it on to the pharmacist', () => {
    const { sim, meds } = rxSim()
    expect(sendOrder(sim, 'A4', ['ibuprofen']).kind).toBe('queried')
    const [q] = queryViews(meds)
    expect(q.reasons.join(' ')).toMatch(/Apixaban/)
    expect(meds.verifyBacklog('A')).toBe(0)
    expect(decideQuery(sim, q, 'confirm').ok).toBe(true)
    expect(meds.verifyBacklog('A')).toBe(1)
    expect(decideQuery(sim, q, 'confirm')).toEqual({ ok: false, text: '' })
  })

  it('reports the sim error for an empty order', () => {
    const { sim } = rxSim()
    expect(sendOrder(sim, 'A1', [])).toEqual({ kind: 'error', text: 'Pick at least one medicine.' })
  })
})

describe('the tablet, rendered', () => {
  it('shows the dose line, the presenter label and no developer wording', () => {
    const out = renderToStaticMarkup(createElement(PrescribePanel, { onClose: () => undefined, initialRoom: 'A1', walk: false }))
    expect(out).toContain('Prescribe medicines')
    expect(out).toContain('by mouth · four times a day (08:00, 12:00, 18:00, 22:00)')
    expect(out).not.toMatch(/developer|ord-\d/i)
    expect(out).not.toContain(RX_WORDS.queryTitle) // nothing queried yet on a fresh sim
  })
})
