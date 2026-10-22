/**
 * The ER and triage staff, each a small hand-written state machine (skill: role behaviours).
 *
 *   Receptionist   at the desk; 'talk' while she serves the queue head, 'tablet' otherwise.
 *   TriageNurse    works her two bays: calls the next waiting patient, walks out to them, walks them in, assesses.
 *   ErNurse        escorts patients from the waiting room to a free bay, and takes the paramedics' handover.
 *   ErDoctor       takes the highest-priority patient whose trolley is ready, examines, then charts briefly.
 *
 * The decisions (who is next, which bay) belong to the ErDepartment board; these controllers only walk and pose.
 */
import type { StaffMember } from '@/content/staff'
import { CONFIG } from '../config'
import type { PeopleContext } from '../people'
import { LOBBY } from '../places'
import type { Rng } from '../rng'
import type { Vec2 } from '../types'
import type { Walker } from '../walker'
import { Actor } from './actor'
import type { ErCase, TriageBay } from './department'
import type { ErPatient } from './patient'
import { MANUAL_SEND_STAND } from '../blood/nurse'
import { callSpot, ER_DOCTOR_POSTS, ER_NURSE_POSTS, headingTo, seatSpot, TRIAGE_NURSE_BAYS, TRIAGE_NURSE_POSTS, type Post } from './spots'
import type { World } from './world'

type StaffRole = 'receptionist' | 'nurse' | 'doctor'

const RETIRE_IDLE_SECONDS = 1200

abstract class Staff extends Actor {
  constructor(
    readonly world: World,
    readonly staff: StaffMember,
    role: StaffRole,
    protected readonly post: Post,
    walker: Walker,
    protected readonly srng: Rng,
  ) {
    super(staff.id, role, staff.name, post.at, post.heading, walker, 'role')
    this.cruise = CONFIG.people.walkSpeed * (0.95 + (this.entity.variant % 11) / 100)
  }

  /**
   * Set by the day rhythm (src/sim/day) when this person's shift is ending: they take no new patient, finish what they
   * hold and wait at their post to hand over.
   */
  retiring = false

  /**
   * Safety net: a person told to retire who is still idle at the post 20 minutes later was not relieved (the handover was dropped), so they
   * go on working; a real leaver is replaced and removed within minutes. Call from `think` with whether they are idle.
   */
  protected tickRetire(dt: number, idle: boolean): void {
    if (!this.retiring || !idle) {
      this.retiredIdle = 0
      return
    }
    this.retiredIdle += dt
    if (this.retiredIdle > RETIRE_IDLE_SECONDS) {
      this.retiring = false
      this.retiredIdle = 0
    }
  }

  private retiredIdle = 0

  /** At the post with nothing in hand: the moment the day rhythm may take them off duty. */
  get atRest(): boolean {
    return false
  }

  /** Where to stand to speak to somebody who is waiting: beside their seat, or beside them if they stand. */
  protected meetSpot(p: ErPatient): Vec2 {
    if (p.waitSeat) return callSpot(p.waitSeat)
    return { x: p.walker.x + 0.9, z: p.walker.z }
  }
}

// ---------------------------------------------------------------------------------------------

export class Receptionist extends Staff {
  constructor(world: World, staff: StaffMember, walker: Walker, rng: Rng) {
    super(world, staff, 'receptionist', { at: LOBBY.reception.at, heading: LOBBY.reception.heading }, walker, rng)
  }

  override get mobile(): boolean {
    return false
  }

  override get atRest(): boolean {
    return !this.world.serverBusy.reception
  }

  think(): void {
    this.entity.anim = this.world.serverBusy.reception ? 'talk' : 'tablet'
  }
}

// ---------------------------------------------------------------------------------------------

type TriageState = 'idle' | 'toPatient' | 'calling' | 'escorting' | 'assessing' | 'returning'

export class TriageNurse extends Staff {
  private state: TriageState = 'idle'
  private c: ErCase | null = null
  private patient: ErPatient | null = null
  private bay: TriageBay | null = null
  private timer = 0
  private elapsed = 0
  private readonly bays: number[]

  constructor(world: World, staff: StaffMember, readonly index: number, walker: Walker, rng: Rng) {
    super(world, staff, 'nurse', TRIAGE_NURSE_POSTS[index], walker, rng)
    this.bays = TRIAGE_NURSE_BAYS[index]
  }

  think(dt: number, _ctx: PeopleContext): void {
    this.tickRetire(dt, this.state === 'idle' && this.done)
    switch (this.state) {
      case 'idle':
        this.entity.anim = 'tablet'
        if (this.due(dt) && !this.retiring) this.takeNext()
        break
      case 'toPatient':
        if (this.done) {
          this.faceTowards(this.patient!.pos)
          this.entity.anim = 'talk'
          this.timer = CONFIG.er.callSeconds
          this.state = 'calling'
        }
        break
      case 'calling':
        this.timer -= dt
        if (this.timer <= 0) {
          const bay = this.bay!
          this.patient!.followTo(this, bay.seat)
          this.moveTo(seatSpot(bay.seat, 'nurse'), { face: Math.atan2(bay.seat.x - bay.seat.approach.x, bay.seat.z - bay.seat.approach.z) })
          this.state = 'escorting'
        }
        break
      case 'escorting':
        if (this.done && this.c!.state === 'triage.assessing') {
          this.elapsed = 0
          this.entity.anim = 'talk'
          this.state = 'assessing'
        }
        break
      case 'assessing':
        this.elapsed += dt
        this.entity.anim = this.elapsed < 20 ? 'talk' : 'tablet'
        if (this.c!.state !== 'triage.assessing') {
          this.c = null
          this.patient = null
          this.bay = null
          this.moveTo(this.post.at, { face: this.post.heading })
          this.state = 'returning'
        }
        break
      case 'returning':
        if (this.due(dt) && !this.retiring) this.takeNext()
        if (this.state === 'returning' && this.done) {
          this.stand(this.post.heading)
          this.state = 'idle'
        }
        break
    }
  }

  override get atRest(): boolean {
    return this.state === 'idle' && this.done
  }

  private takeNext(): void {
    const w = this.world
    const claim = w.er.claimTriage(this.staff.id, this.bays)
    if (!claim) return
    const patient = w.patients.get(claim.c.id)
    if (!patient) return
    this.c = claim.c
    this.bay = claim.bay
    this.patient = patient
    patient.beCalled()
    this.moveTo(this.meetSpot(patient))
    this.state = 'toPatient'
  }
}

// ---------------------------------------------------------------------------------------------

type ErNurseState =
  | 'idle'
  | 'toPatient'
  | 'calling'
  | 'escorting'
  | 'loading'
  | 'wheeling'
  | 'unloading'
  | 'toHandover'
  | 'handover'
  | 'toCare'
  | 'caring'
  | 'toTube'
  | 'sending'
  | 'returning'

/** A leg to the tube station that takes longer than this sends the tubes from where she stands (no teleport). */
const TUBE_WALK_TIMEOUT = 120
const TUBE_SECONDS = 2.5

/**
 * ER nurse. Wave 1: a handover for the paramedics first, then the priority 1-2 walk-in who needs a wheelchair, then the care step of a patient
 * on a trolley (observations, cannula, ECG, the bedside bloods), then the escort of a walking patient. After drawing bloods she carries the
 * tubes to the pneumatic tube station and sends them.
 */
export class ErNurse extends Staff {
  private state: ErNurseState = 'idle'
  private c: ErCase | null = null
  private patient: ErPatient | null = null
  private timer = 0
  private elapsed = 0
  private legT = 0
  private wheelchair = false

  constructor(world: World, staff: StaffMember, readonly index: number, walker: Walker, rng: Rng) {
    super(world, staff, 'nurse', ER_NURSE_POSTS[index], walker, rng)
  }

  think(dt: number, _ctx: PeopleContext): void {
    this.tickRetire(dt, this.state === 'idle' && this.done)
    switch (this.state) {
      case 'idle':
        this.entity.anim = 'tablet'
        if (this.due(dt) && !this.retiring) this.takeNext()
        break
      case 'toPatient':
        if (this.done) {
          this.faceTowards(this.patient!.pos)
          this.entity.anim = 'talk'
          this.timer = CONFIG.er.callSeconds
          this.state = 'calling'
        }
        break
      case 'calling': {
        this.timer -= dt
        if (this.timer <= 0) {
          const p = this.patient!
          if (this.wheelchair) {
            p.wheelOn(this)
            this.entity.anim = 'give'
            this.timer = 0
            this.state = 'loading'
            break
          }
          const seat = p.baySeat!
          p.followTo(this, seat)
          this.moveTo(seatSpot(seat, 'nurse'), { face: Math.atan2(seat.x - seat.approach.x, seat.z - seat.approach.z) })
          this.state = 'escorting'
        }
        break
      }
      case 'loading': {
        const p = this.patient!
        if (!p.mounted) break
        this.timer += dt
        if (this.timer < CONFIG.er.loadSeconds) break
        const seat = p.baySeat!
        this.entity.anim = 'push'
        this.moveTo(seat.approach, { face: headingTo(seat.approach, seat), speed: CONFIG.er.wheelSpeed })
        this.state = 'wheeling'
        break
      }
      case 'wheeling':
        if (this.done) {
          this.entity.anim = 'give'
          this.patient!.unloadToTrolley()
          this.state = 'unloading'
        }
        break
      case 'unloading':
        if (this.c!.onTrolley && this.patient!.settled) this.putDownWheelchair()
        if (this.state === 'unloading' && this.c!.onTrolley && this.patient!.settled) this.startCare()
        break
      case 'escorting':
        if (this.done && this.c!.onTrolley) this.startCare()
        break
      case 'toCare':
        if (this.done) {
          const p = this.patient!
          this.faceTowards({ x: p.baySeat!.x, z: p.baySeat!.z })
          this.entity.anim = 'tablet'
          p.nurseHere()
          this.elapsed = 0
          this.state = 'caring'
        }
        break
      case 'caring':
        this.stepCare(dt)
        break
      case 'toTube':
        this.legT += dt
        if (this.done || this.legT > TUBE_WALK_TIMEOUT) {
          this.entity.anim = 'give'
          this.timer = TUBE_SECONDS
          this.state = 'sending'
        }
        break
      case 'sending':
        this.timer -= dt
        if (this.timer <= 0) {
          this.patient?.sendTubes()
          this.goBack()
        }
        break
      case 'toHandover':
        if (this.done) {
          const c = this.c!
          c.handover = 'doing'
          this.faceTowards({ x: this.patient!.baySeat!.approach.x, z: this.patient!.baySeat!.approach.z })
          this.entity.anim = 'talk'
          this.timer = this.srng.between(CONFIG.er.handoverSeconds)
          this.state = 'handover'
        }
        break
      case 'handover':
        this.timer -= dt
        if (this.timer <= 0) {
          this.c!.handover = 'done'
          // the same nurse carries on with the patient she has just taken over
          if (this.c!.careBy === null && this.c!.state === 'inBay.waitingCare') this.startCare()
          else this.goBack()
        }
        break
      case 'returning':
        if (this.due(dt) && !this.retiring) this.takeNext()
        if (this.state === 'returning' && this.done) {
          this.stand(this.post.heading)
          this.state = 'idle'
        }
        break
    }
  }

  override get atRest(): boolean {
    return this.state === 'idle' && this.done
  }

  /** The care step: observations, cannula, ECG, then the draw. The patient's own timer ends it. */
  private stepCare(dt: number): void {
    const p = this.patient!
    const c = this.c!
    this.elapsed += dt
    if (c.state === 'inBay.care') {
      const f = this.elapsed / Math.max(1, p.careSeconds)
      this.entity.anim = f < 0.3 ? 'tablet' : f < 0.55 ? 'give' : f < 0.75 ? 'tablet' : 'give'
      return
    }
    if (c.state === 'inBay.waitingCare') return
    // care is over: bloods drawn go to the tube station
    if (p.tubesWaiting) {
      this.legT = 0
      this.moveTo(MANUAL_SEND_STAND.at, { face: MANUAL_SEND_STAND.heading })
      this.state = 'toTube'
    } else this.goBack()
  }

  private putDownWheelchair(): void {
    if (!this.wheelchair) return
    this.wheelchair = false
    this.setVehicle('none')
    this.walkAnim = 'walk'
    this.idleAnim = 'idle'
    this.cruise = CONFIG.people.walkSpeed * (0.95 + (this.entity.variant % 11) / 100)
  }

  /** At the bay with a patient on the trolley: take the care step straight away. */
  private startCare(): void {
    const c = this.c!
    const p = this.patient!
    if (c.careBy !== null && c.careBy !== this.staff.id) {
      this.goBack()
      return
    }
    c.careBy = this.staff.id
    this.moveTo(seatSpot(p.baySeat!, 'nurse'), { face: headingTo(seatSpot(p.baySeat!, 'nurse'), p.baySeat!) })
    this.state = 'toCare'
  }

  private goBack(): void {
    this.putDownWheelchair()
    this.c = null
    this.patient = null
    this.moveTo(this.post.at, { face: this.post.heading })
    this.state = 'returning'
  }

  /** S1: this nurse is already part-way through the care step of `patient` (placed at the bedside). */
  warmCare(patient: ErPatient, progress: number): void {
    const seat = patient.baySeat
    if (!seat) return
    const spot = seatSpot(seat, 'nurse')
    this.c = patient.c
    this.patient = patient
    patient.c.careBy = this.staff.id
    this.placeAt(spot.x, spot.z, headingTo(spot, seat))
    this.elapsed = progress * Math.max(1, patient.careSeconds)
    this.entity.anim = 'give'
    this.state = 'caring'
  }

  /** A handover first (the paramedics are waiting), then a walk-in who needs a wheelchair, then care, then the walk-ins who walk. */
  private takeNext(): void {
    const w = this.world
    const hand = w.er.claimHandover(this.staff.id)
    if (hand) {
      const patient = w.patients.get(hand.id)
      if (!patient?.baySeat) {
        hand.handoverBy = null
        return
      }
      this.c = hand
      this.patient = patient
      this.moveTo(seatSpot(patient.baySeat, 'nurse'))
      this.state = 'toHandover'
      return
    }
    const crit = w.er.claimEscort(this.staff.id, 'critical')
    if (crit) {
      const patient = w.patients.get(crit.id)
      if (!patient) return
      this.c = crit
      this.patient = patient
      this.wheelchair = true
      this.setVehicle('wheelchair')
      this.walkAnim = 'push'
      this.idleAnim = 'push'
      this.cruise = CONFIG.er.wheelSpeed * 1.2
      this.moveTo(this.meetSpot(patient))
      this.state = 'toPatient'
      return
    }
    const care = w.er.claimCare(this.staff.id)
    if (care) {
      const patient = w.patients.get(care.id)
      if (!patient?.baySeat) {
        care.careBy = null
        return
      }
      this.c = care
      this.patient = patient
      const spot = seatSpot(patient.baySeat, 'nurse')
      this.moveTo(spot, { face: headingTo(spot, patient.baySeat) })
      this.state = 'toCare'
      return
    }
    const esc = w.er.claimEscort(this.staff.id, 'walking')
    if (!esc) return
    const patient = w.patients.get(esc.id)
    if (!patient) return
    this.c = esc
    this.patient = patient
    this.moveTo(this.meetSpot(patient))
    this.state = 'toPatient'
  }
}

// ---------------------------------------------------------------------------------------------

type DoctorState = 'idle' | 'toBay' | 'examining' | 'charting' | 'returning'

/**
 * ER doctor. Wave 1: two kinds of visit at a bay: the assessment (10-20 min) of a patient whose nurse has finished, and the review (3-7 min) of
 * a patient whose results are in, where the admission is decided. The most urgent assessments come first, then reviews (they free a bay), then
 * the other assessments.
 */
export class ErDoctor extends Staff {
  private state: DoctorState = 'idle'
  private c: ErCase | null = null
  private patient: ErPatient | null = null
  private timer = 0
  private elapsed = 0
  private visitSeconds = 0
  private kind: 'exam' | 'review' = 'exam'

  constructor(world: World, staff: StaffMember, readonly index: number, walker: Walker, rng: Rng) {
    super(world, staff, 'doctor', ER_DOCTOR_POSTS[index], walker, rng)
  }

  think(dt: number, _ctx: PeopleContext): void {
    this.tickRetire(dt, this.state === 'idle' && this.done)
    switch (this.state) {
      case 'idle':
        this.entity.anim = 'idle'
        if (this.due(dt) && !this.retiring) this.takeNext()
        break
      case 'toBay':
        if (this.done) {
          const p = this.patient!
          this.entity.anim = 'talk'
          this.faceTowards({ x: p.baySeat!.x, z: p.baySeat!.z })
          if (this.kind === 'exam') {
            p.doctorHere()
            this.visitSeconds = p.examSeconds
          } else {
            p.reviewHere()
            this.visitSeconds = p.reviewSeconds
          }
          this.elapsed = 0
          this.showEmote('tablet', this.world.t, this.visitSeconds)
          this.state = 'examining'
        }
        break
      case 'examining':
        this.elapsed += dt
        this.entity.anim = this.elapsed < this.visitSeconds * 0.55 ? 'talk' : 'tablet'
        if (this.c!.state !== (this.kind === 'exam' ? 'inBay.exam' : 'inBay.review')) {
          this.c = null
          this.patient = null
          this.timer = this.srng.between(CONFIG.er.chartSeconds)
          this.entity.anim = 'tablet'
          this.state = 'charting'
        }
        break
      case 'charting':
        this.timer -= dt
        if (this.timer <= 0) {
          this.entity.emote = 'none'
          this.moveTo(this.post.at, { face: this.post.heading })
          this.state = 'returning'
        }
        break
      case 'returning':
        if (this.due(dt) && !this.retiring) this.takeNext()
        if (this.state === 'returning' && this.done) {
          this.stand(this.post.heading)
          this.state = 'idle'
        }
        break
    }
  }

  override get atRest(): boolean {
    return this.state === 'idle' && this.done
  }

  private takeNext(): void {
    const er = this.world.er
    let kind: 'exam' | 'review' = 'exam'
    let c = er.claimExam(this.staff.id, 2)
    if (!c) {
      c = er.claimReview(this.staff.id)
      kind = 'review'
    }
    if (!c) {
      c = er.claimExam(this.staff.id)
      kind = 'exam'
    }
    if (!c) return
    const patient = this.world.patients.get(c.id)
    const seat = patient?.baySeat
    if (!patient || !seat) {
      c.doctorId = null
      return
    }
    this.kind = kind
    this.c = c
    this.patient = patient
    this.moveTo(seatSpot(seat, 'doctor'))
    this.state = 'toBay'
  }

  /** S1: this doctor is already part-way through an assessment or a review of `patient` (placed at the bedside). */
  warmVisit(patient: ErPatient, kind: 'exam' | 'review', progress: number): void {
    const seat = patient.baySeat
    if (!seat) return
    const spot = seatSpot(seat, 'doctor')
    this.kind = kind
    this.c = patient.c
    this.patient = patient
    patient.c.doctorId = this.staff.id
    this.placeAt(spot.x, spot.z, headingTo(spot, seat))
    this.visitSeconds = kind === 'exam' ? patient.examSeconds : patient.reviewSeconds
    this.elapsed = progress * this.visitSeconds
    this.entity.anim = 'talk'
    this.state = 'examining'
  }
}
