/**
 * R4: one cryoablation case, from lift B to lift B. The patient is an inpatient of the surgical ward upstairs: the ward porter rolls them out of
 * lift B (the "level 3" fade, as surgery's ward patients), pushes the stretcher into the CT room and the patient moves across onto the CT table,
 * which carries them in and out for the scans (`rideTable`). The steps then run on the plan's clock (plan.ts); after the dressing the sedation
 * nurse takes them on a stretcher to a recovery bay (a guest of the surgery suite's PACU), and after their recovery time the ward porter takes
 * them back up in lift B. Physical things (the stretcher arriving, a free recovery bay) only ever DELAY the next step, never shorten one.
 *
 * Stages: scheduled; arriving (step 'arrive'); room (sedation .. dressing); toPacu (step 'out'); pacu; wardFetch, wardPush, wardFade; done.
 * A warm start (`warm(t)`) puts the case where its nominal timeline has it at t, silently.
 */
import { cryoLine } from '@/content/cryoSuite'
import { staffName } from '@/content/staff'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import type { LiftBank } from '../lifts'
import { LIFTS, VEHICLE_AHEAD, type Spot } from '../places'
import type { Rng } from '../rng'
import type { CryoCaseView, CryoStep, SimEventType } from '../types'
import { SurgicalPatient, type Staffer } from '../surgery/actors'
import type { SeatRef } from '../surgery/sites'
import { needleInAt } from './derive'
import { cryoTimeline, ROOM_STEPS, type CryoTimeline, type PlannedCryoCase, type RoomStep } from './plan'
import type { CryoSites } from './sites'
import type { CryoTeam } from './team'

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
  private pacuRef: SeatRef | null = null
  private sub = 0
  private subAt = 0
  private needlesSaid = 0

  constructor(
    readonly plan: PlannedCryoCase,
    readonly host: CryoHost,
    readonly rng: Rng,
    readonly name: string,
  ) {
    this.tl = cryoTimeline(plan)
    this.view = {
      id: plan.id,
      patientId: null,
      name,
      demo: plan.demo,
      plannedIn: plan.plannedIn,
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
    this.until = t + this.plan.steps[step]
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
    this.host.sites.releaseAll(this.patientId)
    this.porter = null
  }

  private tableKey(): string {
    return `${this.id}:park`
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
    const p = this.newPatient(porter.x, porter.z, porter.walker.heading)
    this.ride(p, porter)
    p.fadeIn()
    this.wheelsIn = t
    this.enterStage('arriving')
    this.enterStep('arrive', t)
    this.push(porter, this.tableKey(), this.host.sites.spots.stretcherPark)
    this.subAt = t
  }

  private stepArriving(t: number): void {
    const h = this.host
    const p = this.patient!
    const table = h.sites.table
    switch (this.sub) {
      case 0: {
        const porter = this.porter!
        if (porter.isAt(this.tableKey()) && p.mounted) {
          porter.faceTowards(table.seat)
          porter.entity.anim = 'give'
          h.sites.claim(table, p.entity.id)
          p.unloadTo(table.seat)
          h.say('cryoArrived', cryoLine('arrived', { patient: this.name }), { subjectId: p.entity.id })
          this.sub = 1
        } else if (t - this.subAt > LIMIT.push) {
          h.stuck(`${this.id}: the stretcher did not reach the CT room in ${LIMIT.push} s`)
          const park = h.sites.spots.stretcherPark
          porter.placeAt(park.at.x, park.at.z, park.heading)
          this.subAt = t
        }
        break
      }
      case 1:
        if (p.settled && p.seat === table.seat) {
          p.rideTable(h.sites.tableRef)
          h.porterLeave(this.porter!, t)
          this.porter = null
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

  // --- the steps in the room ---------------------------------------------------------------------------------------

  private stepRoom(t: number): void {
    const step = this.roomStep!
    if (step === 'aim') this.sayNeedles(t, false)
    if (step === 'dressing') {
      this.stepDressing(t)
      return
    }
    if (t < this.until) return
    const next = ROOM_STEPS[ROOM_STEPS.indexOf(step) + 1]
    const pid = this.patient?.entity.id
    if (step === 'planning') this.host.say('cryoPlanned', cryoLine('planned', { ir: staffName(IR), n: this.plan.needles.length, patient: this.name }), { subjectId: pid, actorId: IR })
    if (step === 'aim') this.sayNeedles(t, true)
    if (step === 'finalCt') this.host.say('cryoDone', cryoLine('done', { patient: this.name }), { subjectId: pid, actorId: IR })
    this.enterStep(next, t)
    if (next === 'freeze1' || next === 'freeze2') this.host.say('cryoFreeze', cryoLine('freeze', { k: next === 'freeze1' ? 1 : 2, patient: this.name }), { subjectId: pid, actorId: IR })
    if (next === 'dressing') this.beginDressing()
  }

  /** "Needle k of n" as each needle is fully in (all of them at the end of the aim step). */
  private sayNeedles(t: number, all: boolean): void {
    const p = this.plan
    while (this.needlesSaid < p.needles.length && (all || t >= this.since + needleInAt(p, this.needlesSaid))) {
      const k = this.needlesSaid++
      this.host.say('cryoNeedle', cryoLine('needle', { k: k + 1, n: p.needles.length, err: p.needles[k].errorMm.toFixed(1) }), { subjectId: this.patient?.entity.id, actorId: IR })
    }
  }

  /** The sedation nurse brings a stretcher alongside the table (she then takes the patient to recovery). */
  private beginDressing(): void {
    const nurse = this.host.team.acquire('sedation', this.id)
    if (nurse === null) return
    this.nurse = nurse
    nurse.setVehicle('stretcher')
    this.push(nurse, `${this.id}:outPark`, this.host.sites.spots.stretcherPark)
    this.subAt = this.since
  }

  private stepDressing(t: number): void {
    const h = this.host
    const p = this.patient!
    if (this.nurse === null) {
      this.beginDressing()
      return
    }
    const nurse = this.nurse
    if (t < this.until) return
    if (!nurse.isAt(`${this.id}:outPark`)) {
      if (t - this.until > LIMIT.park) {
        h.stuck(`${this.id}: the nurse's stretcher did not reach the table in time`)
        const park = h.sites.spots.stretcherPark
        nurse.placeAt(park.at.x, park.at.z, park.heading)
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
    nurse.faceTowards(h.sites.table.seat)
    nurse.entity.anim = 'give'
    h.sites.release(h.sites.table, p.entity.id)
    p.loadOn(nurse)
    this.outSince = t
    this.roomStep = 'out'
    this.since = t
    this.until = t + this.plan.steps.out
    this.subAt = t
    this.enterStage('toPacu')
  }

  // --- to recovery ---------------------------------------------------------------------------------------------------

  private stepToPacu(t: number): void {
    const h = this.host
    const p = this.patient!
    const nurse = this.nurse!
    const ref = this.pacuRef!
    const key = `${this.id}:toPacu`
    switch (this.sub) {
      case 0:
        if (p.mounted && t - this.subAt >= CONFIG.er.loadSeconds) {
          this.push(nurse, key, this.bayFoot(ref))
          this.sub = 1
          this.subAt = t
        }
        break
      case 1:
        if (nurse.isAt(key) && p.mounted) {
          p.unloadTo(ref.seat)
          nurse.entity.anim = 'give'
          this.sub = 2
        } else if (t - this.subAt > LIMIT.pacu) {
          h.stuck(`${this.id}: the stretcher did not reach recovery in ${LIMIT.pacu} s`)
          const foot = this.bayFoot(ref)
          nurse.placeAt(foot.at.x, foot.at.z, foot.heading)
          this.subAt = t
        }
        break
      case 2:
        if (p.settled && p.seat === ref.seat) {
          h.guestBay(ref.seat.id, p.entity.id, this.name, t)
          this.releaseNurse()
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
    for (const s of ROOM_STEPS) if (s !== 'arrive' && s !== 'out' && t >= tl.start[s]) step = s
    if (late) step = 'dressing'
    this.stage = 'room'
    this.roomStep = step
    this.since = tl.start[step]
    this.until = tl.end[step]
    // the needle lines already said (silently)
    const idx = ROOM_STEPS.indexOf(step)
    if (idx > ROOM_STEPS.indexOf('aim')) this.needlesSaid = this.plan.needles.length
    else if (step === 'aim') {
      while (this.needlesSaid < this.plan.needles.length && t >= this.since + needleInAt(this.plan, this.needlesSaid)) this.needlesSaid++
    }
    if (step === 'dressing') {
      const nurse = h.team.acquire('sedation', this.id)
      if (nurse !== null) {
        this.nurse = nurse
        nurse.setVehicle('stretcher')
        const park = h.sites.spots.stretcherPark
        nurse.settleTask({ key: `${this.id}:outPark`, at: park.at, face: park.heading, anim: 'push', walkAnim: 'push' })
      }
    }
    this.syncView()
  }
}
