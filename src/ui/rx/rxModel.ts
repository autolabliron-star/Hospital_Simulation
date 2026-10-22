/**
 * The prescribing tablet's model (F-25): what each medicine row says (dose, route and frequency from the catalogue), what the
 * pharmacist's queries look like, and what a Send does. Pure functions over a small sim interface, so the node tests prove them.
 * The words are in src/content/pharmacistQueries.json and the presenter copy (src/content/presenter.json).
 */
import { MEDICINES, medicineById } from '@/content/catalogue'
import { fillQuery, frequencyText, PHARMACIST_QUERIES, routeText } from '@/content/pharmacistQueries'
import { fillPresenter, PRESENTER } from '@/content/presenter'
import type { PharmacistQuery, PrescribeResult } from '@/sim/meds/system'
import type { OrderItem } from '@/sim/types'

const UI = PHARMACIST_QUERIES.ui

/** One medicine row of the tablet. */
export interface MedRow {
  id: string
  name: string
  strength: string
  color: string
  /** "by mouth · four times a day (08:00, 12:00, 18:00, 22:00)": from the catalogue, never typed by the presenter. */
  plan: string
}

export function medRows(): MedRow[] {
  return MEDICINES.map((m) => ({
    id: m.id,
    name: m.name,
    strength: m.strength,
    color: m.color,
    plan: `${routeText(m)} · ${frequencyText(m)}`,
  }))
}

/** A pharmacist's query as the tablet shows it: plain strings (the tablet re-reads these at about 4 Hz). */
export interface QueryView {
  orderId: string
  roomId: string
  title: string
  meds: string
  reasons: string[]
  heldNote: string
}

export function queryView(q: PharmacistQuery): QueryView {
  return {
    orderId: q.orderId,
    roomId: q.roomId,
    title: fillQuery(UI.queryFor, { patient: q.patientName, room: q.roomId }),
    meds: q.medIds.map((id) => `${medicineById(id).name} ${medicineById(id).strength}`).join(', '),
    reasons: q.reasons.map((r) => r.text),
    heldNote: UI.heldNote,
  }
}

/** The queries waiting for the presenter, oldest first. */
export function queryViews(meds: { openQueries(): PharmacistQuery[] }): QueryView[] {
  return meds.openQueries().map(queryView)
}

/** The slice of the sim the tablet talks to. */
export interface RxSim {
  prescribe(roomId: string, items: OrderItem[]): PrescribeResult
  meds: {
    openQueries(): PharmacistQuery[]
    confirmQuery(orderId: string): boolean
    cancelQuery(orderId: string): boolean
  }
}

export type SendOutcome =
  | { kind: 'sent'; text: string }
  | { kind: 'queried'; text: string; orderId: string }
  | { kind: 'error'; text: string }

/** Send the picked medicines to a room. A queried order is held: the notice says so and the query card carries the decision. */
export function sendOrder(sim: RxSim, roomId: string, medIds: readonly string[]): SendOutcome {
  const result = sim.prescribe(
    roomId,
    medIds.map((medId) => ({ medId, qty: 1 })),
  )
  if (!result.ok) return { kind: 'error', text: result.reason }
  if (result.query) return { kind: 'queried', text: fillQuery(UI.queriedNotice, { room: roomId }), orderId: result.order.id }
  return { kind: 'sent', text: fillPresenter(PRESENTER.rx.sent, { room: roomId }) }
}

/** The presenter's decision on a queried order. */
export function decideQuery(sim: RxSim, query: Pick<QueryView, 'orderId' | 'roomId'>, decision: 'confirm' | 'cancel'): { ok: boolean; text: string } {
  const { orderId, roomId } = query
  if (decision === 'confirm') {
    const ok = sim.meds.confirmQuery(orderId)
    return { ok, text: ok ? fillQuery(UI.confirmedNotice, { room: roomId }) : '' }
  }
  const ok = sim.meds.cancelQuery(orderId)
  return { ok, text: ok ? fillQuery(UI.cancelledNotice, { room: roomId }) : '' }
}

/** The button words, from the content. */
export const RX_WORDS = { queryTitle: UI.queryTitle, confirm: UI.confirm, cancel: UI.cancel } as const
