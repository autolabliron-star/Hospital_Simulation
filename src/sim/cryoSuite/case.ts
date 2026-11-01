/**
 * R4: one cryoablation case, from lift B to lift B. The patient is an inpatient of the surgical ward upstairs: the ward porter rolls them out of
 * lift B (the "level 3" fade, as surgery's ward patients), pushes the stretcher into the CT room and the patient moves across onto the CT table,
 * which carries them in and out for the scans (`rideTable`). The steps then run on the plan's clock (plan.ts); after the dressing the patient is taken
 * on a stretcher to a recovery bay (a guest of the surgery suite's PACU), and after their recovery time the ward porter takes them back up in lift B.
 * Physical things (the stretcher arriving, a free recovery bay) only ever DELAY the next step, never shorten one.
 *
 * Stages: scheduled; arriving (step 'arrive'); room (sedation .. dressing); toPacu (step 'out'); pacu; wardFetch, wardPush, wardFade; done.
 * A warm start (`warm(t)`) puts the case where its nominal timeline has it at t, silently.
 *
 * R5 wave 3: a case has a target (kidney, lung, liver: `plan.target`), whose steps it passes through (the lung's include the anchor freeze and thaw), and
 * a `proc`, its procedure script (src/content/procedures/cryo-*.json: the step under the clock, who does what, the patient's pose; `script.ts`). The porter
 * unloads the patient onto the CT table only once the transfer step ("Onto the CT table", the last step of the 'arrive' unit) is under the clock AND the
 * stretcher is parked beside the table (until then the published view stays on the step before it: `transferHeld`).
 *
 * The stretcher's way (fix round 3, lane.ts). It goes into the scan room along a fixed curve, the lane, and comes out the way it went in, backwards: it cannot
 * be turned round in the room. The porter walks it from lift B to the lane's stage just inside recovery's door (the crowd walks him) and is driven along the
 * lane from there to the park beside the table (`HopWalker.armLane`), with the patient on it (the arrival) or empty (the return). The radiographer, who stands at
 * the table's foot which the lane passes, steps back while a stretcher is on it (team.ts `holdLane`).
 *
 * The empty stretcher comes back from outside the scan room, never made inside it: a porter is called early enough (`stretcherTrip` before the dressing's end)
 * to bring it from lift B along the lane to the park, where he waits for the dressing's end. The same porter then takes the patient out: the patient is moved
 * onto his stretcher at the park, he backs it out along the lane to the out point beside the door, turns it slowly to the way he is going, and pushes it to
 * the recovery bay (a hand over to the nurse would put two bodies on one spot and one of them would jump). The sedation nurse stays at the table through the
 * dressing, as her lines say. With no porter free (a live day's other work) she walks out of the scan room at the dressing's end, takes a stretcher on
 * clear floor at the out point and drives it in, and then takes the patient out herself (`fetchOnFoot`).
 */
import { cryoLine } from '@/content/cryoSuite'
import { staffName } from '@/content/staff'
import { CONFIG } from '../config'
import { newCursor, stepAt, type StepCursor } from '../procedure'
import type { World } from '../er/world'
import type { LiftBank } from '../lifts'
import { LIFTS, VEHICLE_AHEAD, type Spot } from '../places'
import type { Rng } from '../rng'
import type { CryoCaseView, CryoStep, SimEventType } from '../types'
import { SurgicalPatient, type Staffer } from '../surgery/actors'
import type { SeatRef } from '../surgery/sites'
import { needleInAt } from './derive'
import { HopWalker } from './hop'
import type { LanePose, PoseLane, StretcherLane } from './lane'
import { cryoTimeline, roomStepsFor, secondsOf, targetOf, type CryoTimeline, type PlannedCryoCase, type RoomStep } from './plan'
import { caseScriptFor, transferStepOf, type CryoCaseScript } from './script'
import { BACK_SPEED, HALL_EAST, LANE_SPEED, LEAD_IN, STAGE_TURN, TURN_RATE, type CryoSites } from './sites'
import type { CryoTeam } from './team'

/**
 * Where a stretcher is on its way to the park (the arrival's with the patient, the return's empty): not called for, being driven up the corridor from lift B to the
 * lane's stage, being turned there to the lane's heading, being driven along the lane, standing at the park.
 */
type Leg = 'none' | 'lift' | 'align' | 'drive' | 'parked'

/** The radiographer steps back from the lane when a drive is this far (m) of lane short of the scan room's door (she needs about two seconds to be out of its way). */
const WAY_BEFORE = 2.5

export type CryoStage = 'scheduled' | 'arriving' | 'room' | 'toPacu' | 'pacu' | 'wardFetch' | 'wardPush' | 'wardFade' | 'done'

/** The suite around a case. */
export interface CryoHost {
  readonly world: World
  readonly sites: CryoSites
  readonly team: CryoTeam
  readonly lifts: LiftBank | null
  readonly quiet: boolean
  /** May this case be wheeled in now (its turn, the room turned over, the team on site)? */
  mayStart(c: CryoCase, t: number): boolean
  /** The ward porter with a stretcher, appearing at lift B's stretcher spot (null while he is busy or the lobby is taken). */
  acquirePorter(owner: string): Staffer | null
  /** Warm start: the porter already standing at `spot` with his stretcher. */
  placePorter(owner: string, spot: Spot): Staffer
  /** The porter takes his empty stretcher back up in lift B. */
  porterLeave(porter: Staffer, t: number): void
  /** The porter has gone up with the patient (faded out): free him. */
  porterDone(porter: Staffer): void
  guestBay(seatId: string, patientId: string | null, name: string | null, t: number): void
  caseFinished(c: CryoCase): void
  touch(): void
  stuck(msg: string): void
  say(type: SimEventType, text: string, refs?: { subjectId?: string; actorId?: string }): void
}

/** A wait that never ends is a bug: past these (seconds) a step is forced and `stuck` is told. */
const LIMIT = { push: 900, park: 600, pacu: 600, ward: 900 }
const IR = 'cryo-ir'

export class CryoCase {
  stage: CryoStage = 'scheduled'
  readonly view: CryoCaseView
  readonly tl: CryoTimeline
  patient: SurgicalPatient | null = null
  /** The room step while arriving or in the room, when it began and when it is due to end. */
  roomStep: RoomStep | null = null
  since = 0
  until = 0
  /** Realised times (null until they happen). */
  wheelsIn: number | null = null
  outSince: number | null = null
  /** The room's part is over (the patient in recovery, the 'out' step done): the turnover runs from here. */
  roomEnd: number | null = null
  pacuInAt: number | null = null
  pacuOutAt: number | null = null
  private porter: Staffer | null = null
  private nurse: Staffer | null = null
  /** The stretcher's journey to the park (the arrival's, then the empty one's for the way out), and who pushes it now (the porter, or the nurse who went out for it). */
  private leg: Leg = 'none'
  private carrier: Staffer | null = null
  /** The task keys of the stretcher's way (made once: the per-tick checks build no strings). */
  private readonly keys: { lift: string; stage: string; align: string; park: string; retStage: string; retPark: string; outPark: string; fetch: string; backOut: string; hall: string; turn: string; toPacu: string }
  /** Scratch pose (the per-tick checks allocate nothing). */
  private readonly pose: LanePose = { x: 0, z: 0, heading: 0 }
  /** R5 wave 3: the case's procedure script (null: none for its target, R4's behaviour). */
  readonly proc: CryoCaseScript | null
  private pacuRef: SeatRef | null = null
  private sub = 0
  private subAt = 0
  private needlesSaid = 0
  /** The step cursor of the arrival's gate (the transfer step), reused. */
  private readonly arrivalCursor: StepCursor = newCursor()

  constructor(
    readonly plan: PlannedCryoCase,
    readonly host: CryoHost,
    readonly rng: Rng,
    readonly name: string,
  ) {
    this.tl = cryoTimeline(plan)
    const id = plan.id
    this.keys = { lift: `${id}:lift`, stage: `${id}:stage`, align: `${id}:align`, park: `${id}:park`, retStage: `${id}:retStage`, retPark: `${id}:retPark`, outPark: `${id}:outPark`, fetch: `${id}:fetch`, backOut: `${id}:backOut`, hall: `${id}:hall`, turn: `${id}:turn`, toPacu: `${id}:toPacu` }
    this.proc = caseScriptFor(plan, rng)
    this.view = {
      id: plan.id,
      patientId: null,
      name,
      demo: plan.demo,
      plannedIn: plan.plannedIn,
      target: targetOf(plan),
      step: 'scheduled',
      wheelsIn: null,
      wheelsOut: null,
      needles: plan.needles.length,
      tumourMm: plan.tumourMm,
    }
  }

  get id(): string {
    return this.plan.id
  }

  get patientId(): string {
    return `${this.id}-patient`
  }

  /** The patient is in the suite's rooms (arriving or on the table): the room is theirs. */
  get inRoom(): boolean {
    return this.stage === 'arriving' || this.stage === 'room'
  }

  /** The room's step this case shows at t ({step, since, until}), or null when the room is not theirs. */
  roomWindow(t: number): { step: CryoStep; since: number; until: number } | null {
    if (this.inRoom && this.roomStep !== null) return { step: this.roomStep, since: this.since, until: this.until }
    if (this.outSince !== null && (this.roomEnd === null || t < this.roomEnd)) return { step: 'out', since: this.outSince, until: this.outSince + this.plan.steps.out }
    return null
  }

  private viewStep(): CryoCaseView['step'] {
    switch (this.stage) {
      case 'scheduled':
        return 'scheduled'
      case 'arriving':
      case 'room':
        return this.roomStep ?? 'arrive'
      case 'toPacu':
        return 'out'
      case 'done':
        return 'done'
      default:
        return 'pacu'
    }
  }

  private syncView(): void {
    const v = this.view
    const step = this.viewStep()
    const pid = this.patient !== null ? this.patientId : null
    const out = this.outSince
    if (v.step !== step || v.patientId !== pid || v.wheelsIn !== this.wheelsIn || v.wheelsOut !== out) {
      v.step = step
      v.patientId = pid
      v.wheelsIn = this.wheelsIn
      v.wheelsOut = out
      this.host.touch()
    }
  }

  private enterStage(stage: CryoStage): void {
    this.stage = stage
    this.sub = 0
    this.syncView()
  }

  private enterStep(step: RoomStep, t: number): void {
    this.roomStep = step
    this.since = t
    this.until = t + secondsOf(this.plan, step)
    this.syncView()
    this.host.touch()
  }

  // ------------------------------------------------------------------------------------------------------------------
  // the people
  // ------------------------------------------------------------------------------------------------------------------

  private newPatient(x: number, z: number, heading: number): SurgicalPatient {
    const w = this.host.world
    const p = new SurgicalPatient(w, this.id, this.name, { x, z }, heading, w.walkerFor(this.patientId), this.rng.fork('patient'))
    p.entity.outfit = 'gown'
    this.patient = p
    w.hooks.add(p)
    return p
  }

  /** The patient lying on the stretcher `porter` holds (no glide: they come that way). */
  private ride(p: SurgicalPatient, porter: Staffer): void {
    const h = porter.walker.heading
    const ahead = VEHICLE_AHEAD.stretcher
    p.placeAt(porter.x + Math.sin(h) * ahead, porter.z + Math.cos(h) * ahead, h)
    p.startRiding(porter, 'stretcher')
    this.host.world.attach(porter, p)
  }

  /** Remove everything this case made (a re-settle). The porter is the suite's. */
  dispose(): void {
    const w = this.host.world
    if (this.patient !== null) {
      w.detach(this.patient)
      w.hooks.remove(this.patient)
    }
    this.patient = null
    this.releaseNurse()
    this.host.team.releaseAll(this.id)
    this.host.team.holdLane(this.id, false)
    this.host.sites.releaseAll(this.patientId)
    this.porter = null
    this.carrier = null
    this.leg = 'none'
  }

  private tableKey(): string {
    return this.keys.park
  }

  private get lane(): StretcherLane {
    return this.host.sites.lane
  }

  /** The hop walker a staffer of the suite is driven by (every person of the suite has one). */
  private hopOf(a: Staffer): HopWalker | null {
    return a.walker instanceof HopWalker ? a.walker : null
  }

  /**
   * Drive `a` (who holds a stretcher) along the lane from arc length `from` to `to` (backwards when `to` is smaller): the walk is the task's own, so its
   * arrival is the usual one (`isAt(key)`). Without a hop walker (a test's bare person) the task is a plain walk to the lane's end.
   */
  private driveLane(a: Staffer, key: string, from: number, to: number, speed: number, lane: PoseLane = this.lane): void {
    lane.poseAt(to, this.pose)
    a.entity.anim = 'push'
    this.hopOf(a)?.armLane(lane, from, to)
    a.setTask({ key, at: { x: this.pose.x, z: this.pose.z }, face: this.pose.heading, anim: 'push', walkAnim: 'push', speed })
  }

  /** The porter, who has just come out of lift B, is driven up the corridor to the lane's stage (the corridor is open floor: the stretcher is never turned there but at the stage). */
  private driveToStage(a: Staffer, key: string): void {
    const lift = this.lane.lift
    this.driveLane(a, key, 0, lift.length, LANE_SPEED, lift)
    this.leg = 'lift'
  }

  /** At the stage: the stretcher is turned on the spot, slowly, from the corridor's line to the lane's heading (sweeping the open corridor). */
  private alignAtStage(a: Staffer): void {
    const stage = this.host.sites.spots.stretcherStage
    this.hopOf(a)?.armTurn(stage.heading, TURN_RATE, 1)
    a.setTask({ key: this.keys.align, at: { x: a.x, z: a.z }, face: stage.heading, anim: 'push', walkAnim: 'push' })
    this.leg = 'align'
  }

  private push(s: Staffer, key: string, spot: Spot, fast = false): void {
    s.entity.anim = 'push'
    s.setTask({ key, at: spot.at, face: spot.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed * (fast ? 1.2 : 1) })
  }

  private bayFoot(ref: SeatRef): Spot {
    return this.host.sites.recovery.bedFoot(ref)
  }

  // ------------------------------------------------------------------------------------------------------------------
  // the step
  // ------------------------------------------------------------------------------------------------------------------

  step(t: number, _dt: number): void {
    switch (this.stage) {
      case 'scheduled':
        if (this.host.mayStart(this, t)) this.tryArrive(t)
        break
      case 'arriving':
        this.stepArriving(t)
        break
      case 'room':
        this.stepRoom(t)
        break
      case 'toPacu':
        this.stepToPacu(t)
        break
      case 'pacu':
        if (t >= (this.pacuInAt ?? t) + this.plan.pacuSeconds) this.enterStage('wardFetch')
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
      case 'done':
        break
    }
    // the room is turned over from when the patient is in recovery and the 'out' step's time is up
    if (this.outSince !== null && this.roomEnd === null && this.pacuInAt !== null && t >= this.outSince + this.plan.steps.out) {
      this.roomEnd = Math.max(this.outSince + this.plan.steps.out, this.pacuInAt)
      this.host.touch()
    }
  }

  // --- in from lift B ---------------------------------------------------------------------------------------------

  private tryArrive(t: number): void {
    const porter = this.host.acquirePorter(this.id)
    if (porter === null) return
    this.porter = porter
    this.carrier = porter
    const p = this.newPatient(porter.x, porter.z, porter.walker.heading)
    this.ride(p, porter)
    p.fadeIn()
    this.wheelsIn = t
    this.enterStage('arriving')
    this.enterStep('arrive', t)
    // (driven up the corridor to the lane's stage, turned there, then driven along the lane to the park)
    this.driveToStage(porter, this.keys.stage)
    this.subAt = t
  }

  private stepArriving(t: number): void {
    const h = this.host
    const p = this.patient!
    const table = h.sites.table
    switch (this.sub) {
      case 0: {
        const porter = this.porter!
        if (this.leg === 'lift' && porter.isAt(this.keys.stage)) this.alignAtStage(porter)
        else if (this.leg === 'align' && porter.isAt(this.keys.align)) {
          this.driveLane(porter, this.keys.park, 0, this.lane.length, LANE_SPEED)
          this.leg = 'drive'
        } else if (this.leg === 'drive' && porter.isAt(this.keys.park)) this.leg = 'parked'
        if (this.leg === 'parked' && p.mounted && this.transferStarted(t)) {
          // (the stretcher lies parallel to the table, beside it: the patient is moved across the gap, the stretcher is not turned over the table)
          porter.entity.anim = 'give'
          h.sites.claim(table, p.entity.id)
          p.unloadTo(table.seat)
          h.say('cryoArrived', cryoLine('arrived', { patient: this.name }), { subjectId: p.entity.id })
          h.team.holdLane(this.id, false)
          this.sub = 1
        } else if (t - this.subAt > LIMIT.push) {
          h.stuck(`${this.id}: the stretcher did not reach the CT room in ${LIMIT.push} s`)
          const park = h.sites.spots.stretcherPark
          porter.settleTask({ key: this.keys.park, at: park.at, face: park.heading, anim: 'push', walkAnim: 'push' })
          this.leg = 'parked'
          this.subAt = t
        }
        if (this.leg === 'drive') this.holdLaneAt(porter)
        break
      }
      case 1:
        if (p.settled && p.seat === table.seat) {
          p.rideTable(h.sites.tableRef)
          this.leg = 'none'
          // (he backs the empty stretcher out along the lane first: index.ts)
          h.porterLeave(this.porter!, t)
          this.porter = null
          this.carrier = null
          this.sub = 2
        }
        break
      case 2:
        if (t >= this.until) {
          this.enterStage('room')
          this.enterStep('sedation', t)
        }
        break
    }
  }

  /** The radiographer steps back from the lane once the drive of `a` is close to the door (and returns when the stretcher is at the park). */
  private holdLaneAt(a: Staffer): void {
    const hw = this.hopOf(a)
    if (hw !== null && hw.laneProgress >= this.lane.sDoor - WAY_BEFORE) this.host.team.holdLane(this.id, true)
  }

  /**
   * The patient is moved across onto the CT table as the script's transfer step is under the clock (the step is the last of the arrival, so the caption
   * says what is being done); the stretcher waits beside the table until then. Always true without a script. The wait is the arrival's own: the
   * transfer step is part of the window the plan gives the arrival, so it ends within it.
   */
  private transferStarted(t: number): boolean {
    const sc = this.proc
    if (sc === null) return true
    const at = transferStepOf(sc.steps.cs)
    if (at < 0 || !stepAt(sc.steps, 'arrive', this.since, this.until, t, null, this.arrivalCursor)) return true
    return this.arrivalCursor.index >= at
  }

  // --- the steps in the room ---------------------------------------------------------------------------------------

  private stepRoom(t: number): void {
    const step = this.roomStep!
    if (step === 'aim') this.sayNeedles(t, false)
    if (step === 'dressing') {
      this.stepDressing(t)
      return
    }
    if (t < this.until) return
    const target = targetOf(this.plan)
    const order = roomStepsFor(target)
    const next = order[order.indexOf(step) + 1]
    const pid = this.patient?.entity.id
    if (step === 'planning') this.host.say('cryoPlanned', cryoLine('planned', { ir: staffName(IR), n: this.plan.needles.length, patient: this.name }, target), { subjectId: pid, actorId: IR })
    if (step === 'aim') this.sayNeedles(t, true)
    if (step === 'finalCt') this.host.say('cryoDone', cryoLine('done', { patient: this.name }, target), { subjectId: pid, actorId: IR })
    this.enterStep(next, t)
    if (next === 'anchorFreeze' || next === 'freeze1' || next === 'freeze2') {
      // (the lung freezes three times: the short anchor freeze first; the others twice)
      const n = target === 'lung' ? 3 : 2
      const k = next === 'anchorFreeze' ? 1 : next === 'freeze1' ? (n === 3 ? 2 : 1) : n
      this.host.say('cryoFreeze', cryoLine('freeze', { k, n, patient: this.name }), { subjectId: pid, actorId: IR })
    }
  }

  /** "Needle k of n" as each needle is fully in (all of them at the end of the aim step). */
  private sayNeedles(t: number, all: boolean): void {
    const p = this.plan
    while (this.needlesSaid < p.needles.length && (all || t >= this.since + needleInAt(p, this.needlesSaid, this.proc?.steps ?? null, this.since, this.until))) {
      const k = this.needlesSaid++
      this.host.say('cryoNeedle', cryoLine('needle', { k: k + 1, n: p.needles.length, err: p.needles[k].errorMm.toFixed(1) }), { subjectId: this.patient?.entity.id, actorId: IR })
    }
  }

  // --- the empty stretcher ------------------------------------------------------------------------------------------

  /** When the empty stretcher is called for: a porter's trip before the dressing is over, so he is at the park by its end (never before the dressing began). */
  private summonAt(): number {
    return Math.max(this.since, this.until - this.host.sites.stretcherTrip)
  }

  /**
   * The patient is on the porter's stretcher and has not yet been moved across to the CT table (the unload happens in the transfer step, once the
   * stretcher is parked): the published procedure view stays on the step before the transfer step meanwhile (index.ts), whatever the clock says.
   */
  transferHeld(): boolean {
    return this.stage === 'arriving' && this.sub === 0
  }

  /**
   * Is this case in its dressing, about to want the ward porter for the empty stretcher (within `window` s of calling for him, or past it and not yet served)?
   * The suite keeps the porter free for it (`acquirePorter` refuses the others meanwhile), so his trip is not made late by another job.
   */
  wantsPorter(t: number, window: number): boolean {
    return this.stage === 'room' && this.roomStep === 'dressing' && this.leg === 'none' && t >= this.summonAt() - window
  }

  /** Call the ward porter for the empty stretcher: he comes in from lift B, is walked to the lane's stage and driven along the lane to the park. False while no porter is free. */
  private summonPorter(t: number): boolean {
    const porter = this.host.acquirePorter(this.id)
    if (porter === null) return false
    this.porter = porter
    this.carrier = porter
    this.driveToStage(porter, this.keys.retStage)
    this.subAt = t
    return true
  }

  /** No porter free: the sedation nurse walks out of the scan room to the out point on clear floor outside its door, where she takes a stretcher. False while she is not free. */
  private fetchOnFoot(t: number): boolean {
    const nurse = this.host.team.acquire('sedation', this.id)
    if (nurse === null) return false
    const out = this.host.sites.spots.stretcherOut
    this.nurse = nurse
    this.carrier = nurse
    nurse.entity.anim = 'idle'
    nurse.setTask({ key: this.keys.fetch, at: out.at, face: out.heading, anim: 'idle', walkAnim: 'walk' })
    this.leg = 'lift'
    this.subAt = t
    this.host.team.holdLane(this.id, true)
    return true
  }

  /** A leg of the stretcher's way (begun at `since`) took too long: a safety net puts the pusher at the leg's end. Returns the time to count the next leg from. */
  private slow(t: number, since: number, who: Staffer, lane: PoseLane, s: number): number {
    if (t - since <= LIMIT.park) return since
    this.host.stuck(`${this.id}: the stretcher's way did not finish in ${LIMIT.park} s`)
    lane.poseAt(s, this.pose)
    who.placeAt(this.pose.x, this.pose.z, this.pose.heading)
    return t
  }

  private parkKey(): string {
    return this.carrier === this.nurse ? this.keys.outPark : this.keys.retPark
  }

  /**
   * One tick of the empty stretcher's way to the park (while the dressing runs): called for at `summonAt` (retried each tick while no porter is free; at the
   * dressing's end the nurse goes herself), walked to the lane's stage and driven along the lane, and left at the park, where its pusher waits for the dressing's
   * end. Allocation-free except at its events (a task begun).
   */
  private stepBack(t: number): void {
    const lane = this.lane
    const c = this.carrier
    switch (this.leg) {
      case 'none':
        if (t < this.summonAt() || this.summonPorter(t)) return
        // (no porter free yet: keep asking until the dressing is over, then the nurse fetches it herself)
        if (t >= this.until) this.fetchOnFoot(t)
        return
      case 'lift':
        if (c === this.nurse) {
          if (c!.isAt(this.keys.fetch)) {
            // (she takes a stretcher at the out point: made on clear floor outside the room's door, facing it; she drives it in from there)
            c!.setVehicle('stretcher')
            this.driveLane(c!, this.keys.outPark, lane.sOut, lane.length, LANE_SPEED)
            this.leg = 'drive'
            this.subAt = t
          } else this.subAt = this.slow(t, this.subAt, c!, lane, lane.sOut)
        } else if (c!.isAt(this.keys.retStage)) {
          this.alignAtStage(c!)
          this.subAt = t
        } else this.subAt = this.slow(t, this.subAt, c!, lane, 0)
        return
      case 'align':
        if (c!.isAt(this.keys.align)) {
          this.driveLane(c!, this.keys.retPark, 0, lane.length, LANE_SPEED)
          this.leg = 'drive'
          this.subAt = t
        } else this.subAt = this.slow(t, this.subAt, c!, lane, 0)
        return
      case 'drive':
        this.holdLaneAt(c!)
        if (c!.isAt(this.parkKey())) {
          this.leg = 'parked'
          this.host.team.holdLane(this.id, false)
        } else this.subAt = this.slow(t, this.subAt, c!, lane, lane.length)
        return
      case 'parked':
        return
    }
  }

  private stepDressing(t: number): void {
    const h = this.host
    const p = this.patient!
    this.stepBack(t)
    if (t < this.until || this.leg !== 'parked') return
    const c = this.carrier!
    if (!c.isAt(this.parkKey())) {
      if (t - this.until > LIMIT.park) {
        h.stuck(`${this.id}: the stretcher did not reach the table in time`)
        const park = h.sites.spots.stretcherPark
        c.placeAt(park.at.x, park.at.z, park.heading)
      }
      return
    }
    if (!p.settled) return
    // (no free recovery bay: the patient waits on the table)
    const idx = h.sites.freePacu()
    if (idx < 0) return
    const ref = h.sites.recovery.pacu[idx]
    if (!h.sites.recovery.claim(ref, p.entity.id)) return
    this.pacuRef = ref
    c.entity.anim = 'give'
    h.sites.release(h.sites.table, p.entity.id)
    p.loadOn(c)
    this.outSince = t
    this.roomStep = 'out'
    this.since = t
    this.until = t + this.plan.steps.out
    this.subAt = t
    this.enterStage('toPacu')
  }

  // --- to recovery ---------------------------------------------------------------------------------------------------

  /**
   * The patient is on the stretcher at the park (the porter's, or the nurse's): it is backed out along the lane to the out point beside the scan room's door
   * (the radiographer steps back from the lane meanwhile), driven along the hall (forwards or backwards) to the bay's own line, turned there on the spot, slowly,
   * from west to south, and driven south down that line to the bay's foot, where it lies along the bed and the patient is moved across. The porter then
   * takes his empty stretcher back to lift B; the nurse who carried it goes back to the team.
   */
  private stepToPacu(t: number): void {
    const h = this.host
    const p = this.patient!
    const c = this.carrier!
    const ref = this.pacuRef!
    const lane = this.lane
    const sites = h.sites
    const hall = sites.hallLane
    const bay = sites.bayLanes[sites.recovery.pacu.indexOf(ref)]
    switch (this.sub) {
      case 0:
        if (p.mounted && t - this.subAt >= CONFIG.er.loadSeconds) {
          h.team.holdLane(this.id, true)
          this.driveLane(c, this.keys.backOut, lane.length, lane.sOut, BACK_SPEED)
          this.sub = 1
          this.subAt = t
        }
        break
      case 1:
        // (past the scan room's door the radiographer may come back to her place)
        if (this.hopOf(c)!.laneProgress < lane.sDoor - 1) h.team.holdLane(this.id, false)
        if (c.isAt(this.keys.backOut)) {
          // (along the hall to the bay's line: forwards, west, to the bays west of the out point, backwards to the one east of it)
          const here = HALL_EAST
          const there = lane.out.x + HALL_EAST - bay.poseAt(0, this.pose).x
          this.driveLane(c, this.keys.hall, here, there, there >= here ? LANE_SPEED : BACK_SPEED, hall)
          this.sub = 2
          this.subAt = t
        } else this.subAt = this.slow(t, this.subAt, c, lane, lane.sOut)
        break
      case 2:
        if (c.isAt(this.keys.hall)) {
          // (turned on the spot, slowly, from west to south: the way round that sweeps the south of the hall, clear of the beds and the station)
          this.hopOf(c)?.armTurn(0, TURN_RATE, 1)
          c.setTask({ key: this.keys.turn, at: { x: c.x, z: c.z }, face: 0, anim: 'push', walkAnim: 'push' })
          this.sub = 3
          this.subAt = t
        } else this.subAt = this.slow(t, this.subAt, c, hall, hall.length)
        break
      case 3:
        if (c.isAt(this.keys.turn)) {
          this.driveLane(c, this.keys.toPacu, 0, bay.length, LANE_SPEED, bay)
          this.sub = 4
          this.subAt = t
        }
        break
      case 4:
        if (c.isAt(this.keys.toPacu) && p.mounted) {
          p.unloadTo(ref.seat)
          c.entity.anim = 'give'
          this.sub = 5
        } else if (t - this.subAt > LIMIT.pacu) {
          h.stuck(`${this.id}: the stretcher did not reach recovery in ${LIMIT.pacu} s`)
          const foot = this.bayFoot(ref)
          c.placeAt(foot.at.x, foot.at.z, foot.heading)
          this.subAt = t
        }
        break
      case 5:
        if (p.settled && p.seat === ref.seat) {
          h.guestBay(ref.seat.id, p.entity.id, this.name, t)
          if (c === this.nurse) this.releaseNurse()
          else {
            // (the porter takes his empty stretcher back to lift B)
            h.porterLeave(c, t)
            this.porter = null
          }
          this.carrier = null
          this.pacuInAt = t
          this.enterStage('pacu')
        }
        break
    }
  }

  private releaseNurse(): void {
    const n = this.nurse
    if (n === null) return
    n.setVehicle('none')
    n.walkAnim = 'walk'
    n.idleAnim = 'idle'
    this.host.team.release('sedation', this.id)
    this.nurse = null
    if (this.carrier === n) this.carrier = null
  }

  // --- back up to the ward -------------------------------------------------------------------------------------------

  private stepWardFetch(t: number): void {
    const h = this.host
    const p = this.patient!
    const ref = this.pacuRef!
    const key = `${this.id}:wardFetch`
    if (this.sub === 0) {
      const porter = h.acquirePorter(this.id)
      if (porter === null) return
      this.porter = porter
      this.push(porter, key, this.bayFoot(ref), true)
      this.sub = 1
      this.subAt = t
      return
    }
    const porter = this.porter!
    if (this.sub === 1) {
      if (porter.isAt(key)) {
        porter.faceTowards(ref.seat)
        porter.entity.anim = 'give'
        p.loadOn(porter)
        this.sub = 2
        this.subAt = t
      } else if (t - this.subAt > LIMIT.ward) {
        h.stuck(`${this.id}: the ward porter did not reach the recovery bay in time`)
        const foot = this.bayFoot(ref)
        porter.placeAt(foot.at.x, foot.at.z, foot.heading)
        this.subAt = t
      }
      return
    }
    if (p.mounted && t - this.subAt >= CONFIG.er.loadSeconds) {
      h.sites.recovery.release(ref, p.entity.id)
      h.guestBay(ref.seat.id, null, null, t)
      this.pacuOutAt = t
      this.enterStage('wardPush')
    }
  }

  private stepWardPush(t: number): void {
    const h = this.host
    const porter = this.porter!
    const key = `${this.id}:toLift`
    if (this.sub === 0) {
      // the lobby's stretcher slot first, so no lift party is in the way
      if (h.lifts !== null && !h.lifts.claimFade('B', 2, porter.staff.id)) return
      this.push(porter, key, LIFTS.B[2].stretcher)
      this.sub = 1
      this.subAt = t
      return
    }
    if (porter.isAt(key)) {
      this.patient!.fadeOut()
      porter.fadeOut()
      this.enterStage('wardFade')
    } else if (t - this.subAt > LIMIT.ward) {
      h.stuck(`${this.id}: the stretcher did not reach lift B in time`)
      const spot = LIFTS.B[2].stretcher
      porter.placeAt(spot.at.x, spot.at.z, spot.heading)
      this.subAt = t
    }
  }

  private stepWardFade(_t: number): void {
    const p = this.patient!
    const porter = this.porter!
    if (!p.gone || !porter.gone) return
    this.host.porterDone(porter)
    this.porter = null
    this.patient = null
    this.finish()
  }

  private finish(): void {
    this.host.team.releaseAll(this.id)
    this.host.sites.releaseAll(this.patientId)
    this.enterStage('done')
    this.host.caseFinished(this)
  }

  // ------------------------------------------------------------------------------------------------------------------
  // warm start
  // ------------------------------------------------------------------------------------------------------------------

  /** Put the case where its nominal timeline has it at t (the caller disposed everything first). */
  warm(t: number): void {
    const h = this.host
    const tl = this.tl
    const plan = this.plan
    if (t < plan.nominalIn) return
    this.wheelsIn = plan.nominalIn
    if (t < tl.end.arrive) {
      // the porter has just parked the stretcher beside the table
      const porter = h.placePorter(this.id, h.sites.spots.stretcherPark)
      this.porter = porter
      this.carrier = porter
      this.leg = 'parked'
      porter.settleTask({ key: this.tableKey(), at: porter.pos, face: porter.walker.heading, anim: 'push', walkAnim: 'push' })
      const p = this.newPatient(porter.x, porter.z, porter.walker.heading)
      this.ride(p, porter)
      this.stage = 'arriving'
      this.roomStep = 'arrive'
      this.since = tl.start.arrive
      this.until = tl.end.arrive
      this.subAt = t
      this.syncView()
      return
    }
    if (t < tl.end.dressing) {
      this.warmOnTable(t)
      return
    }
    this.outSince = tl.start.out
    this.needlesSaid = plan.needles.length
    if (t < tl.pacuOut) {
      const p = this.newPatient(h.sites.table.seat.x, h.sites.table.seat.z, 0)
      const idx = h.sites.freePacu()
      if (idx < 0 || !h.sites.recovery.claim(h.sites.recovery.pacu[idx], p.entity.id)) {
        // no recovery bay free at the Jump: still on the table, waiting for one
        h.world.hooks.remove(p)
        this.patient = null
        this.outSince = null
        this.warmOnTable(t, true)
        return
      }
      const ref = h.sites.recovery.pacu[idx]
      this.pacuRef = ref
      p.placeOnSeat(ref.seat)
      this.roomEnd = tl.roomEnd
      this.pacuInAt = tl.pacuIn
      h.guestBay(ref.seat.id, p.entity.id, this.name, Math.min(t, tl.pacuIn))
      this.stage = 'pacu'
      this.syncView()
      return
    }
    // back up on the ward: nothing left on level 2
    this.roomEnd = tl.roomEnd
    this.pacuInAt = tl.pacuIn
    this.pacuOutAt = tl.pacuOut
    this.stage = 'done'
    this.syncView()
  }

  /** On the CT table in the step the timeline has at t (or, `late`, in a dressing that is over: waiting for a recovery bay). */
  private warmOnTable(t: number, late = false): void {
    const h = this.host
    const tl = this.tl
    const seat = h.sites.table.seat
    const p = this.newPatient(seat.x, seat.z, seat.heading)
    h.sites.claim(h.sites.table, p.entity.id)
    p.placeOnSeat(seat)
    p.rideTable(h.sites.tableRef)
    let step: RoomStep = 'sedation'
    const order = roomStepsFor(targetOf(this.plan))
    for (const s of order) if (s !== 'arrive' && s !== 'out' && t >= tl.start[s]) step = s
    if (late) step = 'dressing'
    this.stage = 'room'
    this.roomStep = step
    this.since = tl.start[step]
    this.until = tl.end[step]
    // the needle lines already said (silently)
    const idx = order.indexOf(step)
    if (idx > order.indexOf('aim')) this.needlesSaid = this.plan.needles.length
    else if (step === 'aim') {
      while (this.needlesSaid < this.plan.needles.length && t >= this.since + needleInAt(this.plan, this.needlesSaid, this.proc?.steps ?? null, this.since, this.until)) this.needlesSaid++
    }
    if (step === 'dressing' && late) {
      // (the dressing is over and no bay was free: the porter waits with the stretcher at the park, the patient on the table: it is never made across the table)
      const park = h.sites.spots.stretcherPark
      const porter = h.placePorter(this.id, park)
      porter.settleTask({ key: this.keys.retPark, at: park.at, face: park.heading, anim: 'push', walkAnim: 'push' })
      this.porter = porter
      this.carrier = porter
      this.leg = 'parked'
    } else if (step === 'dressing' && t >= this.summonAt()) this.warmTrip(t)
    this.syncView()
  }

  /**
   * A warm start inside the porter's trip with the empty stretcher (from when he is called for to the dressing's end): he is where the nominal trip has him at
   * `t` (never made in the scan room: in the corridor from lift B, turning at the stage, on the lane, or at the park), and goes on from there.
   */
  private warmTrip(t: number): void {
    const h = this.host
    const sites = h.sites
    const lane = sites.lane
    const e = Math.max(0, t - this.summonAt())
    let porter: Staffer
    const place = (at: LanePose) => h.placePorter(this.id, { at: { x: at.x, z: at.z }, heading: at.heading })
    if (e < sites.stretcherLift) {
      // (on the way up the corridor)
      const s = Math.min(lane.lift.length, Math.max(0, e - LEAD_IN) * LANE_SPEED)
      porter = place(lane.lift.poseAt(s, this.pose))
      this.driveLane(porter, this.keys.retStage, s, lane.lift.length, LANE_SPEED, lane.lift)
      this.leg = 'lift'
    } else if (e < sites.stretcherLift + STAGE_TURN) {
      // (turning at the stage)
      porter = place(lane.lift.poseAt(lane.lift.length, this.pose))
      this.alignAtStage(porter)
    } else {
      const s = Math.min(lane.length, (e - sites.stretcherLift - STAGE_TURN) * LANE_SPEED)
      porter = place(lane.poseAt(s, this.pose))
      if (s >= lane.length - 1e-6) {
        porter.settleTask({ key: this.keys.retPark, at: porter.pos, face: porter.walker.heading, anim: 'push', walkAnim: 'push' })
        this.leg = 'parked'
      } else {
        this.driveLane(porter, this.keys.retPark, s, lane.length, LANE_SPEED)
        this.leg = 'drive'
        if (s >= lane.sDoor - WAY_BEFORE) h.team.holdLane(this.id, true)
      }
    }
    this.porter = porter
    this.carrier = porter
    this.subAt = t
  }
}
