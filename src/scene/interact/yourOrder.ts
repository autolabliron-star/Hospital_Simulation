/**
 * "Your order" (W1): the medicines you prescribed on the doctor's tablet (an order with source 'presenter', the sim calls it
 * "You"). While one is in flight the objective line follows it through the stages of the order rail:
 *
 *   prescribed  "Pharmacist Noa is checking your order for A3"
 *   verified    "Your order for A3 is checked and waiting for a pod"  ->  "Pod A1 is on its way to collect your order for A3"
 *   picking     "MedVend is loading your order into pod A1"
 *   enRoute     "Pod A1 is bringing your order to A3: about 2 min"
 *   inDrawer    "Your order is in A3's drawer"  (a nurse is on the way once one has been sent)
 *   given       "Given to Grace Adeyemi in A3"  for a few seconds, then the line clears
 *   cancelled   "Your order for A3 was cancelled: ..."  (the patient left before the pick)
 *
 * The tracker follows the newest unfinished presenter order (a newer one takes over at once); when it is done it moves on to the
 * next one still in flight. It reads the sim through `OrderHost`, so the text and the tracking are tested with fixture orders and
 * no Simulation. Polled at 4 Hz.
 */
import { staffName } from '@/content/staff'
import { WALK, fillWalk } from '@/content/walk'
import { CONFIG } from '@/sim/config'
import { CIRCUITS, drawerS, forward } from '@/sim/meds/circuit'
import type { Simulation } from '@/sim/Simulation'
import type { Order, OrderStage, Pod, WardId } from '@/sim/types'

/** How long "Given to ..." or "... was cancelled" stays before the line clears (real milliseconds). */
export const DONE_HOLD_MS = 6000

/** Under this many seconds the ETA says "under a minute". */
const MINUTE_ROUNDING_SECONDS = 45

export type ObjectiveStage = OrderStage | 'cancelled'

export type PodFacts = Pick<Pod, 'id' | 's' | 'state' | 'orderId'>

/** What the tracker needs from the world. */
export interface OrderHost {
  /** A real-time clock in milliseconds (the hold after "Given" is real time, not sim time). */
  now(): number
  order(id: string): Order | undefined
  /** The newest presenter order that is neither given nor cancelled. */
  newestOpen(): Order | undefined
  pod(id: string): PodFacts | undefined
  /** Seconds until this order's pod reaches the drawer, or null when it is not on the road. */
  etaSeconds(order: Order, pod: PodFacts): number | null
  /** The ward's pharmacist, as the event line names them ("Pharmacist Noa"). */
  pharmacist(ward: WardId): string
  /** Who is in the room's bed right now. */
  patient(roomId: string): string | null
  /** A nurse has been sent to this room's drawer. */
  nurseOnTheWay(roomId: string): boolean
}

export interface ObjectiveFacts {
  stage: ObjectiveStage
  room: string
  pod: string | null
  pharmacist: string
  patient: string
  etaSeconds: number | null
  nurseOnTheWay: boolean
}

/** "under a minute" or "about 2 min". */
export function etaText(seconds: number | null): string {
  if (seconds === null || seconds < MINUTE_ROUNDING_SECONDS) return WALK.eta.underMinute
  return fillWalk(WALK.eta.minutes, { n: Math.max(1, Math.round(seconds / 60)) })
}

/** The one objective sentence for an order at a stage. */
export function objectiveText(f: ObjectiveFacts): string {
  const o = WALK.objective
  const pod = f.pod ?? ''
  switch (f.stage) {
    case 'cancelled':
      return fillWalk(o.cancelled, { room: f.room })
    case 'given':
      return fillWalk(o.given, { patient: f.patient, room: f.room })
    case 'inDrawer':
      return fillWalk(f.nurseOnTheWay ? o.inDrawerNurse : o.inDrawer, { room: f.room })
    case 'enRoute':
      return fillWalk(o.enRoute, { pod, room: f.room, eta: etaText(f.etaSeconds) })
    case 'picking':
      return fillWalk(o.picking, { pod })
    case 'verified':
      return f.pod ? fillWalk(o.verifiedPod, { pod, room: f.room }) : fillWalk(o.verifiedWaiting, { room: f.room })
    case 'prescribed':
      return fillWalk(o.prescribed, { pharmacist: f.pharmacist, room: f.room })
  }
}

/** What the HUD and the minimap read about your order. */
export interface YourOrderView {
  orderId: string
  roomId: string
  ward: WardId
  stage: ObjectiveStage
  /** The pod that carries it (set from the moment one is assigned), or null. */
  podId: string | null
  /** The objective line. */
  text: string
}

export function isFinished(o: Order): boolean {
  return o.stage === 'given' || o.cancelledAt !== undefined
}

export class YourOrder {
  private id: string | null = null
  private patient = ''
  /** Real time the tracked order was first seen finished, or -1. */
  private doneAt = -1
  private view: YourOrderView | null = null

  /** Look at the world and return the line to show (null: nothing of yours is in flight). */
  poll(host: OrderHost): YourOrderView | null {
    const now = host.now()
    let order = this.id === null ? undefined : host.order(this.id)
    if (this.id !== null && order === undefined) this.drop()
    if (order !== undefined && isFinished(order)) {
      if (this.doneAt < 0) this.doneAt = now
      else if (now - this.doneAt >= DONE_HOLD_MS) {
        this.drop()
        order = undefined
      }
    }
    // a newer order of yours takes over at once (even from a finished one still on show); an older one waits its turn
    const next = host.newestOpen()
    if (next !== undefined && (order === undefined || (next.id !== order.id && next.createdAt >= order.createdAt))) {
      this.id = next.id
      this.doneAt = -1
      this.patient = host.patient(next.roomId) ?? next.roomId
      order = next
    }
    if (order === undefined) {
      this.view = null
      return null
    }
    const stage: ObjectiveStage = order.cancelledAt !== undefined ? 'cancelled' : order.stage
    const pod = order.podId === undefined ? undefined : host.pod(order.podId)
    const text = objectiveText({
      stage,
      room: order.roomId,
      pod: order.podId ?? null,
      pharmacist: host.pharmacist(order.ward),
      patient: this.patient,
      etaSeconds: pod ? host.etaSeconds(order, pod) : null,
      nurseOnTheWay: stage === 'inDrawer' && host.nurseOnTheWay(order.roomId),
    })
    const prev = this.view
    if (prev && prev.orderId === order.id && prev.stage === stage && prev.podId === (order.podId ?? null) && prev.text === text) return prev
    this.view = { orderId: order.id, roomId: order.roomId, ward: order.ward, stage, podId: order.podId ?? null, text }
    return this.view
  }

  /** The last polled view (the minimap reads it between polls). */
  current(): YourOrderView | null {
    return this.view
  }

  /** Forget everything (a Jump: the new hospital has none of your orders). */
  reset(): void {
    this.drop()
    this.view = null
  }

  private drop(): void {
    this.id = null
    this.doneAt = -1
    this.patient = ''
  }
}

/** Seconds until the pod reaches the room's drawer, from its place on the ward circuit and the corridor speed. */
export function podEtaSeconds(order: Pick<Order, 'ward' | 'roomId'>, pod: Pick<Pod, 's' | 'state'>): number | null {
  if (pod.state === 'delivering') return 0
  if (pod.state !== 'enRoute') return null
  const metres = forward(CIRCUITS[order.ward], pod.s, drawerS(order.roomId))
  return metres / CONFIG.pods.corridorSpeed
}

/** The host for the running hospital: `getSim` is the live binding, so a Jump needs nothing here. */
export function simOrderHost(getSim: () => Simulation, now: () => number = () => performance.now()): OrderHost {
  return {
    now,
    order: (id) => getSim().meds.orders.get(id),
    newestOpen: () => {
      let best: Order | undefined
      for (const o of getSim().meds.orders.values()) {
        if (o.source !== 'presenter' || isFinished(o)) continue
        if (best === undefined || o.createdAt >= best.createdAt) best = o
      }
      return best
    },
    pod: (id) => getSim().meds.fleet.drivers.find((d) => d.pod.id === id)?.pod,
    etaSeconds: podEtaSeconds,
    pharmacist: (ward) => staffName(getSim().meds.pharmacist[ward]),
    patient: (roomId) => getSim().meds.occupant(roomId)?.name ?? null,
    nurseOnTheWay: (roomId) => getSim().meds.isClaimed(roomId),
  }
}
