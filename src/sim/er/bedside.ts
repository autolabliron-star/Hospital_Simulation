/**
 * Wave 1: the ER bloods are taken at the bedside by the ER nurse and travel to the lab by pneumatic tube. This is the ER's side of the lab's
 * order intake: it creates the 'er' source order when the nurse draws, sends the tubes into the line from the manual send station, and tells
 * the patient when the lab has verified every test (the lab's `onOrderComplete`, chained so the draw centre's own hook keeps working).
 */
import type { Lab } from '../lab'
import { MANUAL_SEND_SOURCE } from '../pneumaticPath'
import type { LabOrder } from '../types'
import type { ErPatient } from './patient'
import type { World } from './world'

export class BedsideBloods {
  private readonly hooked = new WeakSet<Lab>()
  private readonly subjects = new Map<string, ErPatient>()
  /** Orders taken and tubes sent, for the tests. */
  ordered = 0
  sent = 0

  constructor(private readonly world: World) {}

  /** The nurse has drawn the patient's bloods: the lab has an order (stat) for the panel. Null when there is no lab. */
  order(p: ErPatient, panel: string): LabOrder | null {
    const lab = this.world.lab
    if (lab === null) return null
    this.hook(lab)
    const order = lab.order({ patientId: p.c.id, patientName: p.c.name, source: 'er', panel, priority: 'stat' })
    order.drawnBy = 'nurse'
    order.drawnAt = this.world.t
    this.subjects.set(order.id, p)
    this.ordered++
    return order
  }

  /** The tubes go into the pneumatic line (they fly, land and are sorted by the lab as any others). */
  send(order: LabOrder): void {
    const lab = this.world.lab
    if (lab === null) return
    for (const id of order.sampleIds) lab.send(id, MANUAL_SEND_SOURCE)
    this.sent++
  }

  private hook(lab: Lab): void {
    if (this.hooked.has(lab)) return
    this.hooked.add(lab)
    const previous = lab.onOrderComplete
    lab.onOrderComplete = (order) => {
      const p = this.subjects.get(order.id)
      if (p !== undefined) {
        this.subjects.delete(order.id)
        p.bloodsVerified()
      }
      previous?.(order)
    }
  }
}
