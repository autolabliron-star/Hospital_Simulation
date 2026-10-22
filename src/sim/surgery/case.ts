/**
 * R2: one surgical case, from the entrance to going home (or up to the surgical ward). `SurgeryCase` is the journey: it creates the patient and
 * their companion, sends them through reception, the lift, the waiting chairs, a pre-op bay, the OR, a recovery bay and the lounge, borrows the
 * team for the jobs that involve them (the pre-op nurse leading, the doctors' visits, the porter's stretcher), and walks the ten theatre phases
 * with the robot docked for the console phase. Every duration is the plan's (plan.ts); physical things (a person arriving, a seat, the porter)
 * only ever DELAY the next step, never shorten a phase.
 *
 * Stages, in order (CasePhase in brackets):
 *   scheduled [scheduled]; arriving, liftUp, waiting [arrived]; toBay, gown, nurseCheck, settled, anaesVisit, surgeonVisit, ready [preOp];
 *   fetch, toTheatre [toTheatre]; in .. out [the theatre phases]; toPacu, pacu [pacu]; phase2 [phase2] (day cases);
 *   wardFetch, wardPush, wardFade, leaving, leaveWalk [leaving]; done [done]
 *
 * A warm start (`warm(t)`) puts the case where the plan says it is at time t, with the same bookkeeping a live run would have made.
 */
import { surgeryLine, SURGERY_COPY } from '@/content/surgery'
import { staffName } from '@/content/staff'
import { CONFIG } from '../config'
import { headingTo, callSpot, inDoorway } from '../er/spots'
import type { World } from '../er/world'
import type { LiftBank, LiftTrip } from '../lifts'
import { LIFTS, ARRIVALS, DEPARTURES, VEHICLE_AHEAD } from '../places'
import { isWalkable } from '../nav/layout'
import type { Rng } from '../rng'
import type { CasePhase, SeatSpec, SimEventType, SurgeryCaseView, Vec2 } from '../types'
import { SurgicalPatient, SurgeryCompanion, type Staffer, type Title } from './actors'
import { ROOM_PHASES, timelineOf, type PlannedCase, type RoomPhase, type Timeline } from './plan'
import type { SeatRef, SurgerySites } from './sites'
import type { Team } from './team'

export type Stage =
  | 'scheduled'
  | 'arriving'
  | 'liftUp'
  | 'waiting'
  | 'toBay'
  | 'gown'
  | 'nurseCheck'
  /** S1: an early patient lying in the bay until the doctors' visits fit in front of wheels-in (Timeline.visitsAt). */
  | 'settled'
  | 'anaesVisit'
  | 'surgeonVisit'
  | 'ready'
  | 'fetch'
  | 'toTheatre'
  | RoomPhase
  | 'toPacu'
  | 'pacu'
  | 'phase2'
  | 'wardFetch'
  | 'wardPush'
  | 'wardFade'
  | 'leaving'
  | 'leaveWalk'
  | 'done'

const ROOM_SET: ReadonlySet<string> = new Set(ROOM_PHASES)

/**
 * F-30: the WHO surgical safety checklist, said at the phase boundaries a live run walks through (a warm start is silent, as for the other
 * events): sign-in as the induction begins, time-out as the first port goes in, sign-out as the patient is about to leave theatre.
 * The recovery discharge criteria are said where the patient leaves recovery (`beginPhase2`, `beginWard`). The lines are `SURGERY_COPY.checklist`.
 */
const WHO_AT: Partial<Record<RoomPhase, { type: SimEventType; line: 'signIn' | 'timeOut' | 'signOut' }>> = {
  induction: { type: 'whoSignIn', line: 'signIn' },
  ports: { type: 'whoTimeOut', line: 'timeOut' },
  out: { type: 'whoSignOut', line: 'signOut' },
}

export function casePhaseOf(stage: Stage): CasePhase {
  switch (stage) {
    case 'scheduled':
      return 'scheduled'
    case 'arriving':
    case 'liftUp':
    case 'waiting':
      return 'arrived'
    case 'toBay':
    case 'gown':
    case 'nurseCheck':
    case 'settled':
    case 'anaesVisit':
    case 'surgeonVisit':
    case 'ready':
      return 'preOp'
    case 'fetch':
    case 'toTheatre':
      return 'toTheatre'
    case 'toPacu':
    case 'pacu':
      return 'pacu'
    case 'phase2':
      return 'phase2'
    case 'wardFetch':
    case 'wardPush':
    case 'wardFade':
    case 'leaving':
    case 'leaveWalk':
      return 'leaving'
    case 'done':
      return 'done'
    default:
      return stage
  }
}

/** What a case needs from the suite around it. */
export interface CaseHost {
  readonly world: World
  readonly sites: SurgerySites
  readonly team: Team
  readonly lifts: LiftBank | null
  /** True during a warm start: nothing is logged (the day so far is not news). */
  readonly quiet: boolean
  /** May this case be wheeled in? (The room is empty, turned over and the robot draped.) */
  roomFree(c: SurgeryCase): boolean
  /** Is another case in the room, or on its way in? (The stretcher then waits where it is.) */
  roomBusy(c: SurgeryCase): boolean
  surgeonSeated(): boolean
  /** The state's bay (pre-op or recovery) changed. */
  bayChanged(seatId: string, patientId: string | null, t: number, curtain: boolean): void
  /** A porter that went up with a ward patient comes back at `returnAt`. */
  porterAway(porter: Staffer, returnAt: number, shaft: 'B'): void
  /** The case is over (the patient left the suite for home or the ward). */
  caseFinished(c: SurgeryCase, t: number): void
  /** Something changed that the panels show (a phase, a bay, a time). */
  touch(): void
  stuck(msg: string): void
  say(type: SimEventType, text: string, refs?: { subjectId?: string; actorId?: string }): void
}

/** A wait that never ends is a bug: past these (seconds) a step is forced, and `stuck` is told. */
/** Share of the normal walking pace right after an operation (a slow, careful walk). */
const POSTOP_PACE = 0.5
/** Seconds to get the wheelchair set up beside the lounge seat before they walk out slowly instead. */
const CHAIR_GIVE_UP = 150
const LIMIT = { arriving: 1500, lift: 600, toBay: 480, visit: 900, fetch: 600, toTheatre: 900, console: 300, pacu: 600, ward: 900, leave: 900 }

function fmtMin(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

function jitter(rng: Rng): number {
  return rng.range(-0.8, 0.8)
}

export class SurgeryCase {
  stage: Stage = 'scheduled'
  /** Sim time the current stage began, and (timed stages) when it ends. */
  stageAt = 0
  until = 0
  readonly tl: Timeline
  readonly view: SurgeryCaseView
  patient: SurgicalPatient | null = null
  companion: SurgeryCompanion | null = null
  /** Realised start of each theatre phase. */
  readonly starts: Partial<Record<RoomPhase, number>> = {}
  /** The case's own times (sim seconds, null until they happen). */
  leftRoomAt: number | null = null
  pacuInAt: number | null = null
  pacuOutAt: number | null = null
  turnoverReported = false
  /** The patient's pre-op bed index, and recovery bed index (-1: none). */
  bed = -1
  pacu = -1
  readonly patientName: string
  readonly companionName: string
  private trip: LiftTrip | null = null
  private porter: Staffer | null = null
  /** Who has the stretcher: the porter, or (when he is away at the ward) the pre-op or recovery nurse. */
  private moverTitle: Title = 'porter'
  private sub = 0
  private waitSeat: SeatSpec | null = null
  private compSeat: SeatSpec | null = null
  private loungeSeat: SeatSpec | null = null
  private bedRef: SeatRef | null = null
  private pacuRef: SeatRef | null = null
  private standIdx = 0
  private docked = false
  /** Going home by wheelchair (the family pushes) rather than on foot. */
  private chairOut = false
  private outLoaded = false
  private visitor: Staffer | null = null
  private visitKey = ''
  private arriveSpawnAt = 0
  private subAt = 0

  constructor(
    readonly plan: PlannedCase,
    readonly host: CaseHost,
    readonly rng: Rng,
    names: { patient: string; companion: string },
  ) {
    this.tl = timelineOf(plan)
    this.patientName = names.patient
    this.companionName = names.companion
    this.view = {
      id: plan.id,
      patientId: null,
      name: names.patient,
      procedure: plan.procedure,
      phase: 'scheduled',
      plannedIn: plan.plannedIn,
      wheelsIn: null,
      dockedAt: null,
      consoleStart: null,
      consoleEnd: null,
      wheelsOut: null,
      outcome: plan.outcome,
      bay: null,
    }
  }

  get id(): string {
    return this.plan.id
  }

  get inRoom(): boolean {
    return ROOM_SET.has(this.stage)
  }

  get finished(): boolean {
    return this.stage === 'done'
  }

  /** The case's patient is lying on a bed or the table or sitting in the lounge somewhere on level 2. */
  get active(): boolean {
    return this.stage !== 'scheduled' && this.stage !== 'done'
  }

  private short(): string {
    return SURGERY_COPY.procedures[this.plan.procedure].short
  }

  private enter(stage: Stage, t: number): void {
    this.stage = stage
    this.stageAt = t
    this.sub = 0
    const ph = casePhaseOf(stage)
    if (this.view.phase !== ph) this.view.phase = ph
    if (this.patient !== null) this.patient.entity.stage = ph
    this.host.touch()
  }

  // ------------------------------------------------------------------------------------------------------------------
  // the people
  // ------------------------------------------------------------------------------------------------------------------

  private newPeople(at: Vec2, heading: number, fade: boolean): { patient: SurgicalPatient; companion: SurgeryCompanion } {
    const w = this.host.world
    const patient = new SurgicalPatient(w, this.id, this.patientName, at, heading, w.walkerFor(`${this.id}-patient`), this.rng.fork('patient'))
    const companion = new SurgeryCompanion(w, this.id, this.companionName, { x: at.x - Math.sin(heading) * 0.2, z: at.z + 0.7 }, heading, w.walkerFor(`${this.id}-companion`), patient)
    this.patient = patient
    this.companion = companion
    this.view.patientId = patient.entity.id
    w.hooks.add(patient)
    w.hooks.add(companion)
    if (fade) {
      patient.fadeIn()
      companion.fadeIn()
    }
    return { patient, companion }
  }

  private spawnAtEntrance(t: number, fade: boolean): void {
    const e = ARRIVALS.entrance
    const { patient, companion } = this.newPeople({ x: e.at.x, z: e.at.z + jitter(this.rng.fork('spawn')) }, e.heading, fade)
    patient.beginCheckIn()
    companion.follow = patient
    this.arriveSpawnAt = t
    this.enter('arriving', t)
  }

  private spawnUpstairs(): { patient: SurgicalPatient; companion: SurgeryCompanion } {
    const s = LIFTS.A[2].walkers[0]
    return this.newPeople({ x: s.x, z: s.z }, Math.PI, false)
  }

  /** Remove everything this case made (a re-settle): people, claims, borrowed team. */
  dispose(): void {
    const w = this.host.world
    for (const p of [this.patient, this.companion]) if (p !== null) w.hooks.remove(p)
    this.patient = null
    this.companion = null
    this.host.team.releaseAll(this.id)
    if (this.porter !== null) {
      this.porter.setVehicle('none')
      this.porter = null
    }
    this.host.sites.releaseAll(`${this.id}-patient`)
    this.host.sites.releaseAll(`${this.id}-companion`)
    this.trip = null
  }

  // ------------------------------------------------------------------------------------------------------------------
  // the step
  // ------------------------------------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    switch (this.stage) {
      case 'scheduled':
        if (t >= this.plan.arriveAt) this.spawnAtEntrance(t, true)
        break
      case 'arriving':
        this.stepArriving(t)
        break
      case 'liftUp':
        this.stepLiftUp(t)
        break
      case 'waiting':
        if (t >= this.tl.preOpStart) this.tryBeginBay(t)
        break
      case 'toBay':
        this.stepToBay(t)
        break
      case 'gown':
        this.stepGown(t)
        break
      case 'nurseCheck':
        if (t >= this.until) this.endNurseCheck(t)
        break
      case 'settled':
        if (t >= this.tl.visitsAt) this.beginVisits(t)
        break
      case 'anaesVisit':
        this.stepVisit(t, 'anaesthetist', 'surgeonVisit', this.plan.preOp.anaes)
        break
      case 'surgeonVisit':
        this.stepVisit(t, 'surgeon', 'ready', this.plan.preOp.surgeon)
        break
      case 'ready':
        this.stepReady(t)
        break
      case 'fetch':
        this.stepFetch(t)
        break
      case 'toTheatre':
        this.stepToTheatre(t)
        break
      case 'toPacu':
        this.stepToPacu(t)
        break
      case 'pacu':
        this.stepPacu(t)
        break
      case 'phase2':
        this.stepPhase2(t)
        break
      case 'wardFetch':
        this.stepWardFetch(t)
        break
      case 'wardPush':
        this.stepWardPush(t)
        break
      case 'wardFade':
        this.stepWardFade(t)
        break
      case 'leaving':
        this.stepLeaving(t)
        break
      case 'leaveWalk':
        this.stepLeaveWalk(t)
        break
      case 'done':
        break
      default:
        this.stepRoom(t, dt)
        break
    }
  }

  // --- arrival ----------------------------------------------------------------------------------------------------

  private stepArriving(t: number): void {
    const p = this.patient!
    if (!p.checkedIn) {
      if (t - this.arriveSpawnAt > LIMIT.arriving) {
        this.host.stuck(`${this.id}: not checked in after ${LIMIT.arriving} s`)
        p.checkedIn = true
      }
      return
    }
    this.startRide(t, 1, 2)
    this.enter('liftUp', t)
  }

  /** Patient and companion take lift A between the levels (or, with no lifts in the world, appear at the other lobby). */
  private startRide(t: number, from: 1 | 2, to: 1 | 2, chair = false): void {
    const c = this.companion!
    const p = this.patient!
    c.follow = null
    const lifts = this.host.lifts
    if (lifts === null) {
      this.trip = null
      return
    }
    // (by wheelchair the companion is the pusher and the patient the rider that goes along; otherwise both walk in)
    this.trip = lifts.trip(
      chair ? { ownerId: `${this.id}:${from}to${to}`, shaft: 'A', from, to, pusher: c, walkers: [] } : { ownerId: `${this.id}:${from}to${to}`, shaft: 'A', from, to, walkers: [p, c] },
    )
    void t
  }

  private stepLiftUp(t: number): void {
    const trip = this.trip
    if (trip !== null && !trip.done) {
      if (t - this.stageAt > LIMIT.lift * 2) this.host.stuck(`${this.id}: the lift ride up has not finished after ${LIMIT.lift * 2} s (${trip.phase})`)
      return
    }
    if (trip === null) {
      // no lifts in this world: the party is simply upstairs
      const s = LIFTS.A[2].walkers
      this.patient!.placeAt(s[0].x, s[0].z, Math.PI)
      this.companion!.placeAt(s[1].x, s[1].z, Math.PI)
    }
    this.trip = null
    this.host.say('surgeryArrived', surgeryLine('surgeryArrived', { patient: this.patientName, procedure: this.short() }), { subjectId: this.patient!.entity.id })
    this.seatInWaiting(false)
    this.enter('waiting', t)
  }

  /** Both sit in the pre-op waiting chairs (or stand near them when there are none free). */
  private seatInWaiting(warm: boolean): void {
    const s = this.host.sites
    const p = this.patient!
    const c = this.companion!
    this.waitSeat = s.claimWaiting(p.entity.id, p.pos)
    this.compSeat = s.claimWaiting(c.entity.id, this.waitSeat ?? p.pos)
    const stands = s.spots.waitStand
    const place = (a: SurgicalPatient | SurgeryCompanion, seat: SeatSpec | null) => {
      if (seat !== null) {
        if (warm) a.placeOnSeat(seat)
        else a.sitOn(seat)
      } else {
        const spot = stands[this.standIdx++ % stands.length]
        if (warm) a.placeAt(spot.at.x, spot.at.z, spot.heading)
        else a.moveTo(spot.at, { face: spot.heading })
      }
    }
    place(p, this.waitSeat)
    place(c, this.compSeat)
  }

  // --- pre-op -----------------------------------------------------------------------------------------------------

  private callKey(): string {
    return `${this.id}:call`
  }

  private tryBeginBay(t: number): void {
    const h = this.host
    const bed = h.sites.freePreop()
    if (bed < 0) return
    const nurse = h.team.acquire('preOp', this.id)
    if (nurse === null) return
    const ref = h.sites.preop[bed]
    if (!h.sites.claim(ref, this.patient!.entity.id)) {
      h.team.release('preOp', this.id)
      return
    }
    this.bed = bed
    this.bedRef = ref
    this.view.bay = ref.seat.id
    this.porter = null
    const p = this.patient!
    // the nurse goes to the patient and calls them
    const target = this.waitSeat !== null ? callSpot(this.waitSeat) : { x: p.x, z: p.z }
    nurse.setTask({ key: this.callKey(), at: target, face: headingTo(target, p.pos), anim: 'talk' })
    this.enter('toBay', t)
  }

  private stepToBay(t: number): void {
    const h = this.host
    const nurse = h.team.get('preOp')
    const p = this.patient!
    const ref = this.bedRef!
    switch (this.sub) {
      case 0:
        if (nurse.isAt(this.callKey()) || t - this.stageAt > LIMIT.toBay) {
          if (this.waitSeat !== null) {
            h.world.seats.release(this.waitSeat.id, p.entity.id)
            this.waitSeat = null
          }
          if (p.seat !== null) p.standUp()
          this.sub = 1
        }
        break
      case 1:
        if (p.done && p.mode === 'static') {
          const foot = h.sites.bedFoot(ref)
          const side = h.sites.nurseSide(ref)
          nurse.setTask({ key: `${this.id}:bay`, at: side.at, face: side.heading, anim: 'tablet' })
          p.moveTo(foot.at, { face: foot.heading, leader: nurse })
          this.sub = 2
        }
        break
      case 2:
        if (p.done && p.mode === 'static') {
          this.enterGown(t)
        } else if (t - this.stageAt > LIMIT.toBay * 2) {
          h.stuck(`${this.id}: not at the pre-op bay after ${LIMIT.toBay * 2} s`)
          const foot = h.sites.bedFoot(ref)
          p.placeAt(foot.at.x, foot.at.z, foot.heading)
        }
        break
    }
  }

  private enterGown(t: number): void {
    this.enter('gown', t)
    this.until = t + this.plan.preOp.gown
    this.host.bayChanged(this.bedRef!.seat.id, this.patient!.entity.id, t, true)
  }

  private stepGown(t: number): void {
    const p = this.patient!
    if (p.entity.outfit !== 'gown' && t >= this.until - this.plan.preOp.gown / 2) p.entity.outfit = 'gown'
    if (t < this.until) return
    p.entity.outfit = 'gown'
    this.host.bayChanged(this.bedRef!.seat.id, p.entity.id, t, false)
    p.sitOn(this.bedRef!.seat)
    this.enter('nurseCheck', t)
    this.until = t + this.plan.preOp.nurse
  }

  private endNurseCheck(t: number): void {
    this.host.team.release('preOp', this.id)
    // an early patient (S1) lies in the bay until the doctors' visits fit in front of wheels-in (the theatre team is in the room before)
    if (t < this.tl.visitsAt) this.enter('settled', t)
    else this.beginVisits(t)
  }

  private beginVisits(t: number): void {
    this.enter('anaesVisit', t)
    this.visitor = null
    this.visitKey = ''
  }

  /** A doctor's visit at the bed: the doctor comes when they are free, stays `seconds`, and goes. */
  private stepVisit(t: number, title: 'anaesthetist' | 'surgeon', next: Stage, seconds: number): void {
    const h = this.host
    switch (this.sub) {
      case 0: {
        const v = h.team.acquire(title, this.id)
        if (v === null) {
          if (t - this.stageAt > LIMIT.visit) h.stuck(`${this.id}: no ${title} for the pre-op visit after ${LIMIT.visit} s`)
          return
        }
        this.visitor = v
        this.visitKey = `${this.id}:${title}`
        const side = h.sites.doctorSide(this.bedRef!)
        v.setTask({ key: this.visitKey, at: side.at, face: side.heading, anim: 'talk' })
        this.subAt = t
        this.sub = 1
        return
      }
      case 1:
        // (the visit's clock starts when the doctor is at the bed)
        if (this.visitor!.isAt(this.visitKey) || t - this.subAt > LIMIT.toBay) {
          this.until = t + seconds
          this.sub = 2
        }
        return
      case 2:
        if (t < this.until) return
        h.team.release(title, this.id)
        this.visitor = null
        this.visitKey = ''
        this.enter(next, t)
        if (next === 'ready') this.enterReady(t)
        return
    }
  }

  private enterReady(t: number): void {
    this.host.say('preOpReady', surgeryLine('preOpReady', { patient: this.patientName, bay: `Bay ${this.bed + 1}` }), { subjectId: this.patient!.entity.id })
    void t
  }

  /** Somebody to push the stretcher: the porter, or (when he is up at the ward) the pre-op nurse or the recovery nurse. */
  private acquireMover(): Staffer | null {
    for (const title of ['porter', 'preOp', 'pacu'] as const) {
      const s = this.host.team.acquire(title, this.id)
      if (s !== null) {
        this.moverTitle = title
        return s
      }
    }
    return null
  }

  private stepReady(t: number): void {
    const h = this.host
    // (the stretcher may wait at the table for the turnover to finish; it never goes in while another case is on the table)
    if (t < this.tl.toTheatreAt || h.roomBusy(this)) return
    const porter = this.acquireMover()
    if (porter === null) return
    this.porter = porter
    const foot = h.sites.bedFoot(this.bedRef!)
    porter.setVehicle('stretcher')
    porter.setTask({ key: `${this.id}:fetch`, at: foot.at, face: foot.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed * 1.2 })
    this.enter('fetch', t)
  }

  // --- the porter takes the patient to the theatre ---------------------------------------------------------------------

  private tableApproach(): { at: Vec2; face: number } {
    const seat = this.host.sites.table.seat
    return { at: seat.approach, face: headingTo(seat.approach, seat) }
  }

  private stepFetch(t: number): void {
    const h = this.host
    const porter = this.porter!
    const p = this.patient!
    switch (this.sub) {
      case 0:
        if (porter.isAt(`${this.id}:fetch`)) {
          porter.faceTowards(this.bedRef!.seat)
          porter.entity.anim = 'give'
          p.loadOn(porter)
          this.sub = 1
          this.stageAt = t
        } else if (t - this.stageAt > LIMIT.fetch) {
          h.stuck(`${this.id}: the porter did not reach the pre-op bay in ${LIMIT.fetch} s`)
          const foot = h.sites.bedFoot(this.bedRef!)
          porter.placeAt(foot.at.x, foot.at.z, foot.heading)
        }
        break
      case 1:
        if (p.mounted && t - this.stageAt >= CONFIG.er.loadSeconds) {
          // the bed is free again, the companion goes to the family lounge, the porter pushes
          this.releaseBed(t)
          this.companionToLounge()
          const a = this.tableApproach()
          porter.entity.anim = 'push'
          porter.setTask({ key: `${this.id}:toOr`, at: a.at, face: a.face, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed })
          this.enter('toTheatre', t)
        }
        break
    }
  }

  /** The companion leaves the waiting chairs for the family lounge (a recliner or sofa seat, or a place to stand). */
  private companionToLounge(): void {
    const h = this.host
    const c = this.companion!
    if (this.compSeat !== null) {
      h.world.seats.release(this.compSeat.id, c.entity.id)
      this.compSeat = null
    }
    const seat = h.sites.claimLounge(c.entity.id, c.pos)
    if (seat !== null) {
      this.compSeat = seat
      c.sendTo({ seat })
    } else {
      const spot = h.sites.spots.loungeStand[this.standIdx++ % h.sites.spots.loungeStand.length]
      c.sendTo({ at: spot.at, face: spot.heading })
    }
  }

  private stepToTheatre(t: number): void {
    const h = this.host
    const porter = this.porter!
    const p = this.patient!
    if (!porter.isAt(`${this.id}:toOr`)) {
      if (t - this.stageAt > LIMIT.toTheatre) {
        h.stuck(`${this.id}: the stretcher did not reach the OR in ${LIMIT.toTheatre} s`)
        const a = this.tableApproach()
        porter.placeAt(a.at.x, a.at.z, a.face)
      }
      return
    }
    if (t < this.plan.nominalIn - 1 || !h.roomFree(this)) return
    // wheels in: onto the table
    const table = h.sites.table
    h.sites.claim(table, p.entity.id)
    p.unloadTo(table.seat)
    this.starts.in = t
    this.view.wheelsIn = t
    this.enterRoom('in', t)
    h.say('theatreIn', surgeryLine('theatreIn', { patient: this.patientName }), { subjectId: p.entity.id })
  }

  // --- the theatre phases ---------------------------------------------------------------------------------------------

  private enterRoom(phase: RoomPhase, t: number): void {
    this.enter(phase, t)
    this.until = t + this.plan.phases[phase]
    this.starts[phase] = t
    const who = WHO_AT[phase]
    if (who !== undefined && this.patient !== null) {
      this.host.say(who.type, `${this.patientName}: ${SURGERY_COPY.checklist[who.line]}`, { subjectId: this.patient.entity.id })
    }
  }

  /** The recovery discharge criteria, said as the patient leaves recovery. */
  private sayRecoveryDischarge(): void {
    this.host.say('pacuDischarge', `${this.patientName}: ${SURGERY_COPY.checklist.recoveryDischarge}`, { subjectId: this.patient!.entity.id })
  }

  private stepRoom(t: number, _dt: number): void {
    const h = this.host
    const p = this.patient!
    const phase = this.stage as RoomPhase
    if (phase === 'in' && this.porter !== null && p.settled && p.seat === h.sites.table.seat) {
      // the patient is on the table: the porter takes the empty stretcher away
      this.releasePorter()
    }
    if (phase === 'emergence' && !this.outLoaded && this.porter === null && t >= this.until - 75) this.prepareOutPorter(t)
    if (phase === 'out') this.stepOut(t)
    if (t < this.until) return
    // the end of a phase
    if (phase === 'docking') {
      if (!this.docked) {
        this.docked = true
        this.view.dockedAt = t
        h.say('robotDocked', surgeryLine('robotDocked', { patient: this.patientName, procedure: this.short(), minutes: fmtMin(this.plan.phases.docking) }), { subjectId: p.entity.id, actorId: 'or-surgeon' })
      }
      // the console phase begins when the surgeon is on the console seat
      if (!h.surgeonSeated() && t - this.until < LIMIT.console) return
      this.view.consoleStart = t
      this.nextRoom('console', t)
      h.say('consoleStart', surgeryLine('consoleStart', { surgeon: staffName('or-surgeon'), patient: this.patientName }), { subjectId: p.entity.id, actorId: 'or-surgeon' })
      return
    }
    if (phase === 'console') {
      this.view.consoleEnd = t
      h.say('robotUndocked', surgeryLine('robotUndocked', { patient: this.patientName, minutes: fmtMin(t - (this.view.consoleStart ?? t)) }), { subjectId: p.entity.id, actorId: 'or-surgeon' })
    }
    if (phase === 'out') {
      // wheels out only once the patient is on the stretcher and rolling
      if (!this.outLoaded && t - this.until < LIMIT.fetch) return
      this.leaveRoom(t)
      return
    }
    const next = ROOM_PHASES[ROOM_PHASES.indexOf(phase) + 1]
    this.nextRoom(next, t)
  }

  private nextRoom(next: RoomPhase, t: number): void {
    this.enterRoom(next, t)
  }

  /** The porter comes for the patient: with the empty stretcher to the table, a little before the 'out' phase. */
  private prepareOutPorter(t: number): void {
    const porter = this.acquireMover()
    if (porter === null) return
    this.porter = porter
    const a = this.tableApproach()
    porter.setVehicle('stretcher')
    porter.setTask({ key: `${this.id}:outFetch`, at: a.at, face: a.face, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed * 1.2 })
    void t
  }

  private stepOut(t: number): void {
    const h = this.host
    const porter = this.porter
    const p = this.patient!
    if (porter === null) {
      this.prepareOutPorter(t)
      return
    }
    if (!this.outLoaded) {
      if (porter.isAt(`${this.id}:outFetch`) && p.settled) {
        porter.faceTowards(h.sites.table.seat)
        porter.entity.anim = 'give'
        h.sites.release(h.sites.table, p.entity.id)
        p.loadOn(porter)
        this.outLoaded = true
        this.sub = 1
      }
      return
    }
    // loaded: roll toward recovery in the last 25 s of the phase, so the stretcher is out of the room when it ends
    if (this.sub === 1 && p.mounted && t >= this.until - 25) {
      const idx = h.sites.freePacu()
      if (idx < 0) return
      const ref = h.sites.pacu[idx]
      h.sites.claim(ref, p.entity.id)
      this.pacu = idx
      this.pacuRef = ref
      const foot = h.sites.bedFoot(ref)
      porter.entity.anim = 'push'
      porter.setTask({ key: `${this.id}:toPacu`, at: foot.at, face: foot.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed })
      this.sub = 2
    }
  }

  private leaveRoom(t: number): void {
    const h = this.host
    this.leftRoomAt = t
    this.view.wheelsOut = t
    h.say('theatreOut', surgeryLine('theatreOut', { patient: this.patientName, minutes: fmtMin(t - (this.view.wheelsIn ?? t)) }), { subjectId: this.patient!.entity.id })
    this.enter('toPacu', t)
  }

  // --- recovery -----------------------------------------------------------------------------------------------------

  private stepToPacu(t: number): void {
    const h = this.host
    const porter = this.porter!
    const p = this.patient!
    if (this.pacuRef === null) {
      // (no free recovery bed yet: wait in the hall)
      const idx = h.sites.freePacu()
      if (idx < 0) return
      this.pacu = idx
      this.pacuRef = h.sites.pacu[idx]
      h.sites.claim(this.pacuRef, p.entity.id)
      const foot = h.sites.bedFoot(this.pacuRef)
      porter.setTask({ key: `${this.id}:toPacu`, at: foot.at, face: foot.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed })
      return
    }
    switch (this.sub) {
      case 0:
      case 1:
      case 2:
        if (porter.isAt(`${this.id}:toPacu`) && p.mounted) {
          p.unloadTo(this.pacuRef.seat)
          porter.entity.anim = 'give'
          this.sub = 3
          this.stageAt = t
        } else if (t - this.stageAt > LIMIT.pacu) {
          h.stuck(`${this.id}: the stretcher did not reach recovery in ${LIMIT.pacu} s`)
          const foot = h.sites.bedFoot(this.pacuRef)
          porter.placeAt(foot.at.x, foot.at.z, foot.heading)
        }
        break
      case 3:
        if (p.settled && p.seat === this.pacuRef.seat) {
          this.releasePorter()
          this.pacuInAt = t
          h.bayChanged(this.pacuRef.seat.id, p.entity.id, t, false)
          this.enter('pacu', t)
          this.view.bay = this.pacuRef.seat.id
        }
        break
    }
  }

  private stepPacu(t: number): void {
    if (t < (this.pacuInAt ?? t) + this.plan.pacuSeconds) return
    if (this.plan.outcome === 'home') this.beginPhase2(t)
    else this.beginWard(t)
  }

  // --- home: the lounge, then lift A down ------------------------------------------------------------------------------

  private beginPhase2(t: number): void {
    const h = this.host
    const p = this.patient!
    this.pacuOutAt = t
    p.entity.outfit = 'everyday'
    // just out of recovery: a slow, careful walk to the lounge chair (about half pace), never a brisk one
    p.cruise = Math.min(p.cruise, CONFIG.er.walkSpeed * POSTOP_PACE)
    p.standUp()
    this.enter('phase2', t)
    this.until = t + this.plan.phase2Seconds
    this.sayRecoveryDischarge()
    h.say('pacuOut', surgeryLine('pacuOut', { patient: this.patientName, minutes: fmtMin(t - (this.pacuInAt ?? t)) }), { subjectId: p.entity.id })
  }

  private stepPhase2(t: number): void {
    const h = this.host
    const p = this.patient!
    if (this.sub === 0) {
      if (p.done && p.mode === 'static') {
        // off the bed: the bed is free, the patient sits in the lounge by their companion
        this.releasePacuBed(t)
        // (the patient sits beside their companion, who has been in the lounge since the patient went to theatre)
        const seat = h.sites.claimLounge(p.entity.id, this.compSeat ? { x: this.compSeat.x, z: this.compSeat.z } : p.pos)
        if (seat !== null) {
          this.loungeSeat = seat
          p.sitOn(seat)
        } else {
          const spot = h.sites.spots.loungeStand[this.standIdx++ % h.sites.spots.loungeStand.length]
          p.moveTo(spot.at, { face: spot.heading })
        }
        this.sub = 1
      }
      return
    }
    if (t >= this.until) this.beginLeaving(t)
  }

  /**
   * Day cases go home by wheelchair: the companion (family) pushes the patient from the lounge to lift A, down, and to the entrance, where both
   * fade out as they get into the car. Nobody who has just had an operation walks out at full speed. If the wheelchair cannot be set up in
   * `CHAIR_GIVE_UP` seconds (no room beside the seat) they walk instead, at the slow post-op pace.
   */
  private beginLeaving(t: number): void {
    const h = this.host
    const p = this.patient!
    const c = this.companion!
    // up off the seats (the claims go in the same step: nobody sits on a seat that is free)
    p.standUp()
    c.standUp()
    for (const [seat, who] of [[this.loungeSeat, p.entity.id], [this.compSeat, c.entity.id]] as const) if (seat !== null) h.world.seats.release(seat.id, who)
    this.loungeSeat = null
    this.compSeat = null
    this.chairOut = false
    this.enter('leaving', t)
  }

  /** The wheelchair behind the patient: where the pusher stands, facing the lift. */
  private chairSpot(): { at: Vec2; face: number } | null {
    const p = this.patient!
    const to = LIFTS.A[2].stretcher.at
    const base = headingTo(p.pos, to)
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
      const hd = base + turn
      const at = { x: p.walker.x - Math.sin(hd) * VEHICLE_AHEAD.wheelchair, z: p.walker.z - Math.cos(hd) * VEHICLE_AHEAD.wheelchair }
      if (isWalkable(at.x, at.z, 0.3) && !inDoorway(at.x, at.z)) return { at, face: hd }
    }
    return null
  }

  private chairFallback(t: number): void {
    const p = this.patient!
    const c = this.companion!
    if (p.pusher !== null) {
      this.host.world.detach(p)
      p.dismount(p.walker.x, p.walker.z, p.walker.heading, null)
    }
    c.setVehicle('none')
    c.walkAnim = 'walk'
    this.chairOut = false
    this.sub = 4
    this.startRide(t, 2, 1)
  }

  private stepLeaving(t: number): void {
    const h = this.host
    const p = this.patient!
    const c = this.companion!
    if (this.sub < 3 && t - this.stageAt > CHAIR_GIVE_UP) {
      h.stuck(`${this.id}: the wheelchair was not ready after ${CHAIR_GIVE_UP} s (sub ${this.sub}); they walk out slowly`)
      this.chairFallback(t)
      return
    }
    switch (this.sub) {
      case 0: {
        if (!(p.done && p.mode === 'static' && c.done && c.mode === 'static')) return
        const spot = this.chairSpot()
        if (spot === null) {
          this.chairFallback(t)
          return
        }
        c.moveTo(spot.at, { face: spot.face })
        this.sub = 1
        return
      }
      case 1:
        if (!(c.done && c.mode === 'static')) return
        c.setVehicle('wheelchair')
        c.walkAnim = 'push'
        h.world.attach(c, p)
        p.mountOn(c, 'wheelchair')
        this.sub = 2
        return
      case 2:
        if (!p.mounted) return
        this.chairOut = true
        this.startRide(t, 2, 1, true)
        this.sub = 3
        return
      default:
        break
    }
    const trip = this.trip
    if (trip !== null && !trip.done) {
      if (t - this.stageAt > LIMIT.leave + CHAIR_GIVE_UP) h.stuck(`${this.id}: the lift ride down has not finished after ${LIMIT.leave} s (${trip.phase})`)
      return
    }
    if (trip === null) {
      const s = LIFTS.A[1].walkers
      if (this.chairOut) {
        const sp = LIFTS.A[1].stretcher
        c.placeAt(sp.at.x, sp.at.z, sp.heading)
      } else {
        p.placeAt(s[0].x, s[0].z, 0)
        c.placeAt(s[1].x, s[1].z, 0)
      }
    }
    this.trip = null
    p.entity.mood = 'happy'
    if (this.chairOut) {
      // the family wheels them out to the car at the entrance
      c.moveTo(DEPARTURES.entrance, { speed: CONFIG.er.wheelSpeed })
    } else {
      // (the fallback) on foot, at the slow post-op pace
      p.cruise = CONFIG.er.walkSpeed * POSTOP_PACE
      c.cruise = p.cruise
      p.moveTo(DEPARTURES.entrance)
      c.moveTo({ x: DEPARTURES.entrance.x, z: DEPARTURES.entrance.z + 0.7 })
    }
    this.enter('leaveWalk', t)
  }

  private stepLeaveWalk(t: number): void {
    const p = this.patient!
    const c = this.companion!
    if (this.chairOut) {
      // the patient rides: both go out together once the wheelchair is at the door
      if (c.done && !c.fadingOut) {
        c.fadeOut()
        if (!p.fadingOut) p.fadeOut()
      }
    } else {
      if (p.done && !p.fadingOut) p.fadeOut()
      if (c.done && !c.fadingOut) c.fadeOut()
    }
    if (p.gone && c.gone) this.finish(t)
    else if (t - this.stageAt > LIMIT.leave) {
      this.host.stuck(`${this.id}: did not reach the entrance in ${LIMIT.leave} s`)
      p.fadeOut()
      c.fadeOut()
      this.stageAt = t
    }
  }

  // --- ward: the stretcher into lift B, up to the surgical ward -------------------------------------------------------------

  private beginWard(t: number): void {
    this.pacuOutAt = t
    this.sayRecoveryDischarge()
    this.host.say('pacuOut', surgeryLine('pacuOut', { patient: this.patientName, minutes: fmtMin(t - (this.pacuInAt ?? t)) }), { subjectId: this.patient!.entity.id })
    this.enter('wardFetch', t)
  }

  private stepWardFetch(t: number): void {
    const h = this.host
    const p = this.patient!
    if (this.sub === 0) {
      const porter = h.team.acquire('porter', this.id)
      if (porter === null) return
      this.porter = porter
      const foot = h.sites.bedFoot(this.pacuRef!)
      porter.setVehicle('stretcher')
      porter.setTask({ key: `${this.id}:wardFetch`, at: foot.at, face: foot.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed * 1.2 })
      this.sub = 1
      return
    }
    const porter = this.porter!
    if (this.sub === 1) {
      if (porter.isAt(`${this.id}:wardFetch`)) {
        porter.faceTowards(this.pacuRef!.seat)
        porter.entity.anim = 'give'
        p.loadOn(porter)
        this.sub = 2
        this.stageAt = t
      } else if (t - this.stageAt > LIMIT.ward * 2) {
        h.stuck(`${this.id}: the porter did not reach the recovery bed in time`)
        const foot = h.sites.bedFoot(this.pacuRef!)
        porter.placeAt(foot.at.x, foot.at.z, foot.heading)
      }
      return
    }
    if (this.sub === 2 && p.mounted && t - this.stageAt >= CONFIG.er.loadSeconds) {
      this.releasePacuBed(t)
      this.enter('wardPush', t)
    }
  }

  private stepWardPush(t: number): void {
    const h = this.host
    const porter = this.porter!
    const lifts = h.lifts
    const owner = porter.staff.id
    if (this.sub === 0) {
      // the lobby's stretcher slot first, so no stretcher or lift party is in the way
      if (lifts !== null && !lifts.claimFade('B', 2, owner)) return
      const spot = LIFTS.B[2].stretcher
      porter.entity.anim = 'push'
      porter.setTask({ key: `${this.id}:toLift`, at: spot.at, face: spot.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed })
      // the companion walks there too, to go up with them
      const c = this.companion!
      if (this.compSeat !== null) {
        h.world.seats.release(this.compSeat.id, c.entity.id)
        this.compSeat = null
      }
      const w = LIFTS.B[2].walkers[0]
      c.sendTo({ at: { x: w.x, z: w.z }, face: spot.heading })
      this.sub = 1
      this.stageAt = t
      return
    }
    if (porter.isAt(`${this.id}:toLift`)) {
      const p = this.patient!
      // the stretcher goes up to the ward: the patient and the porter fade out where they stand (the porter comes back later)
      p.fadeOut()
      porter.fadeOut(true)
      this.enter('wardFade', t)
    } else if (t - this.stageAt > LIMIT.ward * 2) {
      h.stuck(`${this.id}: the stretcher did not reach lift B in time`)
      const spot = LIFTS.B[2].stretcher
      porter.placeAt(spot.at.x, spot.at.z, spot.heading)
    }
  }

  private stepWardFade(t: number): void {
    const h = this.host
    const p = this.patient!
    const c = this.companion!
    const porter = this.porter!
    if (c.done && !c.fadingOut && !c.gone && c.mode === 'static') c.fadeOut()
    if (!p.gone || !porter.hidden) return
    if (!c.gone && t - this.stageAt < LIMIT.ward) return
    if (!c.gone) c.fadeOut()
    // the porter's stretcher is up at the ward: he comes back in 4 to 6 minutes
    h.lifts?.releaseFade(porter.staff.id)
    porter.setVehicle('none')
    porter.walkAnim = 'walk'
    h.porterAway(porter, t + this.rng.range(240, 360), 'B')
    this.porter = null
    this.finish(t)
  }

  private finish(t: number): void {
    const h = this.host
    this.enter('done', t)
    h.team.releaseAll(this.id)
    h.sites.releaseAll(`${this.id}-patient`)
    h.sites.releaseAll(`${this.id}-companion`)
    h.caseFinished(this, t)
  }

  private releaseBed(t: number): void {
    const ref = this.bedRef
    if (ref === null) return
    this.host.sites.release(ref, this.patient!.entity.id)
    this.host.bayChanged(ref.seat.id, null, t, false)
    this.bedRef = null
  }

  private releasePacuBed(t: number): void {
    const ref = this.pacuRef
    if (ref === null) return
    this.host.sites.release(ref, this.patient!.entity.id)
    this.host.bayChanged(ref.seat.id, null, t, false)
    this.pacuRef = null
    this.view.bay = null
  }

  private releasePorter(): void {
    const p = this.porter
    if (p === null) return
    p.setVehicle('none')
    p.walkAnim = 'walk'
    p.idleAnim = 'idle'
    this.host.team.release(this.moverTitle, this.id)
    this.porter = null
    this.moverTitle = 'porter'
  }

  // ------------------------------------------------------------------------------------------------------------------
  // warm start
  // ------------------------------------------------------------------------------------------------------------------

  /** Put the case where the plan has it at sim time `t`. Idempotent per call: the caller disposes first. */
  warm(t: number): void {
    const tl = this.tl
    const plan = this.plan
    const h = this.host
    if (t < plan.arriveAt) {
      this.stage = 'scheduled'
      return
    }
    // history: every time the case has passed
    const past = (x: number) => x <= t
    if (past(tl.outAt)) {
      this.view.wheelsIn = plan.nominalIn
      this.view.dockedAt = tl.phaseEnd.docking
      this.view.consoleStart = tl.phaseStart.console
      this.view.consoleEnd = tl.phaseEnd.console
      this.view.wheelsOut = tl.outAt
      this.leftRoomAt = tl.outAt
    }
    for (const ph of ROOM_PHASES) if (past(tl.phaseStart[ph])) this.starts[ph] = tl.phaseStart[ph]
    if (past(plan.nominalIn)) {
      this.view.wheelsIn = plan.nominalIn
      if (past(tl.phaseEnd.docking)) {
        this.view.dockedAt = tl.phaseEnd.docking
        this.docked = true
      }
      if (past(tl.phaseStart.console)) this.view.consoleStart = tl.phaseStart.console
      if (past(tl.phaseEnd.console)) {
        this.view.consoleEnd = tl.phaseEnd.console
      }
    }
    if (t < tl.upstairsBy) {
      // still on their way in: they arrive at the entrance now
      this.spawnAtEntrance(t, false)
      this.patient!.fadeIn()
      this.companion!.fadeIn()
      return
    }
    if (t < tl.preOpStart) {
      this.spawnUpstairs()
      this.seatInWaiting(true)
      this.enter('waiting', t)
      return
    }
    if (t < tl.readyAt) {
      this.warmPreOp(t)
      return
    }
    if (t < tl.toTheatreAt) {
      this.warmBed(t)
      this.enter('ready', t)
      return
    }
    if (t < plan.nominalIn) {
      this.warmToTheatre(t)
      return
    }
    if (t < tl.outAt) {
      this.warmRoom(t)
      return
    }
    if (t < tl.pacuOut) {
      this.warmPacu(t)
      return
    }
    if (plan.outcome === 'home' && t < tl.phase2End) {
      this.warmPhase2(t)
      return
    }
    // gone home (or up to the ward): nothing left on level 2
    this.stage = 'done'
    this.view.phase = 'done'
    this.pacuInAt = tl.pacuIn
    this.pacuOutAt = tl.pacuOut
    this.turnoverReported = false
    void h
  }

  private warmBed(t: number): void {
    const h = this.host
    const p0 = this.spawnUpstairs()
    const idx = h.sites.freePreop()
    this.bed = idx < 0 ? 0 : idx
    this.bedRef = h.sites.preop[this.bed]
    h.sites.claim(this.bedRef, p0.patient.entity.id)
    this.view.bay = this.bedRef.seat.id
    p0.patient.entity.outfit = 'gown'
    p0.patient.placeOnSeat(this.bedRef.seat)
    // the companion waits in the pre-op chairs until the patient goes
    this.compSeat = h.sites.claimWaiting(p0.companion.entity.id, p0.patient.pos)
    if (this.compSeat !== null) p0.companion.placeOnSeat(this.compSeat)
    else {
      const s = h.sites.spots.waitStand[this.standIdx++ % h.sites.spots.waitStand.length]
      p0.companion.placeAt(s.at.x, s.at.z, s.heading)
    }
    // S1: a warm start dates the bay from the plan ("in the bay for 12 min"), not from the moment it was placed
    h.bayChanged(this.bedRef.seat.id, p0.patient.entity.id, Math.min(t, this.tl.preOpStart), false)
  }

  private warmPreOp(t: number): void {
    const h = this.host
    const tl = this.tl
    this.warmBed(t)
    const p = this.patient!
    const ref = this.bedRef!
    if (t < tl.gownEnd) {
      // changing behind the curtain, standing at the foot of the bed
      const foot = h.sites.bedFoot(ref)
      p.entity.outfit = t >= tl.preOpStart + this.plan.preOp.gown / 2 ? 'gown' : 'everyday'
      p.placeAt(foot.at.x, foot.at.z, foot.heading)
      h.bayChanged(ref.seat.id, p.entity.id, t, true)
      const nurse = h.team.acquire('preOp', this.id)
      if (nurse !== null) {
        const side = h.sites.nurseSide(ref)
        nurse.settleTask({ key: `${this.id}:bay`, at: side.at, face: side.heading, anim: 'tablet' })
      }
      this.enter('gown', t)
      this.until = tl.gownEnd
      return
    }
    if (t < tl.nurseEnd) {
      const nurse = h.team.acquire('preOp', this.id)
      if (nurse !== null) {
        const side = h.sites.nurseSide(ref)
        nurse.settleTask({ key: `${this.id}:bay`, at: side.at, face: side.heading, anim: 'tablet' })
      }
      this.enter('nurseCheck', t)
      this.until = tl.nurseEnd
      return
    }
    if (t < tl.visitsAt) {
      // (an early patient, S1) lying in the bay, the doctors still busy elsewhere
      this.enter('settled', t)
      return
    }
    const title = t < tl.anaesEnd ? 'anaesthetist' : 'surgeon'
    const v = h.team.acquire(title, this.id)
    if (v !== null) {
      const side = h.sites.doctorSide(ref)
      this.visitor = v
      this.visitKey = `${this.id}:${title}`
      v.settleTask({ key: this.visitKey, at: side.at, face: side.heading, anim: 'talk' })
    }
    this.enter(title === 'anaesthetist' ? 'anaesVisit' : 'surgeonVisit', t)
    this.until = t < tl.anaesEnd ? tl.anaesEnd : tl.readyAt
    // (the doctor is at the bed already, or - when they are busy - the visit is simply taken up again live)
    this.sub = v !== null ? 2 : 0
  }

  /** On the stretcher with the porter at the OR door, a minute or two before wheels-in. */
  private warmToTheatre(t: number): void {
    const h = this.host
    const { patient, companion } = this.spawnUpstairs()
    patient.entity.outfit = 'gown'
    const porter = this.acquireMover()
    const a = this.tableApproach()
    if (porter !== null) {
      this.porter = porter
      porter.setVehicle('stretcher')
      porter.settleTask({ key: `${this.id}:toOr`, at: a.at, face: a.face, anim: 'push', walkAnim: 'push' })
      patient.placeAt(porter.x, porter.z, a.face)
      patient.startRiding(porter, 'stretcher')
      h.world.attach(porter, patient)
    } else patient.placeAt(a.at.x, a.at.z, a.face)
    this.placeInLounge(companion)
    this.enter('toTheatre', t)
  }

  private placeInLounge(c: SurgeryCompanion): void {
    const h = this.host
    const seat = h.sites.claimLounge(c.entity.id, c.pos)
    if (seat !== null) {
      this.compSeat = seat
      c.placeOnSeat(seat)
    } else {
      const spot = h.sites.spots.loungeStand[this.standIdx++ % h.sites.spots.loungeStand.length]
      c.placeAt(spot.at.x, spot.at.z, spot.heading)
    }
  }

  /** In the room at `t`: on the table in the phase the plan has them in. */
  private warmRoom(t: number): void {
    const h = this.host
    const tl = this.tl
    const { patient, companion } = this.spawnUpstairs()
    patient.entity.outfit = 'gown'
    const table = h.sites.table
    h.sites.claim(table, patient.entity.id)
    patient.placeOnSeat(table.seat)
    this.placeInLounge(companion)
    let phase: RoomPhase = 'in'
    for (const ph of ROOM_PHASES) if (t >= tl.phaseStart[ph]) phase = ph
    this.stage = phase
    this.stageAt = tl.phaseStart[phase]
    this.until = tl.phaseEnd[phase]
    this.view.phase = casePhaseOf(phase)
    patient.entity.stage = this.view.phase
    // a case that is past docking has had its docking and console events (silently)
    this.docked = t >= tl.phaseEnd.docking
    if (phase === 'console') this.view.consoleStart = tl.phaseStart.console
    if (phase === 'out') this.sub = 0
  }

  /** In a recovery bed (the porter's ride from the OR counts as arrived). */
  private warmPacu(t: number): void {
    const h = this.host
    const tl = this.tl
    const { patient, companion } = this.spawnUpstairs()
    patient.entity.outfit = 'gown'
    const idx = h.sites.freePacu()
    this.pacu = idx < 0 ? 0 : idx
    this.pacuRef = h.sites.pacu[this.pacu]
    h.sites.claim(this.pacuRef, patient.entity.id)
    patient.placeOnSeat(this.pacuRef.seat)
    this.view.bay = this.pacuRef.seat.id
    this.placeInLounge(companion)
    this.pacuInAt = tl.pacuIn
    h.bayChanged(this.pacuRef.seat.id, patient.entity.id, Math.min(t, tl.pacuIn), false)
    this.enter('pacu', t)
  }

  private warmPhase2(t: number): void {
    const h = this.host
    const { patient, companion } = this.spawnUpstairs()
    patient.entity.outfit = 'everyday'
    const seat = h.sites.claimLounge(patient.entity.id, LIFTS.A[2].walkers[0])
    if (seat !== null) {
      this.loungeSeat = seat
      patient.placeOnSeat(seat)
    } else {
      const spot = h.sites.spots.loungeStand[this.standIdx++ % h.sites.spots.loungeStand.length]
      patient.placeAt(spot.at.x, spot.at.z, spot.heading)
    }
    const near = seat !== null ? { x: seat.x, z: seat.z } : patient.pos
    const cseat = h.sites.claimLounge(companion.entity.id, near)
    if (cseat !== null) {
      this.compSeat = cseat
      companion.placeOnSeat(cseat)
    } else {
      const spot = h.sites.spots.loungeStand[this.standIdx++ % h.sites.spots.loungeStand.length]
      companion.placeAt(spot.at.x, spot.at.z, spot.heading)
    }
    this.pacuInAt = this.tl.pacuIn
    this.pacuOutAt = this.tl.pacuOut
    this.enter('phase2', t)
    this.sub = 1
    this.until = this.tl.phase2End
  }

  /** Called by the suite when the case has just been settled in the room, to say where the robot's exchanges stand. */
  exchangesDoneBy(t: number): number {
    const start = this.view.consoleStart
    if (start === null) return 0
    let n = 0
    for (const e of this.plan.exchanges) if (t >= start + e.at + 6) n++
    return n
  }
}
