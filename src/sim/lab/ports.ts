/**
 * W4: the frozen interface of the automated lab (src/sim/lab), for the draw centre (orders and sends tubes) and the scene/UI. Contract glue,
 * owned by the orchestrator.
 */
import type { SampleBook } from '../samples'
import type { LabOrder, LabPriority, LabState } from '../types'

export interface NewLabOrder {
  patientId: string
  patientName: string
  source: LabOrder['source']
  panel: string
  priority: LabPriority
  ticket?: string | null
}

export interface LabPort {
  readonly state: LabState
  readonly samples: SampleBook
  /** Create an order and its labelled-to-be samples (one per tube kind, in the order of draw), stage 'ordered'. */
  order(input: NewLabOrder): LabOrder
  /** A drawn tube goes into the pneumatic tube from `source` (robots 0..2, manual send station 3). */
  send(sampleId: string, source: number): void
  ordersFor(patientId: string): readonly LabOrder[]
  orderById(orderId: string): LabOrder | undefined
  /** Called when every test of an order is verified (the ER patient gets REPORT_READY). */
  onOrderComplete: ((order: LabOrder) => void) | null
  /** The panel's "Send a sample now": a background sample flies in from the riser at once. */
  sendDemo(): void
}
