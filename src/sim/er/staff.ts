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
import { callSpot, ER_DOCTOR_POSTS, ER_NURSE_POSTS, seatSpot, TRIAGE_NURSE_BAYS, TRIAGE_NURSE_POSTS, type Post } from './spots'
import type { World } from './world'

type StaffRole = 'receptionist' | 'nurse' | 'doctor'

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

type ErNurseState = 'idle' | 'toPatient' | 'calling' | 'escorting' | 'atBay' | 'toHandover' | 'handover' | 'returning'

export class ErNurse extends Staff {
  private state: ErNurseState = 'idle'
  private c: ErCase | null = null
  private patient: ErPatient | null = null
  private timer = 0

  constructor(world: World, staff: StaffMember, readonly index: number, walker: Walker, rng: Rng) {
    super(world, staff, 'nurse', ER_NURSE_POSTS[index], walker, rng)
  }

  think(dt: number, _ctx: PeopleContext): void {
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
          const seat = this.patient!.baySeat!
          this.patient!.followTo(this, seat)
          this.moveTo(seatSpot(seat, 'nurse'), { face: Math.atan2(seat.x - seat.approach.x, seat.z - seat.approach.z) })
          this.state = 'escorting'
        }
        break
      }
      case 'escorting':
        if (this.done && this.c!.onTrolley) {
          this.entity.anim = 'tablet'
          this.timer = 5
          this.state = 'atBay'
        }
        break
      case 'atBay':
        this.timer -= dt
        if (this.timer <= 0) this.goBack()
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
          this.goBack()
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

  private goBack(): void {
    this.c = null
    this.patient = null
    this.moveTo(this.post.at, { face: this.post.heading })
    this.state = 'returning'
  }

  /** A handover first (the paramedics are waiting), then the next walk-in whose bay is ready. */
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
    const esc = w.er.claimEscort(this.staff.id)
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

export class ErDoctor extends Staff {
  private state: DoctorState = 'idle'
  private c: ErCase | null = null
  private patient: ErPatient | null = null
  private timer = 0
  private elapsed = 0
  private examSeconds = 0

  constructor(world: World, staff: StaffMember, readonly index: number, walker: Walker, rng: Rng) {
    super(world, staff, 'doctor', ER_DOCTOR_POSTS[index], walker, rng)
  }

  think(dt: number, _ctx: PeopleContext): void {
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
          p.doctorHere()
          this.examSeconds = p.examSeconds
          this.elapsed = 0
          this.showEmote('tablet', this.world.t, this.examSeconds)
          this.state = 'examining'
        }
        break
      case 'examining':
        this.elapsed += dt
        this.entity.anim = this.elapsed < this.examSeconds * 0.55 ? 'talk' : 'tablet'
        if (this.c!.state !== 'inBay.exam') {
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
    const c = this.world.er.claimExam(this.staff.id)
    if (!c) return
    const patient = this.world.patients.get(c.id)
    const seat = patient?.baySeat
    if (!patient || !seat) {
      c.doctorId = null
      return
    }
    this.c = c
    this.patient = patient
    this.moveTo(seatSpot(seat, 'doctor'))
    this.state = 'toBay'
  }
}
