/**
 * An ER patient: a walk-in who checks in and waits, or an ambulance arrival on a stretcher. The xstate pathway
 * (pathway.machine.ts) decides when and which way; this controller is its host. On every state entry it sets the
 * emote and mood, claims what the stage needs (a queue place, a seat, a porter) and writes the event line; each step
 * it finishes the physical part (arrive, sit, lie down, get on a wheelchair) and sends the machine the event that
 * says so. Staff and porters call the small public methods below at the moments they meet the patient.
 */
import { staffName } from '@/content/staff'
import { protocolById, testForReason } from '@/content/imaging'
import { CONFIG } from '../config'
import type { BedAssignment } from '../beds/board'
import type { Booking, ScanSubject } from '../imaging/booking'
import type { ScannerSites } from '../imaging/sites'
import type { PeopleContext } from '../people'
import { DEPARTURES, roomById } from '../places'
import type { Rng } from '../rng'
import type { ScannerState, SeatSpec, Vec2 } from '../types'
import type { Walker } from '../walker'
import { Actor } from './actor'
import type { Companion } from './companion'
import { newCase, type ErCase } from './department'
import {
  createPathway,
  stageOf,
  type PathwayActor,
  type PathwayContext,
  type PathwayHost,
  type PathwayState,
  type TestKind,
} from './pathway.machine'
import type { PorterJobKind } from './porterBoard'
import type { QueueLike } from './ports'
import type { World } from './world'

export interface PatientInit {
  world: World
  id: string
  name: string
  reason: { text: string; acuity: number }
  ambulance: boolean
  at: Vec2
  heading: number
  walker: Walker
  rng: Rng
}

type QueueKey = 'reception' | 'kiosk0' | 'kiosk1'
type Leave = 'none' | 'standing' | 'walking' | 'fading'

/** The test for a reason; a reason the imaging content does not know gets the blood draw (the M3 behaviour). */
function knownTest(text: string): ReturnType<typeof testForReason> {
  try {
    return testForReason(text)
  } catch {
    return { test: 'blood' }
  }
}

function lcFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** Where a standing patient waits when the lobby has no free seat. */
const STANDING: Record<'triage' | 'er', Vec2> = {
  triage: { x: -49, z: -3.4 },
  er: { x: -49, z: 3.4 },
}

export class ErPatient extends Actor implements PathwayHost, ScanSubject {
  readonly c: ErCase
  readonly world: World
  /** Started by `start()` once the person is part of the simulation. */
  pathway!: PathwayActor
  state: PathwayState = 'arriving'
  companion: Companion | null = null
  /** The seat in the waiting room they hold, if any. */
  waitSeat: SeatSpec | null = null
  /** The chair they sit in at the lab, if any. */
  labSeat: SeatSpec | null = null
  /** What the reason needs: nothing (never enters the tests branch), blood at the draw chair, or a scan. */
  readonly testKind: TestKind
  /** The protocol id of the scan, for `testKind === 'imaging'`. */
  readonly protocolId: string | null
  /** The imaging booking, once the doctor has ordered the scan. */
  booking: Booking | null = null
  /** The scanner's table seat, from the moment a scanner has taken them until they are collected. */
  scanSeat: SeatSpec | null = null
  /** True when the scan is over and a porter may load them (the porter waits for it). */
  scanFinishedFlag = false
  readonly transported = true
  /**
   * The ward bed the bed manager promised (L1), or null for "a ward upstairs". The patient boards in their ER bay until the
   * bed is ready, then a porter takes them by stretcher into the room and slides them onto the bed.
   */
  bed: BedAssignment | null = null
  /** The slide onto the ward bed is done and the porter is clear: the bed flow turns this patient into a ward patient. */
  handedToBed = false
  /** The bed flow has made this patient a ward patient (same id and name): they stay on in the hospital under the new object. */
  becameInpatient = false
  private scanJobAsked = false
  private returnJobAsked = false
  /** The nurse or paramedic they follow, and the seat they are being taken to. */
  private escort: Actor | null = null
  private escortSeat: SeatSpec | null = null
  private phase: 'none' | 'standingForEscort' | 'escorting' | 'standingFromTriage' = 'none'
  private queue: QueueLike | null = null
  private queueKey: QueueKey = 'kiosk0'
  private queueIdx = -2
  private arrivedSent = false
  private labSent = false
  private jobAsked = false
  private pickedSent = false
  private leave: Leave = 'none'
  private exit: Vec2 = DEPARTURES.entrance
  private readonly prng: Rng
  private readonly patience: number
  private retry = 0
  /** Sim time the patient was last seen leaving the department's care (for tests). */
  outcome: 'discharged' | 'admitted' | 'lwbs' | null = null

  constructor(init: PatientInit) {
    super(init.id, 'patient', init.name, init.at, init.heading, init.walker, 'everyday')
    this.world = init.world
    this.crowdWalker = init.world.walkerFor
    this.prng = init.rng
    this.walkAnim = 'walk'
    this.cruise = CONFIG.er.walkSpeed * (0.88 + (this.entity.variant % 25) / 100)
    this.entity.mood = 'unwell'
    this.entity.stage = 'arriving'
    const test = knownTest(init.reason.text)
    if (test.test === 'imaging' && init.world.imaging !== null) {
      this.testKind = 'imaging'
      this.protocolId = test.protocol
    } else {
      this.testKind = test.test === 'imaging' ? 'blood' : test.test
      this.protocolId = null
    }
    this.c = newCase({
      id: init.id,
      name: init.name,
      reason: init.reason.text,
      acuity: init.reason.acuity,
      ambulance: init.ambulance,
      arrivedAt: init.world.t,
      from: init.at,
    })
    const span = CONFIG.er.patienceSeconds[init.reason.acuity - 1]
    this.patience = init.ambulance || !Number.isFinite(span[0]) ? Infinity : init.rng.between(span as readonly [number, number])
    init.world.er.add(this.c)
    init.world.patients.set(init.id, this)
  }

  /** Start the pathway machine. Call once the patient has been added to the simulation. */
  start(): void {
    const clock = this.world.clock
    this.pathway = createPathway(
      {
        rng: this.prng,
        host: this,
        clock,
        acuity: this.c.acuity,
        ambulance: this.c.ambulance,
        patienceSeconds: this.patience,
        testKind: this.testKind,
      },
      clock,
    )
  }

  // --- the host: what each state means in the building -----------------------------------------------

  enter(state: PathwayState, ctx: PathwayContext): void {
    const w = this.world
    const c = this.c
    this.state = state
    c.state = state
    this.entity.stage = stageOf(state)
    if (state !== 'inBay.walking') c.ready = false
    switch (state) {
      case 'arriving':
        w.say(
          'patientArrived',
          c.ambulance ? `Ambulance arrival: ${c.name}, ${lcFirst(c.reason)}.` : `${c.name} arrived at the ER: ${lcFirst(c.reason)}.`,
          { subjectId: c.id },
        )
        break
      case 'checkIn.queueing':
        this.entity.mood = 'waiting'
        this.showEmote('question', w.t)
        this.joinQueue()
        break
      case 'checkIn.serving':
        break
      case 'waitingTriage':
        this.leaveQueue()
        w.say('checkedIn', `${c.name} checked in at the ${this.queueKey === 'reception' ? 'reception desk' : 'kiosk'}.`, { subjectId: c.id })
        this.entity.mood = 'waiting'
        this.showEmote('hourglass', w.t)
        this.seekSeat('triage')
        break
      case 'triage.walking':
        this.showEmote('none', w.t)
        break
      case 'triage.assessing':
        this.entity.mood = 'neutral'
        break
      case 'waitingDoctor':
        this.entity.mood = 'waiting'
        this.showEmote('hourglass', w.t)
        if (c.ambulance) {
          c.ready = true
          c.readyAt = w.t
          c.from = this.pos
        } else {
          w.say('triaged', `${staffName(c.nurseId ?? 'nurse-T1')} triaged ${c.name}: priority ${c.acuity}.`, {
            subjectId: c.id,
            actorId: c.nurseId ?? undefined,
          })
          w.er.releaseTriageBay(c)
          this.phase = 'standingFromTriage'
          this.standUp()
        }
        break
      case 'inBay.walking':
        this.showEmote('none', w.t)
        break
      case 'inBay.waitingExam':
        c.onTrolley = true
        c.trolleyAt = w.t
        this.entity.mood = 'unwell'
        this.showEmote('bed', w.t)
        break
      case 'inBay.exam':
        w.say('seenByDoctor', `${staffName(c.doctorId ?? 'doc-ER1')} is seeing ${c.name} in ER bay ${c.bay + 1}.`, {
          subjectId: c.id,
          actorId: c.doctorId ?? undefined,
        })
        this.showEmote('none', w.t)
        break
      case 'tests.waitingPorter':
        if (this.testKind === 'imaging') {
          const proto = protocolById(this.protocolId!)
          w.say('testsOrdered', `${staffName(c.doctorId ?? 'doc-ER1')} ordered the ${proto.name} for ${c.name}.`, {
            subjectId: c.id,
            actorId: c.doctorId ?? undefined,
          })
          this.booking = w.imaging!.requestErExam(this, proto.id)
        } else {
          w.say('testsOrdered', `${staffName(c.doctorId ?? 'doc-ER1')} ordered tests for ${c.name}.`, {
            subjectId: c.id,
            actorId: c.doctorId ?? undefined,
          })
        }
        c.doctorId = null
        this.showEmote('hourglass', w.t)
        break
      case 'tests.toLab':
        this.showEmote('scan', w.t)
        break
      case 'tests.testing':
        this.showEmote('scan', w.t)
        break
      case 'tests.waitingReturn':
        this.showEmote('hourglass', w.t)
        if (this.testKind !== 'imaging') this.jobAsked = false
        this.pickedSent = false
        break
      case 'tests.returning':
        this.showEmote('none', w.t)
        break
      case 'tests.awaitingResults':
        this.showEmote('hourglass', w.t)
        break
      case 'decision':
        if (ctx.needsTests) {
          const what = this.booking ? `${this.booking.protocolName} report` : 'results'
          w.say('resultsBack', `${c.name}'s ${what} ${this.booking ? 'is' : 'are'} back.`, { subjectId: c.id })
        }
        c.doctorId = null
        break
      case 'leaving.home': {
        const mins = Math.max(1, Math.round((w.t - c.arrivedAt) / 60))
        w.say('discharged', `${c.name} was discharged home after ${mins} min.`, { subjectId: c.id })
        w.er.finish(c, 'discharged', w.t)
        this.outcome = 'discharged'
        this.entity.mood = 'happy'
        this.showEmote('check', w.t, 8)
        w.er.vacate(c, w.t)
        this.beginLeaving(DEPARTURES.entrance)
        break
      }
      case 'leaving.lwbs': {
        const mins = Math.max(1, Math.round((w.t - c.arrivedAt) / 60))
        w.say('leftWithoutBeingSeen', `${c.name} left without being seen after ${mins} min.`, { subjectId: c.id })
        w.er.finish(c, 'lwbs', w.t)
        this.outcome = 'lwbs'
        this.entity.mood = 'unwell'
        this.showEmote('hourglass', w.t, 8)
        this.releaseWaitSeat()
        this.beginLeaving(DEPARTURES.entrance)
        break
      }
      case 'admittedOut.waitingPorter': {
        // the bed manager looks for a ward bed; with none (or no bed board) the patient goes upstairs as in M3
        this.bed = w.beds !== null && c.bay >= 0 ? w.beds.requestBed(c.id, c.name, c.bay, w.t) : null
        if (this.bed) {
          w.say('admitted', `${c.name} was admitted to ward ${roomById(this.bed.roomId).ward}, room ${this.bed.roomId}.`, { subjectId: c.id, roomId: this.bed.roomId })
          // already in a gown on the trolley: no change of clothes when they reach the bed
          this.entity.outfit = 'gown'
        } else {
          w.say('admitted', `${c.name} was admitted to a ward upstairs.`, { subjectId: c.id })
        }
        w.er.finish(c, 'admitted', w.t)
        this.outcome = 'admitted'
        this.showEmote('bed', w.t)
        this.jobAsked = false
        this.pickedSent = false
        break
      }
      case 'admittedOut.riding':
        this.showEmote('none', w.t)
        break
      case 'gone':
        break
    }
  }

  // --- called by the world, staff and porters ------------------------------------------------------------

  /** The department promised this patient a bay: tell the machine (stops the patience timer). */
  bayAssigned(): void {
    this.pathway.send({ type: 'BAY_CALLED' })
  }

  /** A triage nurse has taken this patient. */
  beCalled(): void {
    this.pathway.send({ type: 'CALLED' })
  }

  /** The caller reached the patient: stand up and follow `leader` to `seat` (a triage chair or a bay trolley). */
  followTo(leader: Actor, seat: SeatSpec): void {
    this.escort = leader
    this.escortSeat = seat
    this.releaseWaitSeat()
    if (this.seat) {
      this.phase = 'standingForEscort'
      this.standUp()
    } else {
      this.phase = 'escorting'
      this.sitOn(seat, { leader })
    }
  }

  /** A doctor has reached the bay: the exam starts. */
  doctorHere(): void {
    this.pathway.send({ type: 'DOCTOR_HERE' })
  }

  get examSeconds(): number {
    return this.pathway.getSnapshot().context.examSeconds
  }

  /** A nurse has come for the patient and they are on their way (standing up or walking) to a triage chair or a bay. */
  get beingEscorted(): boolean {
    return this.phase === 'escorting' || this.phase === 'standingForEscort'
  }

  get mounted(): boolean {
    return this.mode === 'ride' && this.done
  }

  /** On the trolley or a chair, off every vehicle. */
  get settled(): boolean {
    return this.mode === 'static' && this.done && this.pusher === null
  }

  get baySeat(): SeatSpec | null {
    return this.c.bay >= 0 ? this.world.er.bays[this.c.bay].seat : null
  }

  /** The porter reached the patient with a vehicle: get on. */
  loadOn(pusher: Actor, kind: 'wheelchair' | 'stretcher'): void {
    if (this.state === 'tests.waitingReturn' && this.labSeat) {
      this.world.seats.release(this.labSeat.id, this.c.id)
      this.labSeat = null
    }
    if (this.state === 'admittedOut.waitingPorter') {
      this.world.er.vacate(this.c, this.world.t)
      if (this.bed) this.world.beds?.boardingEnded(this.c.id, this.world.t)
    }
    this.world.attach(pusher, this)
    this.mountOn(pusher, kind)
  }

  /** At Lab & imaging: get off onto the blood-draw chair. */
  unloadAtLab(): void {
    const seat = this.labSeat
    this.world.detach(this)
    if (seat) this.dismount(seat.x, seat.z, seat.heading, seat)
    else this.dismount(this.walker.x, this.walker.z, this.walker.heading, null)
  }

  /** At the scanner: get off the wheelchair or stretcher onto the table. */
  unloadAtScanner(): void {
    const seat = this.scanSeat
    this.world.detach(this)
    if (seat) this.dismount(seat.x, seat.z, seat.heading, seat)
    else this.dismount(this.walker.x, this.walker.z, this.walker.heading, null)
  }

  /** What the porter pushes this patient on: a stretcher for acuity 1-2, otherwise a wheelchair. */
  get scanVehicle(): 'wheelchair' | 'stretcher' {
    return this.c.acuity <= 2 ? 'stretcher' : 'wheelchair'
  }

  /** May the porter load this patient for the job now? (On the way back from a scan, only once the table is out.) */
  pickupReady(kind: PorterJobKind): boolean {
    return kind === 'fromImaging' ? this.scanFinishedFlag : true
  }

  // --- the scanner's side (ScanSubject) ------------------------------------------------------------------------

  get actor(): Actor {
    return this
  }
  get id(): string {
    return this.c.id
  }
  get name(): string {
    return this.c.name
  }

  scanAssigned(sites: ScannerSites, _state: ScannerState): void {
    this.scanSeat = sites.tableSeat
  }

  scanCalled(): void {}

  /** The last sequence is done: ask for a porter now so the ride is there when the table is out. */
  scanRequestReturn(): void {
    if (this.returnJobAsked) return
    this.returnJobAsked = true
    this.world.porters.request('fromImaging', this.c.id, this.world.t)
  }

  scanFinished(): void {
    this.scanFinishedFlag = true
    this.pathway.send({ type: 'SCAN_DONE' })
  }

  scanReleased(): void {}

  reportReady(): void {
    this.pathway.send({ type: 'REPORT_READY' })
  }

  /** Back at the bay: get off onto the trolley. */
  unloadAtBay(): void {
    const seat = this.baySeat
    this.world.detach(this)
    if (seat) this.dismount(seat.x, seat.z, seat.heading, seat)
    else this.dismount(this.walker.x, this.walker.z, this.walker.heading, null)
  }

  /** At the lift: the stretcher goes up to the ward, and the patient fades out with it. */
  fadeAtLift(): void {
    this.fadeOut()
  }

  /** At the ward room: the stretcher stands along the bed; slide across onto it (never a pop). */
  unloadAtBed(): void {
    const seat = this.world.seats.byId(`bed:${this.bed!.roomId}`)
    this.world.detach(this)
    this.dismount(seat.x, seat.z, seat.heading, seat)
    this.entity.roomId = this.bed!.roomId
  }

  /** The reserved bed was released (the boarding limit): the patient goes to a ward upstairs after all. */
  bedLost(): void {
    this.bed = null
    this.entity.outfit = 'everyday'
  }

  // --- per step ---------------------------------------------------------------------------------------

  think(dt: number, _ctx: PeopleContext): void {
    const w = this.world
    const c = this.c
    switch (this.state) {
      case 'arriving':
        if (this.visibleFully && !this.arrivedSent) {
          this.arrivedSent = true
          this.pathway.send({ type: 'ARRIVED' })
        }
        break
      case 'checkIn.queueing':
        this.thinkQueue(dt)
        break
      case 'waitingTriage':
      case 'waitingDoctor':
        if (this.phase === 'standingFromTriage') {
          if (this.done) {
            this.phase = 'none'
            this.seekSeat('er')
          }
          break
        }
        if (c.ambulance) break
        if (!c.ready && this.done) {
          c.ready = true
          c.readyAt = w.t
          c.from = this.pos
        } else if (this.waitSeat === null && this.done && this.due(dt, 2)) {
          this.seekSeat(this.state === 'waitingTriage' ? 'triage' : 'er')
        }
        break
      case 'triage.walking':
      case 'inBay.walking':
        this.thinkEscort()
        break
      case 'tests.waitingPorter':
        if (this.testKind === 'imaging') {
          // the scanner has taken us (scanAssigned): now the porter may come
          if (!this.scanJobAsked && this.scanSeat !== null) {
            this.scanJobAsked = true
            w.porters.request('toImaging', c.id, w.t)
          }
        } else if (!this.jobAsked && this.due(dt, 1)) {
          const chair = this.labSeat ?? w.seats.claim(c.id, { area: 'diagnostics' }, this.pos)
          if (chair) {
            this.labSeat = chair
            this.askPorter('toDiagnostics')
          }
        }
        this.sendPicked()
        break
      case 'tests.toLab': {
        const target = this.testKind === 'imaging' ? this.scanSeat : this.labSeat
        if (!this.labSent && this.mode === 'static' && this.done && this.seat && this.seat === target) {
          this.labSent = true
          this.pathway.send({ type: 'AT_LAB' })
        }
        break
      }
      case 'tests.waitingReturn':
        if (this.testKind === 'imaging') this.scanRequestReturn()
        else if (!this.jobAsked) this.askPorter('fromDiagnostics')
        this.sendPicked()
        break
      case 'tests.returning':
        if (this.mode === 'static' && this.done && this.seat && this.seat === this.baySeat) {
          this.pathway.send({ type: 'BACK_IN_BAY' })
          this.labSent = false
        }
        break
      case 'admittedOut.waitingPorter':
        // with a bed promised, the porter comes once the bed is clean and made up; until then the patient boards in the bay
        if (!this.jobAsked && (this.bed === null || w.beds?.bedReadyFor(c.id))) this.askPorter('admit')
        this.sendPicked()
        break
      case 'leaving.home':
      case 'leaving.lwbs':
        this.thinkLeaving()
        break
      default:
        break
    }
  }

  private sendPicked(): void {
    if (!this.pickedSent && this.mounted) {
      this.pickedSent = true
      this.pathway.send({ type: 'PICKED_UP' })
    }
  }

  private askPorter(kind: PorterJobKind): void {
    this.jobAsked = true
    this.world.porters.request(kind, this.c.id, this.world.t)
  }

  // --- check-in -------------------------------------------------------------------------------------

  private queueOf(key: QueueKey): QueueLike {
    return key === 'reception' ? this.world.reception : this.world.kiosks[key === 'kiosk0' ? 0 : 1]
  }

  private joinQueue(): void {
    const w = this.world
    const k0 = w.kiosks[0].members.length
    const k1 = w.kiosks[1].members.length
    const kiosk: QueueKey = k1 < k0 ? 'kiosk1' : 'kiosk0'
    const other: QueueKey = kiosk === 'kiosk0' ? 'kiosk1' : 'kiosk0'
    const order: QueueKey[] = this.prng.chance(CONFIG.er.kioskShare) ? [kiosk, other, 'reception'] : ['reception', kiosk, other]
    for (const key of order) {
      const q = this.queueOf(key)
      const idx = q.join(this.c.id)
      if (idx >= 0) {
        this.queue = q
        this.queueKey = key
        this.queueIdx = idx
        const spot = q.spotFor(idx)
        this.moveTo(spot.at, { face: spot.heading })
        return
      }
    }
    this.queue = null
  }

  private leaveQueue(): void {
    if (!this.queue) return
    this.queue.leave(this.c.id)
    this.setServerBusy(false)
    this.queue = null
  }

  private setServerBusy(on: boolean): void {
    const s = this.world.serverBusy
    if (this.queueKey === 'reception') s.reception = on
    else s.kiosk[this.queueKey === 'kiosk0' ? 0 : 1] = on
  }

  private serverBusy(): boolean {
    const s = this.world.serverBusy
    return this.queueKey === 'reception' ? s.reception : s.kiosk[this.queueKey === 'kiosk0' ? 0 : 1]
  }

  private thinkQueue(dt: number): void {
    const q = this.queue
    if (!q) {
      this.retry += dt
      if (this.retry >= 1) {
        this.retry = 0
        this.joinQueue()
      }
      return
    }
    const idx = q.indexOf(this.c.id)
    if (idx < 0) return
    if (idx !== this.queueIdx) {
      this.queueIdx = idx
      const spot = q.spotFor(idx)
      this.moveTo(spot.at, { face: spot.heading })
      return
    }
    if (idx === 0 && this.done && !this.serverBusy()) {
      this.setServerBusy(true)
      this.pathway.send({ type: 'SERVICE_BEGIN' })
    }
  }

  // --- seats ---------------------------------------------------------------------------------------

  private seekSeat(group: 'triage' | 'er'): void {
    const w = this.world
    const near = this.companion?.seat ? { x: this.companion.seat.x, z: this.companion.seat.z } : this.pos
    const seat = w.claimWaitingSeat(this.c.id, group, near)
    if (seat) {
      this.waitSeat = seat
      this.sitOn(seat)
    } else {
      this.waitSeat = null
      this.moveTo(STANDING[group], { face: group === 'triage' ? -Math.PI / 2 : -Math.PI / 2 })
    }
  }

  private releaseWaitSeat(): void {
    if (this.waitSeat) {
      this.world.seats.release(this.waitSeat.id, this.c.id)
      this.waitSeat = null
    }
  }

  private thinkEscort(): void {
    if (this.phase === 'standingForEscort') {
      if (this.done && this.escortSeat) {
        this.phase = 'escorting'
        this.sitOn(this.escortSeat, { leader: this.escort })
      }
      return
    }
    if (this.phase !== 'escorting' || !this.done || !this.seat || this.seat !== this.escortSeat) return
    this.phase = 'none'
    this.escort = null
    this.escortSeat = null
    this.pathway.send({ type: this.state === 'triage.walking' ? 'IN_TRIAGE_BAY' : 'ON_TROLLEY' })
  }

  /** Called by the paramedics: the stretcher is at the bay, get onto the trolley. */
  unloadToTrolley(): void {
    const seat = this.baySeat
    this.world.detach(this)
    this.phase = 'escorting'
    this.escortSeat = seat
    if (seat) this.dismount(seat.x, seat.z, seat.heading, seat)
  }

  // --- leaving -------------------------------------------------------------------------------------

  private beginLeaving(exit: Vec2): void {
    this.exit = exit
    this.cruise = Math.max(this.cruise, CONFIG.er.walkSpeed)
    if (this.seat) {
      this.leave = 'standing'
      this.standUp()
    } else {
      this.leave = 'walking'
      this.moveTo(exit)
    }
  }

  private thinkLeaving(): void {
    if (this.leave === 'standing' && this.done) {
      this.leave = 'walking'
      this.moveTo(this.exit)
    } else if (this.leave === 'walking' && this.done) {
      this.leave = 'fading'
      this.fadeOut()
    }
  }

  /** True while the patient walks out or fades (the companion goes with them). */
  get isLeaving(): boolean {
    return this.leave !== 'none' || this.state === 'admittedOut.riding' || this.becameInpatient
  }

  /** Where they leave the building (the entrance), for the companion. */
  get exitSpot(): Vec2 {
    return this.state.startsWith('admittedOut') && this.bed === null ? this.world.liftFor(this.pos) : this.exit
  }

  override onRemoved(world: World): void {
    world.detach(this)
    this.pathway.send({ type: 'OUT' })
    this.pathway.stop()
    world.er.remove(this.c.id)
    world.seats.releaseBy(this.c.id)
    world.patients.delete(this.c.id)
    // a patient who became a ward patient keeps their name (the new object releases it when they go home)
    if (!this.becameInpatient) world.releaseName(this.c.name)
  }
}
