/**
 * An ER patient: a walk-in who checks in and waits, or an ambulance arrival on a stretcher. The xstate pathway
 * (pathway.machine.ts) decides when and which way; this controller is its host. On every state entry it sets the
 * emote and mood, claims what the stage needs (a queue place, a seat, a porter) and writes the event line; each step
 * it finishes the physical part (arrive, sit, lie down, get on a wheelchair) and sends the machine the event that
 * says so. Staff and porters call the small public methods below at the moments they meet the patient.
 */
import { staffName } from '@/content/staff'
import { admitChanceFor } from '@/content/admissions'
import { erLine, ER_EVENTS, joinCareItems } from '@/content/erEvents'
import { hasTests, protocolById, testForReason, type ErTest } from '@/content/imaging'
import { CONFIG } from '../config'
import type { BedAssignment } from '../beds/board'
import type { Booking, ScanSubject } from '../imaging/booking'
import type { ScannerSites } from '../imaging/sites'
import type { PeopleContext } from '../people'
import { DEPARTURES, HEALTH_KIOSKS, roomById, type Spot } from '../places'
import type { Rng } from '../rng'
import type { DrawTicket, LabOrder, ScannerState, SeatSpec, Vec2, VitalsReading } from '../types'
import type { KioskSubject } from '../vitals/ports'
import type { Walker } from '../walker'
import { ageWalkFactor, drawVisitorAge } from '../population/age'
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
  type TestBundle,
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

/** What the reason needs beyond the bedside care: a scan, only bloods, or nothing. */
export type TestKind = 'none' | 'blood' | 'imaging'

/** S1: which step of the bay stay a placed patient is in, and how far through it. */
export interface BayStep {
  step: 'wait' | 'care' | 'waitExam' | 'exam' | 'results' | 'review'
  progress: number
}

/** The test bundle for a reason; a reason the imaging content does not know gets no tests. */
function knownTest(text: string): ErTest {
  try {
    return testForReason(text)
  } catch {
    return { chance: 0, redFlag: false, bloods: null, ecg: false, imaging: null }
  }
}

/** The admission profile's chance for a reason (0: never admitted); null when the content has no profile or leaves it to the acuity table. */
function knownAdmitChance(text: string): number | null {
  try {
    return admitChanceFor(text)
  } catch {
    return null
  }
}

function lcFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** The kiosk detour is capped: this long from the offer in the line, and this long once on the platform (then a partial reading is kept). */
export const KIOSK_LINE_SECONDS = 300
export const KIOSK_SESSION_SECONDS = 180
/**
 * Optional brake on the kiosk detour: a walk-in only stops at a kiosk when at least this many patients are already waiting for triage ahead of
 * them. The default 0 is the brief (every eligible walk-in rolls `config.vitals.erUseChance`). Measured over four seeds of the 07:30-12:30 morning
 * (bloods live, real kiosks): left-without-being-seen averaged 8.4 % with no detour, 9.5 % with the detour at 0 and 9.9 % at 2, which is inside the
 * seed-to-seed noise (0-16 %), so the brake is off.
 */
export const kioskTuning = { minAhead: 0 }

/** Where a standing patient waits when the lobby has no free seat. */
const STANDING: Record<'triage' | 'er', Vec2> = {
  triage: { x: -49, z: -3.4 },
  er: { x: -49, z: 3.4 },
}

export class ErPatient extends Actor implements PathwayHost, ScanSubject, KioskSubject {
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
  /** What the reason needs beyond the bedside care: a scan (`imaging`), only bloods, or nothing. */
  readonly testKind: TestKind
  /** The complaint's bundle (content/imaging.json) and the lab panel the nurse draws. */
  readonly bundle: TestBundle
  readonly testBloods: string | null
  /** A seeded adult age (synthetic), for the walking pace. */
  readonly age: number
  /** The bedside bloods: the lab order once the nurse has drawn them, and whether the tubes have gone. */
  bloodOrder: LabOrder | null = null
  tubesSent = false
  private bloodsTimer = false
  /** The protocol id of the scan, for `testKind === 'imaging'`. */
  readonly protocolId: string | null
  /** Wave 1: ER bloods are drawn at the bedside, never at the draw centre: these stay for the draw-centre code that still names them. */
  readonly liveBlood = false
  /** W4: the V ticket at the blood draw centre, from the moment the doctor orders the bloods. */
  readonly drawTicket: DrawTicket | null = null
  readonly drawFinishedFlag = false
  /**
   * W4 results lounge: the hall chair this discharge-bound patient waits in for their results (claimed when the bloods are ordered), and whether
   * they have left their bay for it. While `loungeActive` the lounge chair is this patient's `baySeat`: the porter takes them back to it, the
   * companion stands by it, and `BACK_IN_BAY` means "back on the chair".
   */
  readonly loungeSeat: SeatSpec | null = null
  readonly loungeActive = false
  readonly usedLounge = false
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
  /** W4 kiosk detour (a vitals session while waiting for triage): where they are in it. */
  private kioskPhase: 'none' | 'offered' | 'queueing' | 'standingUp' | 'toKiosk' | 'using' | 'toStool' | 'onStool' | 'back' = 'none'
  private kioskStool: SeatSpec | null = null
  /** The nurse or paramedic they follow, and the seat they are being taken to. */
  private escort: Actor | null = null
  private escortSeat: SeatSpec | null = null
  private phase: 'none' | 'standingForEscort' | 'escorting' | 'standingFromTriage' | 'wheeling' = 'none'
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
  /** S1: true only inside `warmStart` (the entry hook of the first state skips walking to a seat they already hold). */
  private warmed = false
  /** S1: a warm-placed waiting patient is not called before this sim time (so the waiting rows are still full when the hidden pre-roll ends). */
  private readyHoldUntil = 0
  /** Sim time the patient was last seen leaving the department's care (for tests). */
  outcome: 'discharged' | 'admitted' | 'lwbs' | null = null

  constructor(init: PatientInit) {
    super(init.id, 'patient', init.name, init.at, init.heading, init.walker, 'everyday')
    this.world = init.world
    this.crowdWalker = init.world.walkerFor
    this.prng = init.rng
    this.walkAnim = 'walk'
    // an old patient walks slower (Wave 1: CONFIG.people.ageWalkFactor), from a forked draw so no stream shifts
    this.age = drawVisitorAge(init.rng.fork('age'))
    this.cruise = CONFIG.er.walkSpeed * (0.88 + (this.entity.variant % 25) / 100) * ageWalkFactor(this.age)
    this.entity.mood = 'unwell'
    this.entity.stage = 'arriving'
    const test = knownTest(init.reason.text)
    const scan = test.imaging !== null && init.world.imaging !== null
    this.protocolId = scan ? test.imaging : null
    this.testBloods = test.bloods
    this.bundle = {
      chance: test.chance,
      bloods: test.bloods !== null,
      ecg: test.ecg,
      imaging: scan,
      // F-27: a CT for a stroke, collapse or fit is ordered early for priority 1-2; a chest pain gets its ECG at triage (an ambulance crew has done its own)
      imagingEarly: scan && protocolById(test.imaging!).modality === 'ct',
      triageEcg: test.triageEcg === true && !init.ambulance,
    }
    this.testKind = scan ? 'imaging' : hasTests(test) && test.chance > 0 ? 'blood' : 'none'
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
        bundle: this.bundle,
        admitChance: knownAdmitChance(this.c.reason),
        triageScale: () => (this.hasKioskVitals() ? CONFIG.vitals.triageWithVitalsFactor : 1),
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
    // on the trolley for every bay step after the walk in; no doctor is held across a wait for results or the nurse
    if ((state.startsWith('inBay.') && state !== 'inBay.walking') || state === 'tests.awaitingResults') c.onTrolley = true
    if (state.startsWith('tests.') || state === 'inBay.waitingCare' || state === 'inBay.care' || state === 'decision') c.doctorId = null
    switch (state) {
      case 'arriving':
        w.say('patientArrived', erLine(c.ambulance ? 'patient.ambulanceArrived' : 'patient.arrived', { patient: c.name, reason: lcFirst(c.reason) }), { subjectId: c.id })
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
        w.say('checkedIn', erLine(this.queueKey === 'reception' ? 'patient.checkedInDesk' : 'patient.checkedInKiosk', { patient: c.name }), { subjectId: c.id })
        this.entity.mood = 'waiting'
        this.showEmote('hourglass', w.t)
        // S1 warm start: already seated where they wait, and no kiosk detour for somebody who has been here a while
        if (!this.warmed) {
          this.seekSeat('triage')
          this.offerKiosk()
        }
        break
      case 'triage.walking':
        this.cancelKiosk()
        this.showEmote('none', w.t)
        break
      case 'triage.assessing':
        this.entity.mood = 'neutral'
        // W4: the nurse's own reading goes into the record beside the kiosk's (and a patient with kiosk vitals is assessed faster)
        w.vitals?.recordTriage(c.id, c.name, c.nurseId ?? 'nurse-T1')
        break
      case 'waitingDoctor':
        this.entity.mood = 'waiting'
        this.showEmote('hourglass', w.t)
        if (c.ambulance) {
          c.ready = true
          c.readyAt = w.t
          c.from = this.pos
        } else if (c.critical) {
          // priority 1-2 walk-in: no triage queue; they sit in the ER rows (the `think` loop makes them ready) until a bay is theirs
          w.say('triaged', erLine('patient.triagedCritical', { patient: c.name, priority: c.acuity }), { subjectId: c.id })
          if (!this.warmed) this.seekSeat('er')
        } else {
          w.say('triaged', erLine('patient.triaged', { nurse: staffName(c.nurseId ?? 'nurse-T1'), patient: c.name, priority: c.acuity }), {
            subjectId: c.id,
            actorId: c.nurseId ?? undefined,
          })
          w.er.releaseTriageBay(c)
          // S1 warm start: triaged some time ago and already seated in the ER waiting rows
          if (!this.warmed) {
            this.phase = 'standingFromTriage'
            this.standUp()
          }
        }
        break
      case 'inBay.walking':
        this.showEmote('none', w.t)
        break
      case 'inBay.waitingCare':
        c.trolleyAt = c.trolleyAt > 0 ? c.trolleyAt : w.t
        this.entity.mood = 'unwell'
        this.showEmote('bed', w.t)
        break
      case 'inBay.care': {
        const nurse = staffName(c.careBy ?? 'nurse-ER1')
        // F-26: a cannula only when the visit needs one (bloods, a scan with contrast) or the patient is priority 1-3; a cold or a cut finger gets observations
        const parts: string[] = [ER_EVENTS.careItems.observations]
        if (ctx.needsBloods || ctx.needsImaging || c.acuity <= 3) parts.push(ER_EVENTS.careItems.cannula)
        // F-27: the ECG was already recorded at triage or in the waiting area: not done twice
        const ecgNow = ctx.needsEcg && !ctx.ecgDone
        if (ecgNow) parts.push(ER_EVENTS.careItems.ecg)
        if (ctx.needsBloods) parts.push(ER_EVENTS.careItems.bloods)
        w.say('testsOrdered', erLine('patient.care', { nurse, items: joinCareItems(parts), patient: c.name, bay: c.bay + 1 }), {
          subjectId: c.id,
          actorId: c.careBy ?? undefined,
        })
        // a priority 1-2 walk-in is triaged in the bay by the same nurse
        if (c.critical) w.vitals?.recordTriage(c.id, c.name, c.careBy ?? 'nurse-ER1')
        this.showEmote(ecgNow ? 'scan' : 'none', w.t)
        break
      }
      case 'inBay.waitingExam':
        this.entity.mood = 'unwell'
        this.showEmote('bed', w.t)
        // the nurse has drawn the bloods: the lab has an order now, and she takes the tubes to the tube station
        if (ctx.needsBloods) this.drawBedsideBloods()
        break
      case 'inBay.exam':
        w.say('seenByDoctor', erLine('patient.seenByDoctor', { doctor: staffName(c.doctorId ?? 'doc-ER1'), patient: c.name, bay: c.bay + 1 }), {
          subjectId: c.id,
          actorId: c.doctorId ?? undefined,
        })
        this.showEmote('none', w.t)
        break
      case 'inBay.waitingReview':
        this.showEmote('bed', w.t)
        w.say('resultsBack', erLine('patient.resultsBack', { patient: c.name }), { subjectId: c.id })
        break
      case 'inBay.review':
        w.say('seenByDoctor', erLine('patient.review', { doctor: staffName(c.doctorId ?? 'doc-ER1'), patient: c.name }), {
          subjectId: c.id,
          actorId: c.doctorId ?? undefined,
        })
        this.showEmote('none', w.t)
        break
      case 'tests.waitingPorter': {
        // only the scan takes the patient out of the bay (the bloods were drawn at the bedside)
        const proto = protocolById(this.protocolId!)
        if (ctx.earlyScan) {
          // F-27: ordered by the nurse as the care step ends, before the doctor has seen the patient; the bloods she drew go to the tube too
          w.say('testsOrdered', erLine('patient.scanOrderedEarly', { nurse: staffName(c.careBy ?? 'nurse-ER1'), scan: proto.name, patient: c.name, priority: c.acuity }), {
            subjectId: c.id,
            actorId: c.careBy ?? undefined,
          })
          if (ctx.needsBloods) this.drawBedsideBloods()
        } else {
          w.say('testsOrdered', erLine('patient.scanOrdered', { doctor: staffName(c.doctorId ?? 'doc-ER1'), scan: proto.name, patient: c.name }), {
            subjectId: c.id,
            actorId: c.doctorId ?? undefined,
          })
        }
        this.booking = w.imaging!.requestErExam(this, proto.id)
        this.showEmote('hourglass', w.t)
        break
      }
      case 'tests.toLab':
        this.showEmote('scan', w.t)
        break
      case 'tests.testing':
        this.showEmote('scan', w.t)
        break
      case 'tests.waitingReturn':
        this.showEmote('hourglass', w.t)
        this.pickedSent = false
        break
      case 'tests.returning':
        this.showEmote('none', w.t)
        break
      case 'tests.awaitingResults':
        this.showEmote('hourglass', w.t)
        break
      case 'decision':
        break
      case 'leaving.home': {
        const mins = Math.max(1, Math.round((w.t - c.arrivedAt) / 60))
        w.say('discharged', erLine('patient.discharged', { patient: c.name, minutes: mins }), { subjectId: c.id })
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
        w.say('leftWithoutBeingSeen', erLine('patient.leftWithoutBeingSeen', { patient: c.name, minutes: mins }), { subjectId: c.id })
        w.er.finish(c, 'lwbs', w.t)
        this.outcome = 'lwbs'
        this.entity.mood = 'unwell'
        this.showEmote('hourglass', w.t, 8)
        this.cancelKiosk(false)
        this.releaseWaitSeat()
        this.beginLeaving(DEPARTURES.entrance)
        break
      }
      case 'admittedOut.waitingPorter': {
        // the bed manager looks for a ward bed; with none (or no bed board) the patient goes upstairs as in M3
        this.bed = w.beds !== null && c.bay >= 0 ? w.beds.requestBed(c.id, c.name, c.bay, w.t) : null
        if (this.bed) {
          w.say('admitted', erLine('patient.admittedRoom', { patient: c.name, ward: roomById(this.bed.roomId).ward, room: this.bed.roomId }), { subjectId: c.id, roomId: this.bed.roomId })
          // already in a gown on the trolley: no change of clothes when they reach the bed
          this.entity.outfit = 'gown'
        } else {
          w.say('admitted', erLine('patient.admittedUpstairs', { patient: c.name }), { subjectId: c.id })
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

  /** F-27 (host): the triage nurse has recorded the ECG of a chest pain, at triage or in the waiting area. */
  triageEcg(_ctx: PathwayContext): void {
    const w = this.world
    this.world.say('testsOrdered', erLine('patient.triageEcg', { patient: this.c.name }), { subjectId: this.c.id })
    this.showEmote('scan', w.t, 8)
  }

  // --- called by the world, staff and porters ------------------------------------------------------------

  /**
   * S1 in-flight warm: put this (started) patient mid-pathway, as if they had been here for `waitedSeconds`. They are seated or lying where they
   * would be, and the machine enters the matching state through its WARM_* event, so the normal entry hooks run and the staff pick them up as
   * they would anyone. For 'bay' the department must already have promised a bay (`ErDepartment.occupyBay`). Nothing is logged by the caller's
   * `world.quiet`. `holdSeconds`: how long a waiting patient is left uncalled (the staff are busy elsewhere). Call once, right after `start()`.
   */
  warmStart(stage: 'triage' | 'doctor' | 'bay', waitedSeconds: number, holdSeconds = 0, bay: BayStep = { step: 'wait', progress: 0 }): void {
    const w = this.world
    const c = this.c
    this.warmed = true
    this.arrivedSent = true
    c.arrivedAt = w.t - waitedSeconds
    if (stage === 'bay') {
      const seat = this.baySeat
      if (seat) this.placeOnSeat(seat)
      c.trolleyAt = w.t - waitedSeconds * 0.5
      const p = bay.progress
      switch (bay.step) {
        case 'wait':
          this.pathway.send({ type: 'WARM_BAY' })
          break
        case 'care':
          this.pathway.send({ type: 'WARM_CARE', progress: p })
          break
        case 'waitExam':
          this.pathway.send({ type: 'WARM_WAITEXAM' })
          break
        case 'exam':
          this.pathway.send({ type: 'WARM_EXAM', progress: p })
          break
        case 'results':
          this.pathway.send({ type: 'WARM_RESULTS' })
          break
        case 'review':
          this.pathway.send({ type: 'WARM_REVIEW', progress: p })
          break
      }
      this.warmed = false
      // the bloods of a patient placed after the nurse's care were drawn and are on their way (a nurse's errand is not replayed)
      const ctx = this.pathway.getSnapshot().context
      if (ctx.needsBloods && !ctx.bloodsReady && (bay.step === 'waitExam' || bay.step === 'exam' || bay.step === 'results')) this.drawBedsideBloods(true)
      return
    }
    const group = stage === 'triage' ? 'triage' : 'er'
    const seat = w.claimWaitingSeat(c.id, group, this.pos)
    if (seat) {
      this.waitSeat = seat
      this.placeOnSeat(seat)
    } else {
      this.placeAt(STANDING[group].x, STANDING[group].z, -Math.PI / 2)
    }
    // they became ready when they began waiting: first come, first served keeps its order
    const readyAt = Math.min(w.t - 1, c.arrivedAt + (stage === 'triage' ? 20 : 20 + waitedSeconds * 0.5))
    this.pathway.send({ type: stage === 'triage' ? 'WARM_TRIAGE' : 'WARM_DOCTOR' })
    this.warmed = false
    c.readyAt = readyAt
    c.from = this.pos
    if (holdSeconds > 0) {
      // not called yet: `think` makes them ready once the hold is over
      this.readyHoldUntil = w.t + holdSeconds
      this.keptReadyAt = readyAt
    } else {
      c.ready = true
    }
  }

  // --- the bedside bloods (Wave 1) -------------------------------------------------------------------------

  /**
   * The nurse has drawn the bloods: the lab gets the order, and the nurse takes the tubes to the tube station (`tubesSent` says they went). With
   * `sendNow` (a warm start) the tubes go at once. A world with no lab brings the results back on a timer, so nobody waits for ever.
   */
  private drawBedsideBloods(sendNow = false): void {
    if (this.bloodOrder !== null || this.bloodsTimer) return
    const w = this.world
    const order = this.testBloods !== null ? w.bedside.order(this, this.testBloods) : null
    if (order === null) {
      this.bloodsTimer = true
      this.tubesSent = true
      w.clock.setTimeout(() => this.bloodsVerified(), this.prng.fork('bloods').between(CONFIG.er.resultsSeconds) * 1000)
      return
    }
    this.bloodOrder = order
    if (sendNow) {
      this.tubesSent = true
      w.bedside.send(order)
    }
  }

  /** The nurse puts the tubes into the pneumatic tube. */
  sendTubes(): void {
    if (this.tubesSent || this.bloodOrder === null) return
    this.tubesSent = true
    this.world.bedside.send(this.bloodOrder)
    this.world.say('samplesSent', erLine('patient.tubesSent', { patient: this.c.name }), { subjectId: this.c.id })
  }

  /** The lab verified every test of the bedside bloods. */
  bloodsVerified(): void {
    if (this.state !== 'gone') this.pathway.send({ type: 'BLOODS_READY' })
  }

  /** Is the patient waiting for their bloods to be taken to the tube station? */
  get tubesWaiting(): boolean {
    return this.bloodOrder !== null && !this.tubesSent
  }

  /** The ER nurse is at the bedside: the care step starts. */
  nurseHere(): void {
    this.pathway.send({ type: 'NURSE_HERE' })
  }

  /** The doctor is back at the bedside with the results. */
  reviewHere(): void {
    this.pathway.send({ type: 'REVIEW_HERE' })
  }

  get careSeconds(): number {
    return this.pathway.getSnapshot().context.careSeconds
  }

  get reviewSeconds(): number {
    return this.pathway.getSnapshot().context.reviewSeconds
  }

  /** Progress (0..1) of the step the patient is in, from the machine's own context (used when staff are placed mid-way). */
  get needsEcg(): boolean {
    return this.pathway.getSnapshot().context.needsEcg
  }

  get needsBloods(): boolean {
    return this.pathway.getSnapshot().context.needsBloods
  }

  get needsImaging(): boolean {
    return this.pathway.getSnapshot().context.needsImaging
  }

  /** A nurse has brought a wheelchair for a priority 1-2 walk-in: get on it. */
  wheelOn(nurse: Actor): void {
    this.world.vitals?.abort(this.c.id)
    this.releaseWaitSeat()
    this.phase = 'wheeling'
    this.loadOn(nurse, 'wheelchair')
  }

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
    this.world.vitals?.abort(this.c.id)
    this.kioskPhase = 'none'
    this.kioskStool = null
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
    return this.phase === 'escorting' || this.phase === 'standingForEscort' || this.phase === 'wheeling'
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
    if (this.state === 'admittedOut.waitingPorter') {
      this.world.er.vacate(this.c, this.world.t)
      if (this.bed) this.world.beds?.boardingEnded(this.c.id, this.world.t)
    }
    this.world.attach(pusher, this)
    this.mountOn(pusher, kind)
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
    if (kind === 'fromImaging') return this.scanFinishedFlag
    return true
  }

  /** The draw centre is no longer used by ER patients (Wave 1: bloods are drawn at the bedside); the porter code still names these. */
  drawArrived(): void {}

  unloadAtLab(): void {
    this.world.detach(this)
    this.dismount(this.walker.x, this.walker.z, this.walker.heading, null)
  }

  // --- the health kiosk detour (KioskSubject, W4) ------------------------------------------------------------------------

  private kioskStand: Spot | null = null
  private kioskLine: Spot | null = null
  private kioskLineSent = false
  /** Seconds since the offer was accepted, and since they first reached the platform (0 until then). */
  private kioskHoldT = 0
  private kioskPlatformT = 0
  private kioskOnPlatform = false
  /** The moment they would have been ready for triage: restored when the session ends, so they keep their first-come place. */
  private keptReadyAt: number | null = null

  /** Kiosk vitals are in the record: triage takes a little less time. */
  private hasKioskVitals(): boolean {
    return this.world.vitals?.readingsFor(this.c.id).some((r) => r.source === 'kiosk') ?? false
  }

  /**
   * A walk-in with acuity 3 or less urgent sometimes uses a health kiosk while waiting for triage. While they are in the kiosk's line or
   * its session they are NOT ready for triage (no nurse calls them away mid-session), but they keep their first-come place: `keptReadyAt` is
   * restored when the session ends. The detour is capped (`KIOSK_LINE_SECONDS` from the offer, `KIOSK_SESSION_SECONDS` once on the platform):
   * past it the session is aborted (the service keeps the partial reading) and they go back to wait.
   */
  private offerKiosk(): void {
    const w = this.world
    const c = this.c
    if (c.ambulance || w.vitals === null || c.acuity < CONFIG.vitals.erMinAcuity) return
    // a fork of the patient's stream: the draw never shifts the draws the pathway makes
    if (!this.prng.fork('kiosk').chance(CONFIG.vitals.erUseChance)) return
    if (this.waitingAhead() < kioskTuning.minAhead) return
    // the phase is set first: the service may tell them where to stand in the same breath
    this.kioskPhase = 'offered'
    if (!w.vitals.offer(this, 'vitals')) {
      this.kioskPhase = 'none'
      return
    }
    this.keptReadyAt = w.t
    this.kioskHoldT = 0
    this.kioskPlatformT = 0
    this.kioskOnPlatform = false
    this.kioskLine = null
    this.kioskLineSent = false
  }

  /** Patients who arrived earlier and are still waiting for triage (and so will be taken before this one). */
  private waitingAhead(): number {
    let n = 0
    for (const o of this.world.er.cases.values()) if (o !== this.c && o.state === 'waitingTriage' && !o.ambulance && o.arrivedAt <= this.c.arrivedAt) n++
    return n
  }

  /** Where to stand in the kiosk's line (place 0 is the front). They get up from their seat (which stays theirs) and walk there. */
  kioskQueued(spot: Spot, place: number): void {
    if (this.state !== 'waitingTriage' || (this.kioskPhase !== 'offered' && this.kioskPhase !== 'queueing')) return
    this.kioskLine = spot
    this.kioskPhase = 'queueing'
    this.showEmote(place > 0 ? 'hourglass' : 'none', this.world.t)
    if (this.seat) {
      this.kioskLineSent = false
      this.standUp()
    } else {
      this.kioskLineSent = true
      this.moveTo(spot.at, { face: spot.heading })
    }
  }

  kioskCalled(_index: number, stand: Spot): void {
    if (this.state !== 'waitingTriage' || this.kioskPhase === 'none') return
    this.kioskStand = stand
    this.showEmote('scan', this.world.t)
    if (this.seat) {
      this.kioskPhase = 'standingUp'
      this.standUp()
    } else {
      this.kioskPhase = 'toKiosk'
      this.moveTo(stand.at, { face: stand.heading })
    }
  }

  /** Called but not on the platform in time: the kiosk starts anyway, so glide onto it. */
  kioskForced(stand: Spot): void {
    if (this.state !== 'waitingTriage' || this.kioskPhase === 'none' || this.kioskPhase === 'toStool' || this.kioskPhase === 'onStool') return
    this.kioskStand = stand
    this.kioskPhase = 'using'
    this.kioskOnPlatform = true
    if (this.seat) this.standUp()
    this.slideTo(stand.at.x, stand.at.z, stand.heading, 0.9, 'stand')
  }

  kioskSit(seat: Spot): void {
    if (this.state !== 'waitingTriage' || this.kioskPhase === 'none' || this.kioskPhase === 'offered') return
    const stool = this.stoolSeat(seat)
    this.kioskStool = stool
    this.kioskPhase = 'toStool'
    this.sitOn(stool)
  }

  kioskDone(_reading: VitalsReading): void {
    if (this.kioskPhase === 'none') return
    this.endKiosk()
  }

  /** The stool as a seat: the layout's `kioskBp:<i>` if it has one, else one made from the anchor. */
  private stoolSeat(spot: Spot): SeatSpec {
    let idx = HEALTH_KIOSKS.findIndex((k) => Math.abs(k.bpSeat.at.x - spot.at.x) < 0.05 && Math.abs(k.bpSeat.at.z - spot.at.z) < 0.05)
    if (idx < 0) idx = 0
    const id = `kioskBp:${idx}`
    const real = this.world.seats.all.find((x) => x.id === id)
    if (real) return real
    const k = HEALTH_KIOSKS[idx]
    return { id, kind: 'kioskBp', area: 'lobby', x: spot.at.x, z: spot.at.z, heading: spot.heading, pose: 'sit', height: 0.48, approach: { x: k.stand.at.x, z: k.stand.at.z } }
  }

  /** The session is over (or cut short): back up and back to the waiting seat (or any seat); they become ready for triage there. */
  private endKiosk(): void {
    this.kioskStool = null
    this.kioskLine = null
    this.kioskOnPlatform = false
    if (this.state !== 'waitingTriage') {
      this.kioskPhase = 'none'
      return
    }
    this.showEmote('hourglass', this.world.t)
    if (this.seat) {
      this.kioskPhase = 'back'
      this.standUp()
    } else {
      this.kioskPhase = 'none'
      if (this.waitSeat) this.sitOn(this.waitSeat)
      else this.seekSeat('triage')
    }
  }

  /** The detour is dropped for good (called to triage, or they gave up): the service keeps the partial reading. */
  private cancelKiosk(standUp = true): void {
    if (this.kioskPhase === 'none') return
    this.world.vitals?.abort(this.c.id)
    const onStool = standUp && this.kioskStool !== null && this.seat === this.kioskStool
    this.kioskPhase = 'none'
    this.kioskStool = null
    this.kioskLine = null
    this.kioskOnPlatform = false
    if (onStool) this.standUp()
  }

  /** True while the kiosk detour drives the patient (the ordinary waiting-room logic must not seat or ready them). */
  private thinkKiosk(dt: number): boolean {
    const ph = this.kioskPhase
    if (ph === 'none') return false
    if (ph === 'back') {
      if (this.done) {
        this.kioskPhase = 'none'
        if (this.state === 'waitingTriage') {
          if (this.waitSeat) this.sitOn(this.waitSeat)
          else this.seekSeat('triage')
        }
      }
      return true
    }
    // the caps: past them the session is aborted (a partial reading is kept) and they go back to wait
    this.kioskHoldT += dt
    if (this.kioskOnPlatform) this.kioskPlatformT += dt
    if (this.kioskOnPlatform ? this.kioskPlatformT > KIOSK_SESSION_SECONDS : this.kioskHoldT > KIOSK_LINE_SECONDS) {
      this.world.vitals?.abort(this.c.id)
      this.endKiosk()
      return true
    }
    switch (ph) {
      case 'offered':
        // still in their seat (or walking to one) until the service says where to stand
        if (this.waitSeat === null && this.done && this.due(dt, 2)) this.seekSeat('triage')
        return true
      case 'queueing':
        if (!this.kioskLineSent && this.done && this.seat === null && this.kioskLine) {
          this.kioskLineSent = true
          this.moveTo(this.kioskLine.at, { face: this.kioskLine.heading })
        }
        return true
      case 'standingUp':
        if (this.done && this.kioskStand) {
          this.kioskPhase = 'toKiosk'
          this.moveTo(this.kioskStand.at, { face: this.kioskStand.heading })
        }
        return true
      case 'toKiosk':
        if (this.done) {
          this.kioskPhase = 'using'
          this.kioskOnPlatform = true
        }
        return true
      case 'toStool':
        if (this.done && this.seat === this.kioskStool) {
          this.kioskPhase = 'onStool'
          this.entity.anim = 'armIn'
        }
        return true
      default:
        return true
    }
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

  /**
   * At the lift: the stretcher goes up to the ward, and the patient fades out with it. (R2: the porter holds the lobby's stretcher slot for this
   * fade - `world.lifts.claimFade`, porter.ts - so a lobby never holds two stretchers, or a stretcher and a MealBot, at once.)
   */
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
        if (this.thinkKiosk(dt)) break
        if (this.phase === 'standingFromTriage') {
          if (this.done) {
            this.phase = 'none'
            this.seekSeat('er')
          }
          break
        }
        if (c.ambulance) break
        if (!c.ready && this.done && w.t >= this.readyHoldUntil) {
          c.ready = true
          // after a kiosk session they keep the place they had when it began
          c.readyAt = this.keptReadyAt !== null && this.keptReadyAt < w.t ? this.keptReadyAt : w.t
          this.keptReadyAt = null
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
        // the scanner has taken us (scanAssigned): now the porter may come
        if (!this.scanJobAsked && this.scanSeat !== null) {
          this.scanJobAsked = true
          w.porters.request('toImaging', c.id, w.t)
        }
        this.sendPicked()
        break
      case 'tests.toLab':
        if (!this.labSent && this.mode === 'static' && this.done && this.seat && this.seat === this.scanSeat) {
          this.labSent = true
          this.pathway.send({ type: 'AT_LAB' })
        }
        break
      case 'tests.waitingReturn':
        this.scanRequestReturn()
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
    this.cruise = Math.max(this.cruise, CONFIG.er.walkSpeed * ageWalkFactor(this.age))
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
    if (this.kioskPhase !== 'none') world.vitals?.abort(this.c.id)
    world.blood?.releaseHold(this.c.id)
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
