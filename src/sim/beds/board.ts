/**
 * The bed board: the lifecycle of the 16 ward beds and the bed manager's rules. Pure bookkeeping in sim time (the people
 * who walk, clean and carry are controllers that ask this board for their next job and tell it what they finished), so
 * every rule lives in one tested place (the pattern of er/department.ts).
 *
 *   occupied -> dischargeSigned -> leaving -> needsCleaning -> cleaning -> ready -> (reserved) -> occupied
 *
 * `rec.stage` is the bed's own lifecycle (never 'reserved'). A reservation sits on top of it: `RoomStatus.bed` shows
 * 'reserved' from the moment the bed manager assigns the bed to a named patient (even while a cleaner is still in the room),
 * and goes back to the stage when the reservation ends. The board writes `life.rooms` through `LivingDay.setBed` and
 * `world.wardPatients` (the patient lying in each bed), and nothing else writes them.
 *
 * Admission: the ER asks `requestBed`. A `ready` bed is given at once; a bed whose cleaning will be done within
 * CONFIG.beds.reserveWindowSeconds is reserved with the patient boarding in their ER bay (at most boardingMaxBays,
 * at most boardingMaxSeconds; then the reservation is dropped and the patient goes upstairs as before). Otherwise null.
 */
import { fillDayTemplate } from '@/content/day'
import { STAFF, staffName } from '@/content/staff'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import type { LivingDay } from '../life'
import type { MedSystem } from '../meds/system'
import { ROOMS, roomById } from '../places'
import type { Party } from '../population/visitor'
import type { Rng } from '../rng'
import type { BedState, RoomId, WardId } from '../types'
import { CLEANER_PICKUP_SECONDS, dischargePlans, type DischargePlan, type WardRecord } from './bedBook'
import type { Patient } from './inpatient'

/** A bed's own lifecycle stage ('reserved' is an overlay, see the module comment). */
export type BedStage = Exclude<BedState, 'reserved'>

export interface Reservation {
  caseId: string
  patientName: string
  /** The ER bay the patient waits in (seat id and 0-based index). */
  bayId: string
  bayIndex: number
  since: number
  /** True while the patient waits in the ER bay for a bed that is not ready (stops when the porter takes them). */
  boarding: boolean
}

export interface CleanJob {
  cleanerId: string | null
  /** How long the clean takes once the cleaner is in the room. */
  seconds: number
  started: boolean
  startedAt: number
  done: boolean
  doneAt: number
  linen: 'none' | 'asked' | 'claimed' | 'done'
}

export interface DischargeRun {
  plan: DischargePlan
  signedAt: number
  /** The take-home medicines order. */
  orderId: string | null
  /** Sim time the family should be in the room (they are sent in from the entrance early enough), and the party once sent. */
  familyAt: number
  family: Party | null
  /** The bed flow has tried to send the family (so a failed attempt is not repeated every step). */
  familyTried: boolean
  /** Sim time the family leaves the entrance so that they reach the room at `familyAt` (set by the bed flow). */
  familySpawnAt: number | null
  /** The wheelchair for a patient who leaves by porter: asked for, a porter on the way, the porter in the room. */
  wheelchair: 'none' | 'asked' | 'claimed' | 'here'
}

export interface BedRecord {
  roomId: RoomId
  ward: WardId
  stage: BedStage
  stageSince: number
  record: WardRecord | null
  person: Patient | null
  reservation: Reservation | null
  /** Today's planned discharge of the current occupant, if any. */
  plan: DischargePlan | null
  discharge: DischargeRun | null
  clean: CleanJob | null
  /** The admission check by a ward nurse: waiting, and who took it. */
  check: 'none' | 'pending' | 'claimed' | 'done'
  checkNurse: string | null
}

export interface BedAssignment {
  roomId: RoomId
  /** True when the patient has to wait in their ER bay for the bed. */
  boarding: boolean
}

/** What the tests read: every promise the board makes is logged here. */
export interface BoardLog {
  assigned: { t: number; roomId: RoomId; caseId: string; boarding: boolean }[]
  delivered: { t: number; roomId: RoomId; patientId: string; patientName: string }[]
  cleaned: { t: number; roomId: RoomId }[]
  wentHome: { t: number; roomId: RoomId; patientId: string }[]
  /** Rule breaks (a bed used without being cleaned, assigned twice, ...): always empty. */
  violations: string[]
}

/** The cleaner's walk plus the linen tail, for the ready-by estimate. */
const LINEN_TAIL_SECONDS = 45
/** A linen cart that has not come this long after the clean is done is forgiven (a safety net for hospitals with no porter). */
const LINEN_FORGIVE_SECONDS = 240
/** At most this many cleaners work on ward rooms at once (the rest of the housekeepers keep the ER bays clean). */
const MAX_ROOM_CLEANS = 1
/** The coordinator shows the tablet for this long after assigning a bed. */
const MANAGER_BUSY_SECONDS = 8

export class BedBoard {
  readonly rooms = new Map<RoomId, BedRecord>()
  readonly log: BoardLog = { assigned: [], delivered: [], cleaned: [], wentHome: [], violations: [] }
  /** The coordinator who plays the bed manager (shown with the tablet while a bed is being assigned). */
  readonly managerId: string | null
  /** Sim time until which the bed manager works the tablet. */
  managerBusyUntil = 0
  /** Counters for the HUD (the event log has the rest). */
  readonly stats = { discharged: 0, dischargedBeforeNoon: 0, admitted: 0, boardedMax: 0, longestBoardingSeconds: 0 }
  private t = 0

  constructor(
    readonly life: LivingDay,
    private readonly world: World,
    private readonly meds: MedSystem,
    private readonly rng: Rng,
  ) {
    this.managerId = STAFF.find((s) => s.role === 'coordinator')?.id ?? null
    const plans = new Map(dischargePlans().map((p) => [p.roomId, p]))
    for (const room of ROOMS) {
      const status = life.rooms.get(room.id)
      const person = world.wardPatients.get(room.id) ?? null
      this.rooms.set(room.id, {
        roomId: room.id,
        ward: room.ward,
        stage: status?.patientId ? 'occupied' : 'ready',
        stageSince: 0,
        record: person?.record ?? null,
        person,
        reservation: null,
        plan: person ? (plans.get(room.id) ?? null) : null,
        discharge: null,
        clean: null,
        check: 'done',
        checkNurse: null,
      })
    }
    // the room panel's details (age, reason, day of stay) are there from the first frame
    for (const rec of this.rooms.values()) this.syncRoom(rec)
  }

  // --- reading -----------------------------------------------------------------------------------------

  get(roomId: RoomId): BedRecord {
    const rec = this.rooms.get(roomId)
    if (!rec) throw new Error(`Unknown room ${roomId}`)
    return rec
  }

  /** Is a patient lying in this bed (not yet leaving)? Visits, rounds and medicines are for these rooms. */
  isInBed(roomId: RoomId): boolean {
    const rec = this.rooms.get(roomId)
    return rec !== undefined && rec.person !== null && (rec.stage === 'occupied' || rec.stage === 'dischargeSigned')
  }

  /** The patient the medicine pipeline writes orders for: the one lying in the bed. */
  occupantOf(roomId: RoomId): { id: string; name: string } | null {
    const rec = this.rooms.get(roomId)
    if (!rec || !this.isInBed(roomId) || !rec.record) return null
    return { id: rec.record.id, name: rec.record.name }
  }

  /** The ward record of the patient lying in the bed. */
  recordOf(roomId: RoomId): WardRecord | null {
    const rec = this.rooms.get(roomId)
    return rec && this.isInBed(roomId) ? rec.record : null
  }

  get managerBusy(): boolean {
    return this.t < this.managerBusyUntil
  }

  /** Rooms with a patient in bed (rounds visit these), in ward order. */
  occupiedRooms(ward: WardId): RoomId[] {
    const out: RoomId[] = []
    for (const rec of this.rooms.values()) if (rec.ward === ward && rec.stage === 'occupied' && rec.person !== null) out.push(rec.roomId)
    return out
  }

  count(stage: BedStage): number {
    let n = 0
    for (const rec of this.rooms.values()) if (rec.stage === stage) n++
    return n
  }

  /** Seconds the longest-waiting boarder has been in an ER bay so far (0 with nobody boarding). */
  longestBoardingNow(t: number): number {
    let longest = 0
    for (const rec of this.rooms.values()) if (rec.reservation?.boarding) longest = Math.max(longest, t - rec.reservation.since)
    return longest
  }

  get boardingNow(): number {
    let n = 0
    for (const rec of this.rooms.values()) if (rec.reservation?.boarding) n++
    return n
  }

  // --- discharge ----------------------------------------------------------------------------------------

  /** The room of this ward whose planned discharge the doctor may sign now (oldest due first), if any. */
  signDue(ward: WardId, t: number): RoomId | null {
    let best: BedRecord | null = null
    for (const rec of this.rooms.values()) {
      if (rec.ward !== ward || rec.stage !== 'occupied' || !rec.plan || rec.discharge || rec.person === null) continue
      if (rec.plan.signAt > t) continue
      if (best === null || rec.plan.signAt < best.plan!.signAt) best = rec
    }
    return best ? best.roomId : null
  }

  /**
   * The doctor signs the planned discharge: the bed goes `dischargeSigned`, the take-home medicines go out as a MedPod
   * order (source 'discharge'), and the patient's discharge journey starts. False if there is nothing to sign.
   * `warm` (the warm start): the discharge is already `elapsed` seconds old; 'leaving' means the medicines are already
   * given and the family is already in the room, so the patient goes straight to changing. No event is written for it.
   */
  sign(roomId: RoomId, doctorId: string, t: number, warm?: { kind: 'signed' | 'leaving'; elapsed: number }): boolean {
    const rec = this.get(roomId)
    if (rec.stage !== 'occupied' || !rec.plan || rec.discharge || !rec.person || !rec.record) return false
    this.t = t
    const person = rec.person
    const record = rec.record
    const signedAt = t - (warm?.elapsed ?? 0)
    this.setStage(rec, 'dischargeSigned', signedAt)
    if (!warm) {
      this.world.say('dischargeSigned', fillDayTemplate('dischargeSigned', { doctor: staffName(doctorId), patient: record.name, room: roomId }), {
        roomId,
        actorId: doctorId,
        subjectId: record.id,
      })
    }
    let orderId: string | null = null
    if (warm?.kind !== 'leaving') {
      const items = record.usualMeds.slice(0, CONFIG.orders.maxItems).map((medId) => ({ medId, qty: 1 }))
      const res = this.meds.prescribe({ roomId, items, prescriberId: doctorId, source: 'discharge', doseAt: t })
      if (res.ok) orderId = res.order.id
    }
    const familyAt = warm?.kind === 'leaving' ? t : signedAt + this.rng.between(CONFIG.beds.familyArrivesSeconds)
    rec.discharge = { plan: rec.plan, signedAt, orderId, familyAt, family: null, familyTried: false, familySpawnAt: null, wheelchair: 'none' }
    person.beginDischarge(rec.discharge, this.world, { changeSeconds: this.rng.between(CONFIG.beds.changeSeconds), warm: warm?.kind === 'leaving' })
    return true
  }

  /** The doctor may sign this room's planned discharge now. */
  canSign(roomId: RoomId, t: number): boolean {
    const rec = this.rooms.get(roomId)
    return rec !== undefined && rec.stage === 'occupied' && rec.plan !== null && rec.discharge === null && rec.person !== null && rec.plan.signAt <= t
  }

  /** The patient has got up and is changing or walking out: the bed is no longer one to visit or prescribe for. */
  beginLeaving(roomId: RoomId, t: number): void {
    const rec = this.get(roomId)
    if (rec.stage !== 'dischargeSigned') return
    this.setStage(rec, 'leaving', t)
    this.world.wardPatients.delete(roomId)
    // nothing more is given in this room to the patient who has got up
    this.meds.releaseRoom(roomId)
  }

  /** A patient who leaves by wheelchair asks the porters for one. */
  askWheelchair(roomId: RoomId): void {
    const d = this.rooms.get(roomId)?.discharge
    if (d && d.wheelchair === 'none') d.wheelchair = 'asked'
  }

  /** A porter takes the oldest wheelchair request (the patient waits in the room). */
  claimWheelchair(): RoomId | null {
    let best: BedRecord | null = null
    for (const rec of this.rooms.values()) {
      const d = rec.discharge
      if (!d || d.wheelchair !== 'asked') continue
      if (best === null || d.signedAt < best.discharge!.signedAt) best = rec
    }
    if (!best) return null
    best.discharge!.wheelchair = 'claimed'
    return best.roomId
  }

  /** The porter with the wheelchair is in the room. */
  wheelchairHere(roomId: RoomId): void {
    const d = this.rooms.get(roomId)?.discharge
    if (d) d.wheelchair = 'here'
  }

  /** The patient (and family) walked out of the room: the bed is empty and waits for a cleaner. */
  vacate(roomId: RoomId, t: number): void {
    const rec = this.get(roomId)
    if (rec.stage !== 'leaving' && rec.stage !== 'dischargeSigned' && rec.stage !== 'occupied') return
    this.world.wardPatients.delete(roomId)
    this.meds.releaseRoom(roomId)
    rec.person = null
    rec.record = null
    rec.plan = null
    rec.discharge = null
    rec.check = 'done'
    rec.clean = { cleanerId: null, seconds: this.rng.between(CONFIG.beds.roomCleanSeconds), started: false, startedAt: 0, done: false, doneAt: 0, linen: 'none' }
    this.setStage(rec, 'needsCleaning', t)
  }

  /** `wentHome`: the patient faded out at the entrance. */
  wentHome(roomId: RoomId, record: WardRecord, t: number): void {
    this.t = t
    this.log.wentHome.push({ t, roomId, patientId: record.id })
    this.stats.discharged++
    if ((t / 3600 + CONFIG.sim.startHour) % 24 < 12) this.stats.dischargedBeforeNoon++
    this.world.say('wentHome', fillDayTemplate('wentHome', { patient: record.name, days: record.dayOfStay }), { roomId, subjectId: record.id })
  }

  // --- cleaning -------------------------------------------------------------------------------------------

  /** The room that has waited longest for a cleaner, now yours (the stage changes when you get there: `cleanStarted`). */
  claimClean(cleanerId: string, t: number): { roomId: RoomId; seconds: number } | null {
    let best: BedRecord | null = null
    // one room at a time: the other cleaner stays free for the ER bays
    let busy = 0
    for (const rec of this.rooms.values()) if (rec.clean && rec.clean.cleanerId !== null && !rec.clean.done) busy++
    if (busy >= MAX_ROOM_CLEANS) return null
    for (const rec of this.rooms.values()) {
      if (rec.stage !== 'needsCleaning' || !rec.clean || rec.clean.cleanerId !== null) continue
      if (best === null || rec.stageSince < best.stageSince) best = rec
    }
    if (!best) return null
    this.t = t
    best.clean!.cleanerId = cleanerId
    return { roomId: best.roomId, seconds: best.clean!.seconds }
  }

  /** The cleaner is in the room with the cart: the bed is `cleaning`, and fresh linen is asked for. */
  cleanStarted(roomId: RoomId, t: number): void {
    const rec = this.get(roomId)
    if (!rec.clean || rec.stage !== 'needsCleaning') return
    this.t = t
    rec.clean.started = true
    rec.clean.startedAt = t
    rec.clean.linen = 'asked'
    this.setStage(rec, 'cleaning', t)
  }

  /** The cleaner has finished; the bed is ready as soon as the linen is on it too. */
  cleanFinished(roomId: RoomId, t: number): void {
    const rec = this.get(roomId)
    if (!rec.clean || rec.stage !== 'cleaning') return
    this.t = t
    rec.clean.done = true
    rec.clean.doneAt = t
    this.maybeReady(rec, t)
  }

  /** A porter takes the next linen cart to a room whose cleaning has begun (oldest first). */
  claimLinen(): RoomId | null {
    let best: BedRecord | null = null
    for (const rec of this.rooms.values()) {
      if (!rec.clean || rec.clean.linen !== 'asked') continue
      if (best === null || rec.clean.startedAt < best.clean!.startedAt) best = rec
    }
    if (!best) return null
    best.clean!.linen = 'claimed'
    return best.roomId
  }

  /** Is linen waiting for a porter (so a porter may leave a patient job for it only when idle)? */
  get linenPending(): number {
    let n = 0
    for (const rec of this.rooms.values()) if (rec.clean?.linen === 'asked') n++
    return n
  }

  linenDelivered(roomId: RoomId, t: number): void {
    const rec = this.get(roomId)
    if (!rec.clean) return
    this.t = t
    rec.clean.linen = 'done'
    this.maybeReady(rec, t)
  }

  private maybeReady(rec: BedRecord, t: number): void {
    const c = rec.clean
    if (!c || !c.done || c.linen !== 'done' || rec.stage !== 'cleaning') return
    rec.clean = null
    this.setStage(rec, 'ready', t)
    this.log.cleaned.push({ t, roomId: rec.roomId })
    this.world.say('roomCleaned', fillDayTemplate('roomCleaned', { room: rec.roomId }), { roomId: rec.roomId })
  }

  // --- admission ---------------------------------------------------------------------------------------------

  /** When will this bed be ready (sim time)? `t` if it is, Infinity if a patient still has it. */
  readyEta(rec: BedRecord, t: number): number {
    if (rec.stage === 'ready') return t
    const c = rec.clean
    if (!c) return Infinity
    if (rec.stage === 'needsCleaning') return t + (c.cleanerId === null ? CLEANER_PICKUP_SECONDS : 20) + c.seconds + LINEN_TAIL_SECONDS
    if (rec.stage === 'cleaning') return Math.max(t, c.startedAt + c.seconds) + LINEN_TAIL_SECONDS
    return Infinity
  }

  /**
   * The bed manager assigns a bed to a patient admitted from the ER (from ER bay `bayIndex`): a `ready` bed, else a bed
   * that will be ready within the reserve window (the patient boards in the bay, within the boarding limits), else null:
   * the patient goes to "a ward upstairs".
   */
  requestBed(caseId: string, patientName: string, bayIndex: number, t: number): BedAssignment | null {
    this.t = t
    const bay = this.world.er.bays[bayIndex]
    if (!bay) return null
    const door = (rec: BedRecord) => Math.abs(roomById(rec.roomId).door.x + 42)
    let best: BedRecord | null = null
    let bestKey = Infinity
    for (const rec of this.rooms.values()) {
      if (rec.reservation) continue
      const eta = this.readyEta(rec, t)
      if (!Number.isFinite(eta)) continue
      if (rec.stage !== 'ready') {
        if (eta - t > CONFIG.beds.reserveWindowSeconds) continue
        if (this.boardingNow >= CONFIG.beds.boardingMaxBays) continue
      }
      // a ready bed first, then the one that will be ready soonest, then the one nearest the spine
      const key = (eta - t) * 1000 + door(rec)
      if (key < bestKey) {
        best = rec
        bestKey = key
      }
    }
    if (!best) return null
    const boarding = best.stage !== 'ready'
    if (best.person !== null) this.log.violations.push(`${best.roomId} assigned to ${caseId} while ${best.person.entity.id} is in it`)
    best.reservation = { caseId, patientName, bayId: bay.seat.id, bayIndex, since: t, boarding }
    this.log.assigned.push({ t, roomId: best.roomId, caseId, boarding })
    this.managerBusyUntil = t + MANAGER_BUSY_SECONDS
    const bayText = `ER bay ${bayIndex + 1}`
    this.syncRoom(best)
    this.world.say('bedAssigned', fillDayTemplate('bedAssigned', { room: best.roomId, patient: patientName, bay: bayText }), {
      roomId: best.roomId,
      subjectId: caseId,
      actorId: this.managerId ?? undefined,
    })
    if (boarding) {
      this.world.say('patientBoarding', fillDayTemplate('patientBoarding', { patient: patientName, bay: bayText, room: best.roomId }), {
        roomId: best.roomId,
        subjectId: caseId,
      })
      this.stats.boardedMax = Math.max(this.stats.boardedMax, this.boardingNow)
    }
    return { roomId: best.roomId, boarding }
  }

  reservationOf(caseId: string): BedRecord | null {
    for (const rec of this.rooms.values()) if (rec.reservation?.caseId === caseId) return rec
    return null
  }

  /** Is the bed this patient was promised clean and made up, so that the porter may fetch them? */
  bedReadyFor(caseId: string): boolean {
    const rec = this.reservationOf(caseId)
    return rec !== null && rec.stage === 'ready'
  }

  /** The porter has lifted the patient out of the ER bay: boarding is over. */
  boardingEnded(caseId: string, t: number): void {
    const rec = this.reservationOf(caseId)
    if (!rec || !rec.reservation || !rec.reservation.boarding) return
    this.stats.longestBoardingSeconds = Math.max(this.stats.longestBoardingSeconds, t - rec.reservation.since)
    rec.reservation.boarding = false
    this.syncRoom(rec)
  }

  /** Drop a reservation (the boarding limit, or the patient is no longer coming). */
  cancelReservation(roomId: RoomId, t: number): void {
    const rec = this.get(roomId)
    const r = rec.reservation
    if (!r) return
    if (r.boarding) this.stats.longestBoardingSeconds = Math.max(this.stats.longestBoardingSeconds, t - r.since)
    rec.reservation = null
    this.syncRoom(rec)
    this.world.patients.get(r.caseId)?.bedLost()
  }

  /**
   * The patient is in the bed (the stretcher-to-bed slide is done): the room is occupied by the new ward patient. The bed
   * must be clean and reserved for exactly this patient.
   */
  occupy(roomId: RoomId, person: Patient, record: WardRecord, t: number): void {
    this.t = t
    const rec = this.get(roomId)
    if (rec.stage !== 'ready') this.log.violations.push(`${roomId} received ${record.id} while ${rec.stage}`)
    if (!rec.reservation || rec.reservation.caseId !== record.id) this.log.violations.push(`${roomId} received ${record.id} without being assigned to them`)
    if (rec.person !== null) this.log.violations.push(`${roomId} received ${record.id} while ${rec.person.entity.id} is in it`)
    rec.reservation = null
    rec.person = person
    rec.record = record
    rec.plan = null
    rec.discharge = null
    rec.clean = null
    rec.check = 'pending'
    rec.checkNurse = null
    this.world.wardPatients.set(roomId, person)
    this.log.delivered.push({ t, roomId, patientId: record.id, patientName: record.name })
    this.setStage(rec, 'occupied', t)
  }

  /** A ward nurse takes the oldest admission check on her ward. */
  claimCheck(ward: WardId, nurseId: string): RoomId | null {
    let best: BedRecord | null = null
    for (const rec of this.rooms.values()) {
      if (rec.ward !== ward || rec.check !== 'pending' || rec.stage !== 'occupied') continue
      if (best === null || rec.stageSince < best.stageSince) best = rec
    }
    if (!best) return null
    best.check = 'claimed'
    best.checkNurse = nurseId
    return best.roomId
  }

  /** The nurse finished the wristband and tablet check: `admittedToWard`. */
  completeCheck(roomId: RoomId, nurseId: string, t: number): void {
    const rec = this.get(roomId)
    if (rec.check !== 'claimed' || !rec.record) return
    this.t = t
    rec.check = 'done'
    this.stats.admitted++
    this.world.say('admittedToWard', fillDayTemplate('admittedToWard', { nurse: staffName(nurseId), patient: rec.record.name, room: roomId }), {
      roomId,
      actorId: nurseId,
      subjectId: rec.record.id,
    })
  }

  // --- warm start -----------------------------------------------------------------------------------------------

  /** Put a room in a state directly (the warm start). `since` is the sim time the state began. */
  warmSet(roomId: RoomId, o: { stage: BedStage; since: number; person: Patient | null; record: WardRecord | null; clean?: Partial<CleanJob>; check?: BedRecord['check'] }): void {
    const rec = this.get(roomId)
    rec.stage = o.stage
    rec.stageSince = o.since
    rec.person = o.person
    rec.record = o.record
    rec.reservation = null
    rec.discharge = null
    rec.plan = null
    rec.check = o.check ?? 'done'
    rec.checkNurse = null
    rec.clean =
      o.clean === undefined
        ? null
        : { cleanerId: null, seconds: this.rng.between(CONFIG.beds.roomCleanSeconds), started: false, startedAt: 0, done: false, doneAt: 0, linen: 'none', ...o.clean }
    if (o.person) this.world.wardPatients.set(roomId, o.person)
    else this.world.wardPatients.delete(roomId)
    this.syncRoom(rec)
  }

  /** Attach today's planned discharge to a room's occupant (the warm start re-creates it for a discharge under way). */
  setPlan(roomId: RoomId, plan: DischargePlan | null): void {
    this.get(roomId).plan = plan
  }

  // --- ticking ----------------------------------------------------------------------------------------------------

  /** Slow bookkeeping, a few times a second: boarding limits and forgiven linen. */
  step(t: number): void {
    this.t = t
    for (const rec of this.rooms.values()) {
      const r = rec.reservation
      if (r && r.boarding && t - r.since > CONFIG.beds.boardingMaxSeconds) this.cancelReservation(rec.roomId, t)
      const c = rec.clean
      if (c && c.done && c.linen === 'asked' && t - c.doneAt > LINEN_FORGIVE_SECONDS) {
        c.linen = 'done'
        this.maybeReady(rec, t)
      }
    }
  }

  // --- writing the view -----------------------------------------------------------------------------------------------

  private setStage(rec: BedRecord, stage: BedStage, t: number): void {
    rec.stage = stage
    rec.stageSince = t
    this.syncRoom(rec)
  }

  /** Write what the door tile, the bedside screen and the command wall show. */
  syncRoom(rec: BedRecord): void {
    const r = rec.reservation
    let patientId: string | null = null
    let patientName: string | null = null
    let patientAge: number | undefined
    let patientReason: string | undefined
    let dayOfStay: number | undefined
    if (r) {
      patientId = r.caseId
      patientName = r.patientName
    } else if (rec.record && rec.person) {
      patientId = rec.record.id
      patientName = rec.record.name
      patientAge = rec.record.age
      patientReason = rec.record.reason
      dayOfStay = rec.record.dayOfStay
    }
    this.life.setBed(rec.roomId, {
      bed: r ? 'reserved' : rec.stage,
      patientId,
      patientName,
      patientAge,
      patientReason,
      dayOfStay,
      since: r ? r.since : rec.stageSince,
      boarding: r && r.boarding ? { bayId: r.bayId, since: r.since } : undefined,
    })
  }
}
