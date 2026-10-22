/**
 * MedSystem: the medicine pipeline end to end.
 *
 *   prescribe ─▶ pharmacist verifies ─▶ a pod from the rank drives to a free dock port ─▶ the MedVend
 *   picker drops each pack into the pod ─▶ the pod seals and drives the ward circuit to the room ─▶ it
 *   loads that room's MedDrawer ─▶ returns to charge ─▶ a nurse is sent when the dose is due ─▶ given.
 *
 * Owns orders, pods (via PodFleet), the two dispensers and the drawers. The pods hang from the ceiling rail (W2) and never
 * wait for people, so nothing here depends on where people are. People (doctors,
 * nurses, pharmacists) are driven by the Simulation and call in through `prescribe`, `dueDrawers`, `claim`
 * and `give`. Every transition writes one SimEvent with a plain sentence.
 *
 * F-25: the presenter's own orders are checked by the pharmacist for a duplicate (already ordered, or inside the dosing interval) and
 * for the demo catalogue's clear interactions (src/content/pharmacistQueries.json). A queried order is held at 'prescribed': it is not
 * verified, picked or sent until the presenter confirms it (`confirmQuery`) or cancels it (`cancelQuery`). The sim decides nothing
 * clinical: it only raises the query, and nothing resolves it but the presenter (or the patient leaving the bed, which cancels it).
 *
 * Patient record: a presenter order for a medicine of the class of a recorded allergy or intolerance (amoxicillin with a penicillin allergy) raises
 * an "allergy" query, listed first, through the same hold: nothing is dispensed until the presenter confirms or cancels.
 */
import { medicineById, minDoseGapSeconds, PATIENTS, patientInRoom } from '@/content/catalogue'
import { findAllergyConflicts, findInteractions, fillQuery, PHARMACIST_QUERIES, type QueryReason } from '@/content/pharmacistQueries'
import { CONFIG } from '../config'
import type { EventLog } from '../events'
import { allergiesOf } from '../records/history'
import { ROOMS, roomById } from '../places'
import type { Drawer, Order, OrderItem, OrderStage, RoomId, WardId } from '../types'
import { CIRCUITS, drawerS } from './circuit'
import { Dispenser, type DispenseJob } from './dispenser'
import { PodFleet, type Driver } from './pods'

export interface PrescribeInput {
  roomId: RoomId
  items: OrderItem[]
  prescriberId: string
  source: Order['source']
  /** Defaults: presenter orders are due now, rounds orders after `roundDoseDelaySeconds`. */
  doseAt?: number
}

/** A pharmacist's query on a presenter order: why it is held, and how it was settled. */
export interface PharmacistQuery {
  orderId: string
  roomId: RoomId
  patientName: string
  medIds: string[]
  reasons: QueryReason[]
  raisedAt: number
  status: 'open' | 'confirmed' | 'cancelled'
  resolvedAt?: number
}

/** `query` is set when the pharmacist queried the order: it is held (not dispensed) until the presenter confirms or cancels it. */
export type PrescribeResult = { ok: true; order: Order; query?: PharmacistQuery } | { ok: false; reason: string }

export interface StaffNames {
  name(actorId: string): string
}

/**
 * Who lies in a room right now (L1). The bed board answers it; a MedSystem built on its own (the meds tests) has no
 * lookup and uses the fixed catalogue's patient of the room.
 */
export interface Occupancy {
  occupantOf(roomId: RoomId): { id: string; name: string } | null
  /**
   * The ward record of the patient in the bed (their reason for the stay and usual medicines, and their age), for the pharmacist's checks. The
   * allergy check draws the patient's recorded allergies from it (src/sim/records/history.ts).
   */
  recordOf?(roomId: RoomId): { reason: string; usualMeds: readonly string[]; age?: number } | null
}

/** Per-pod job memory. */
interface PodJob {
  order: Order
  dock: number
  sealTimer: number
  deliverTimer: number
  undockTimer: number
  transferred: boolean
}

const WARD_IDS: WardId[] = ['A', 'B']

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export class MedSystem {
  readonly orders = new Map<string, Order>()
  readonly fleet = new PodFleet()
  readonly dispensers: Record<WardId, Dispenser>
  readonly drawers = new Map<RoomId, Drawer>()
  /** Pharmacist actor per ward (for event text); set by the Simulation. */
  pharmacist: Record<WardId, string> = { A: 'pharmacist-A', B: 'pharmacist-B' }

  private now = 0
  private orderSeq = 0
  private readonly verifyQueue: Record<WardId, Order[]> = { A: [], B: [] }
  private readonly verifying: Record<WardId, { order: Order; timer: number } | null> = { A: null, B: null }
  private readonly readyQueue: Record<WardId, Order[]> = { A: [], B: [] }
  private readonly jobs = new Map<string, PodJob>()
  private readonly green = new Map<string, number>()
  private readonly claims = new Map<RoomId, string>()
  private occupancy: Occupancy | null = null
  /** Every order written for a patient (the dose ledger: no duplicate pending order, no dose inside the dosing interval). */
  private readonly byPatient = new Map<string, Order[]>()
  /** The patient's name at the time each order was written (the bed may hold somebody else by the time it is delivered). */
  private readonly patientNames = new Map<string, string>()
  /** Every pharmacist query raised, by order id (open ones hold their order). */
  private readonly queries = new Map<string, PharmacistQuery>()

  constructor(
    private readonly log: EventLog,
    private readonly staff: StaffNames,
  ) {
    this.dispensers = {
      A: new Dispenser('A', this.dispenserHooks()),
      B: new Dispenser('B', this.dispenserHooks()),
    }
    for (const r of ROOMS) this.drawers.set(r.id, { roomId: r.id, state: 'empty', orderIds: [], items: [], lightOn: false })
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  /** Set the clock before the first step (a warm start at a later hour writes orders at that hour, not at 07:30). */
  syncClock(now: number): void {
    this.now = now
  }

  /** Take the patient of each room from the bed board (L1) instead of the fixed catalogue; null goes back to the catalogue. */
  setOccupancy(o: Occupancy | null): void {
    this.occupancy = o
  }

  /** The patient lying in the room now: from the bed board, or the catalogue's when there is none. */
  occupant(roomId: RoomId): { id: string; name: string } | null {
    return this.occupancy ? this.occupancy.occupantOf(roomId) : patientInRoom(roomId)
  }

  /**
   * A patient has left the bed (L1): whatever is in the room's drawer is never given. Orders still on their way are
   * cancelled when they reach a step where the patient is checked (before picking, and on delivery).
   */
  releaseRoom(roomId: RoomId): void {
    const d = this.drawers.get(roomId)
    if (d && d.state === 'loaded') {
      for (const id of d.orderIds) {
        const o = this.orders.get(id)
        if (o && o.stage !== 'given') o.cancelledAt = this.now
      }
      d.state = 'empty'
      d.orderIds = []
      d.items = []
      d.loadedAt = undefined
      d.lightOn = false
    }
    this.claims.delete(roomId)
  }

  prescribe(input: PrescribeInput): PrescribeResult {
    let room
    try {
      room = roomById(input.roomId)
    } catch {
      return { ok: false, reason: `Unknown room ${input.roomId}` }
    }
    if (input.items.length === 0) return { ok: false, reason: 'Pick at least one medicine.' }
    if (input.items.length > CONFIG.orders.maxItems) return { ok: false, reason: `A pod carries at most ${CONFIG.orders.maxItems} packs per order.` }
    const seen = new Set<string>()
    for (const it of input.items) {
      try {
        medicineById(it.medId)
      } catch {
        return { ok: false, reason: `Unknown medicine ${it.medId}` }
      }
      if (seen.has(it.medId)) return { ok: false, reason: 'Each medicine once per order.' }
      if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 3) return { ok: false, reason: 'Quantity must be 1 to 3.' }
      seen.add(it.medId)
    }
    const patient = this.occupant(room.id)
    if (patient === null) return { ok: false, reason: `Room ${room.id} has no patient in it right now.` }
    const doseAt = input.doseAt ?? (input.source === 'presenter' ? this.now : this.now + CONFIG.orders.roundDoseDelaySeconds)
    const history = this.byPatient.get(patient.id)
    let items = input.items
    // Wave 1: the doctors' orders and the dose waves never duplicate a medicine that is pending for the patient, nor give one
    // inside its dosing interval. The presenter's own orders and the take-home supply are not held back.
    if (input.source === 'sim' || input.source === 'schedule') {
      items = input.items.filter((it) => !this.dosedRecently(history, it.medId, doseAt))
      if (items.length === 0) return { ok: false, reason: 'Already ordered or given recently.' }
    }
    const reasons = input.source === 'presenter' ? this.queryReasons(patient, room.id, items, history, doseAt) : []
    const order: Order = {
      id: `ord-${++this.orderSeq}`,
      ward: room.ward,
      roomId: room.id,
      patientId: patient.id,
      items: items.map((i) => ({ ...i })),
      prescriberId: input.prescriberId,
      source: input.source,
      createdAt: this.now,
      doseAt,
      stage: 'prescribed',
      stageAt: { prescribed: this.now },
    }
    this.orders.set(order.id, order)
    if (history) history.push(order)
    else this.byPatient.set(patient.id, [order])
    this.patientNames.set(order.id, patient.name)
    let query: PharmacistQuery | undefined
    if (reasons.length > 0) {
      // held for the presenter: the pharmacist's query comes before anything is checked, picked or sent
      query = {
        orderId: order.id,
        roomId: room.id,
        patientName: patient.name,
        medIds: items.map((i) => i.medId),
        reasons,
        raisedAt: this.now,
        status: 'open',
      }
      this.queries.set(order.id, query)
    } else if (input.source === 'presenter') {
      // the presenter's own order is checked before the ward's scheduled backlog (a dose wave of sixteen orders must not hold it up)
      this.verifyQueue[room.ward].unshift(order)
    } else this.verifyQueue[room.ward].push(order)
    const who = input.source === 'presenter' ? 'You' : this.staff.name(input.prescriberId)
    const text =
      input.source === 'presenter'
        ? `${who} prescribed ${plural(order.items.length, 'medicine')} for ${patient.name} in ${room.id} from the doctor's tablet.`
        : input.source === 'discharge'
          ? `${who} prescribed ${plural(order.items.length, 'take-home medicine')} for ${patient.name} in ${room.id}.`
          : `${who} prescribed ${plural(order.items.length, 'medicine')} for ${patient.name} in ${room.id}.`
    this.log.push(this.now, 'orderCreated', text, { orderId: order.id, roomId: room.id, actorId: input.prescriberId })
    if (query) {
      const pharmacist = this.staff.name(this.pharmacist[room.ward])
      this.log.push(this.now, 'orderCreated', `${pharmacist} queried the order for ${room.id}: ${reasons.map((r) => r.text.replace(/^Queried: /, '')).join(' ')} It is held until you confirm or cancel it.`, {
        orderId: order.id,
        roomId: room.id,
        actorId: this.pharmacist[room.ward],
      })
    }
    return query ? { ok: true, order, query } : { ok: true, order }
  }

  /** The query on an order (open or settled), if the pharmacist raised one. */
  queryOf(orderId: string): PharmacistQuery | undefined {
    return this.queries.get(orderId)
  }

  /** Queries still waiting for the presenter, oldest first. */
  openQueries(): PharmacistQuery[] {
    const out: PharmacistQuery[] = []
    for (const q of this.queries.values()) if (q.status === 'open') out.push(q)
    return out
  }

  /** The presenter confirms a queried order: it goes to the pharmacist's verification like any other, ahead of the backlog. */
  confirmQuery(orderId: string): boolean {
    const q = this.queries.get(orderId)
    const order = this.orders.get(orderId)
    if (!q || !order || q.status !== 'open') return false
    q.status = 'confirmed'
    q.resolvedAt = this.now
    if (this.isStale(order)) {
      this.cancel(order)
      return true
    }
    this.verifyQueue[order.ward].unshift(order)
    this.log.push(this.now, 'orderCreated', `You confirmed the queried order for ${order.roomId}; it goes to the pharmacist to check.`, {
      orderId,
      roomId: order.roomId,
      actorId: order.prescriberId,
    })
    return true
  }

  /** The presenter cancels a queried order: nothing is dispensed. */
  cancelQuery(orderId: string): boolean {
    const q = this.queries.get(orderId)
    const order = this.orders.get(orderId)
    if (!q || !order || q.status !== 'open') return false
    q.status = 'cancelled'
    q.resolvedAt = this.now
    this.cancel(order)
    this.log.push(this.now, 'orderCreated', `You cancelled the queried order for ${order.roomId}; nothing will be dispensed.`, {
      orderId,
      roomId: order.roomId,
      actorId: order.prescriberId,
    })
    return true
  }

  /**
   * What the pharmacist queries about a new presenter order: a medicine already ordered or too soon after the last dose, and the
   * demo catalogue's interactions with the patient's chart, their open orders and the reason for their stay.
   */
  private queryReasons(
    patient: { id: string; name: string },
    roomId: RoomId,
    items: OrderItem[],
    history: Order[] | undefined,
    doseAt: number,
  ): QueryReason[] {
    const out: QueryReason[] = []
    for (const it of items) {
      const kind = this.duplicateKind(history, it.medId, doseAt)
      if (kind === null) continue
      const med = medicineById(it.medId)
      const hours = Math.round((minDoseGapSeconds(it.medId) / 3600) * 10) / 10
      out.push({
        id: `duplicate-${kind}`,
        kind: 'duplicate',
        medId: it.medId,
        text: fillQuery(PHARMACIST_QUERIES.duplicate[kind], { med: `${med.name} ${med.strength}`, patient: patient.name, hours }),
      })
    }
    const record = this.occupancy?.recordOf?.(roomId) ?? PATIENTS.find((p) => p.id === patient.id) ?? null
    // the allergy check comes first: the patient record's allergies (a pure draw from the patient, src/sim/records/history.ts)
    const allergies = allergiesOf({
      id: patient.id,
      name: patient.name,
      age: record?.age ?? 60,
      reason: record?.reason ?? '',
      usualMeds: record?.usualMeds ?? [],
    })
    out.unshift(...findAllergyConflicts(items.map((i) => i.medId), allergies, patient.name))
    const patientMeds = new Set<string>(record?.usualMeds ?? [])
    for (const o of history ?? []) {
      if (o.cancelledAt !== undefined || o.source === 'discharge' || o.createdAt < this.now - 24 * 3600) continue
      for (const i of o.items) patientMeds.add(i.medId)
    }
    out.push(...findInteractions({ orderMeds: items.map((i) => i.medId), patientMeds, condition: record?.reason ?? '' }))
    return out
  }

  /** Would a doctor's or scheduled order for this medicine in this room be held back now (pending, or inside its dosing interval)? */
  pendingFor(roomId: RoomId, medId: string): boolean {
    const p = this.occupant(roomId)
    if (!p) return true
    return this.dosedRecently(this.byPatient.get(p.id), medId, this.now + CONFIG.orders.roundDoseDelaySeconds)
  }

  /** Was this medicine ordered for the patient, not yet given, or due within its dosing interval of `doseAt`? */
  private dosedRecently(history: Order[] | undefined, medId: string, doseAt: number): boolean {
    return this.duplicateKind(history, medId, doseAt) !== null
  }

  /** 'pending' when an order for the medicine has not been given yet, 'recent' when one was due inside its dosing interval. */
  private duplicateKind(history: Order[] | undefined, medId: string, doseAt: number): 'pending' | 'recent' | null {
    if (!history) return null
    const gap = minDoseGapSeconds(medId) - 60
    let kind: 'pending' | 'recent' | null = null
    for (const o of history) {
      if (o.cancelledAt !== undefined || o.source === 'discharge') continue
      if (!o.items.some((i) => i.medId === medId)) continue
      if (o.stage !== 'given') return 'pending'
      if (Math.abs(o.doseAt - doseAt) < gap) kind = 'recent'
    }
    return kind
  }

  /** Loaded drawers whose dose is due soon and that no nurse has claimed yet, most urgent first. */
  dueDrawers(ward: WardId): Drawer[] {
    const out: Drawer[] = []
    for (const r of ROOMS) {
      if (r.ward !== ward) continue
      const d = this.drawers.get(r.id)!
      if (d.state !== 'loaded' || this.claims.has(r.id)) continue
      if (this.earliestDose(d) - CONFIG.orders.nurseLeadSeconds <= this.now) out.push(d)
    }
    return out.sort((a, b) => this.earliestDose(a) - this.earliestDose(b))
  }

  claim(roomId: RoomId, nurseId: string): void {
    this.claims.set(roomId, nurseId)
    const d = this.drawers.get(roomId)!
    this.log.push(this.now, 'nurseNotified', `${this.staff.name(nurseId)} was notified: ${roomId}'s medicines are ready in the MedDrawer.`, {
      roomId,
      actorId: nurseId,
      orderId: d.orderIds[0],
    })
  }

  /** The nurse at the bedside opens the drawer: everything in it is given. */
  give(roomId: RoomId, nurseId: string): number {
    const d = this.drawers.get(roomId)!
    this.claims.delete(roomId)
    if (d.state !== 'loaded') return 0
    const count = d.items.length
    for (const id of d.orderIds) this.setStage(this.orders.get(id)!, 'given')
    const patientName = this.patientNames.get(d.orderIds[0]) ?? this.occupant(roomId)?.name ?? roomId
    this.log.push(
      this.now,
      'medsGiven',
      `${this.staff.name(nurseId)} gave ${plural(count, 'medicine')} to ${patientName} in ${roomId}, prepared and delivered automatically.`,
      { roomId, actorId: nurseId, orderId: d.orderIds[0] },
    )
    d.state = 'empty'
    d.orderIds = []
    d.items = []
    d.loadedAt = undefined
    d.lightOn = false
    return count
  }

  isClaimed(roomId: RoomId): boolean {
    return this.claims.has(roomId)
  }

  /** The pharmacist of this ward is checking an order right now. */
  isVerifying(w: WardId): boolean {
    return this.verifying[w] !== null
  }

  /** Orders waiting for (or in) verification, per ward. */
  verifyBacklog(w: WardId): number {
    return this.verifyQueue[w].length + (this.verifying[w] ? 1 : 0)
  }

  /** The order a pod is carrying or loading, if any. */
  jobOf(podId: string): Order | undefined {
    return this.jobs.get(podId)?.order
  }

  // -------------------------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------------------------

  /** Advance everything except people (the pods do not depend on them). */
  step(dt: number, now: number): void {
    this.now = now
    this.dropStaleQueries()
    for (const w of WARD_IDS) {
      this.stepVerification(w, dt)
      this.assignPods(w)
    }
    this.fleet.step(dt)
    for (const d of this.fleet.drivers) this.afterDrive(d, dt)
    for (const w of WARD_IDS) this.dispensers[w].step(dt)
    for (const d of this.drawers.values()) d.lightOn = d.state === 'loaded' && this.earliestDose(d) <= now
  }

  /** A held order whose patient has left the bed is cancelled: there is nobody to give it to. */
  private dropStaleQueries(): void {
    if (this.occupancy === null) return
    for (const q of this.queries.values()) {
      if (q.status !== 'open') continue
      const order = this.orders.get(q.orderId)!
      if (!this.isStale(order)) continue
      q.status = 'cancelled'
      q.resolvedAt = this.now
      this.cancel(order)
      this.log.push(this.now, 'orderCreated', `The queried order for ${q.roomId} was cancelled: ${q.patientName} has left the bed.`, {
        orderId: q.orderId,
        roomId: q.roomId,
      })
    }
  }

  private stepVerification(w: WardId, dt: number): void {
    let cur = this.verifying[w]
    if (!cur) {
      let next = this.verifyQueue[w].shift()
      // an order for a patient who has left the room is cancelled before anybody checks or picks it
      while (next && this.isStale(next)) {
        this.cancel(next)
        next = this.verifyQueue[w].shift()
      }
      if (!next) return
      cur = this.verifying[w] = { order: next, timer: CONFIG.pharmacy.verifySeconds }
    }
    cur.timer -= dt
    if (cur.timer > 0) return
    const o = cur.order
    this.verifying[w] = null
    if (this.isStale(o)) {
      this.cancel(o)
      return
    }
    this.setStage(o, 'verified')
    if (o.source === 'presenter') this.readyQueue[w].unshift(o)
    else this.readyQueue[w].push(o)
    this.log.push(this.now, 'orderVerified', `${this.staff.name(this.pharmacist[w])} verified the order for ${o.roomId}.`, {
      orderId: o.id,
      roomId: o.roomId,
      actorId: this.pharmacist[w],
    })
  }

  /** Hand verified orders to the front pod in the rank, when a dock port is reachable. */
  private assignPods(w: WardId): void {
    const c = CIRCUITS[w]
    const rankEnd = c.segments[0].len
    while (this.readyQueue[w].length > 0) {
      const busy = [false, false]
      for (const job of this.jobs.values()) {
        if (job.order.ward === w && (job.order.stage === 'verified' || job.order.stage === 'picking')) busy[job.dock] = true
      }
      // the pod reaches the far port only by passing the near one, so the near port must be free
      if (busy[0]) return
      const dock = busy[1] ? 0 : 1
      let pick: Driver | null = null
      for (const d of this.fleet.byWard[w]) {
        if (d.pod.state !== 'charging' || d.pod.s > rankEnd) continue
        if (!pick || d.pod.s > pick.pod.s) pick = d
      }
      if (!pick) return
      const order = this.readyQueue[w].shift()!
      if (this.isStale(order)) {
        this.cancel(order)
        continue
      }
      const pod = pick.pod
      pod.state = 'toDock'
      pod.orderId = order.id
      order.podId = pod.id
      pick.stopAt = c.docks[dock]
      this.jobs.set(pod.id, { order, dock, sealTimer: -1, deliverTimer: -1, undockTimer: -1, transferred: false })
      this.log.push(this.now, 'podAssigned', `Pod ${pod.id} is heading to the MedVend for ${order.roomId}'s order.`, {
        orderId: order.id,
        podId: pod.id,
        roomId: order.roomId,
      })
    }
  }

  private afterDrive(d: Driver, dt: number): void {
    const pod = d.pod
    const job = this.jobs.get(pod.id)
    const c = d.circuit

    switch (pod.state) {
      case 'toDock':
        if (d.arrived && job) {
          pod.state = 'loading'
          this.setStage(job.order, 'picking')
          this.log.push(this.now, 'podDocked', `Pod ${pod.id} docked at the MedVend.`, { podId: pod.id, orderId: job.order.id, roomId: job.order.roomId })
          this.dispensers[pod.ward].enqueue({ order: job.order, podId: pod.id, port: job.dock })
        }
        break
      case 'loading':
        if (job && job.sealTimer >= 0) {
          job.sealTimer -= dt
          if (job.sealTimer <= 0) {
            job.sealTimer = -1
            pod.state = 'enRoute'
            d.stopAt = drawerS(job.order.roomId)
            this.setStage(job.order, 'enRoute')
            this.log.push(this.now, 'podDeparted', `Pod ${pod.id} sealed its compartments and left for room ${job.order.roomId}.`, {
              podId: pod.id,
              orderId: job.order.id,
              roomId: job.order.roomId,
            })
          }
        }
        break
      case 'enRoute':
        if (d.arrived && job) {
          pod.state = 'delivering'
          job.deliverTimer = job.order.items.length * CONFIG.drawers.transferSecondsPerItem
          this.log.push(this.now, 'podArrived', `Pod ${pod.id} arrived at ${job.order.roomId}'s MedDrawer.`, {
            podId: pod.id,
            orderId: job.order.id,
            roomId: job.order.roomId,
          })
        }
        break
      case 'delivering':
        if (!job) break
        if (!job.transferred) {
          job.deliverTimer -= dt
          if (job.deliverTimer <= 0) {
            this.loadDrawer(job.order, pod.id)
            pod.compartments.fill(null)
            job.transferred = true
            job.undockTimer = CONFIG.drawers.undockSeconds
          }
        } else {
          job.undockTimer -= dt
          if (job.undockTimer <= 0) {
            this.jobs.delete(pod.id)
            pod.state = 'returning'
            pod.orderId = undefined
            d.stopAt = c.rankHead
            this.green.set(pod.id, CONFIG.pods.greenSeconds)
          }
        }
        break
      case 'returning':
        // back through the entry door: in the rank, charging again
        if (pod.s <= c.segments[0].len) {
          pod.state = 'charging'
          this.log.push(this.now, 'podReturned', `Pod ${pod.id} is back in the rank, charging.`, { podId: pod.id })
        }
        break
      case 'charging':
        pod.battery = Math.min(1, pod.battery + CONFIG.pods.chargePerSecond * dt)
        break
    }

    // light ring
    const g = (this.green.get(pod.id) ?? 0) - dt
    if (g > 0) this.green.set(pod.id, g)
    else this.green.delete(pod.id)
    const carrying = pod.compartments.some((m) => m !== null)
    // amber: held up behind the pod ahead on the rail (never for people: the pods ride above them); the idle queue in the rank stays white
    const held = pod.waitingFor === 'pod' && pod.state !== 'charging'
    pod.light = held ? 'amber' : g > 0 ? 'green' : carrying ? 'teal' : 'white'
  }

  private loadDrawer(order: Order, podId: string): void {
    const d = this.drawers.get(order.roomId)!
    // a drawer only ever holds its own room's patient's packs
    if (order.roomId !== d.roomId) throw new Error(`Order ${order.id} for ${order.roomId} delivered to ${d.roomId}`)
    // ... and only the packs of the patient who is in the bed now: a pod that arrives after the patient has gone takes its
    // packs back (the order is cancelled, nothing is loaded)
    if (this.isStale(order)) {
      this.cancel(order)
      return
    }
    d.state = 'loaded'
    d.orderIds.push(order.id)
    for (const it of order.items) d.items.push({ ...it })
    d.loadedAt ??= this.now
    this.setStage(order, 'inDrawer')
    const patientName = this.patientNames.get(order.id) ?? order.roomId
    this.log.push(
      this.now,
      'drawerLoaded',
      `${order.roomId}'s MedDrawer is loaded: ${plural(order.items.length, 'medicine')}, locked to ${patientName}'s wristband.`,
      { podId, orderId: order.id, roomId: order.roomId },
    )
  }

  private dispenserHooks() {
    return {
      binOf: (medId: string) => medicineById(medId).bin,
      onPicked: (job: DispenseJob, itemIndex: number) => {
        const pod = this.fleet.driverOf(job.podId).pod
        const slot = pod.compartments.indexOf(null)
        const item = job.order.items[itemIndex]
        if (slot >= 0) pod.compartments[slot] = item.medId
        const med = medicineById(item.medId)
        this.log.push(
          this.now,
          'itemPicked',
          `MedVend picked ${med.name} ${med.strength} for ${job.order.roomId} (${itemIndex + 1} of ${job.order.items.length}).`,
          { podId: job.podId, orderId: job.order.id, roomId: job.order.roomId },
        )
      },
      onJobDone: (job: DispenseJob) => {
        const j = this.jobs.get(job.podId)
        if (j) j.sealTimer = CONFIG.pharmacy.sealSeconds
      },
    }
  }

  /** Is the order's patient no longer the one in the bed? (Only with a bed board: the catalogue's patients never leave.) */
  private isStale(o: Order): boolean {
    if (this.occupancy === null || o.cancelledAt !== undefined) return o.cancelledAt !== undefined
    const cur = this.occupancy.occupantOf(o.roomId)
    return cur === null || cur.id !== o.patientId
  }

  private cancel(o: Order): void {
    o.cancelledAt ??= this.now
  }

  private setStage(o: Order, stage: OrderStage): void {
    o.stage = stage
    o.stageAt[stage] = this.now
  }

  private earliestDose(d: Drawer): number {
    let t = Infinity
    for (const id of d.orderIds) t = Math.min(t, this.orders.get(id)!.doseAt)
    return t
  }
}
