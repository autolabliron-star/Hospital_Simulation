/**
 * Test helpers for the draw centre (not imported by the sim): a stand-in lab for tests that need orders to complete.
 *
 * Until the real lab (src/sim/lab) lands, the skeleton never completes an order, so the ER tests drive `world.lab.onOrderComplete`
 * themselves: `emulateLab` wraps `send`, and once every tube of an order has been sent it completes the order a fixed, seeded-by-id time
 * later. With the real lab present the same helper still works: it only adds the completion call (a second REPORT_READY is harmless).
 */
import { hashString } from '../rng'
import type { Simulation } from '../Simulation'
import type { LabOrder } from '../types'

export interface LabEmulator {
  /** Call every step (or every few): completes the orders that are due. */
  tick(): void
  readonly completed: LabOrder[]
  readonly pending: number
}

/** Complete each order `minutes[0]..minutes[1]` minutes after its last tube was sent (a stable spread per order id). */
export function emulateLab(sim: Simulation, minutes: readonly [number, number] = [18, 25]): LabEmulator {
  const lab = sim.lab
  const sent = new Map<string, number>()
  const due: { at: number; order: LabOrder }[] = []
  const completed: LabOrder[] = []
  const original = lab.send.bind(lab)
  lab.send = (sampleId: string, source: number) => {
    original(sampleId, source)
    const s = lab.samples.get(sampleId)
    if (!s) return
    if (s.stage === 'drawn') lab.samples.advance(sampleId, 'inTube', sim.t)
    const order = lab.orderById(s.orderId)
    if (!order) return
    const n = (sent.get(order.id) ?? 0) + 1
    sent.set(order.id, n)
    if (n !== order.sampleIds.length) return
    const spread = (hashString(order.id) % 1000) / 1000
    const at = sim.t + (minutes[0] + spread * (minutes[1] - minutes[0])) * 60
    let i = due.length
    while (i > 0 && due[i - 1].at > at) i--
    due.splice(i, 0, { at, order })
  }
  return {
    tick() {
      while (due.length > 0 && due[0].at <= sim.t) {
        const { order } = due.shift()!
        // the real lab (if it is there) may have completed this order already: then it has told the patient itself
        if (order.completeAt !== null) continue
        order.completeAt = sim.t
        completed.push(order)
        lab.onOrderComplete?.(order)
      }
    },
    completed,
    get pending() {
      return due.length
    },
  }
}
