/**
 * R2: the people of the surgery suite. All are `Actor`s (er/actor.ts: moveTo, sitOn, standUp, mount/dismount, fades) with the thinnest
 * behaviour of their own: the case (case.ts) and the team (team.ts) tell them where to be, they get there.
 *
 *   SurgicalPatient   walks in from the entrance and checks in at the reception desk like any outpatient (the only thinking it does itself),
 *                     then is driven by its case: onto a stretcher, onto the OR table, a recovery bed, a lounge recliner
 *   SurgeryCompanion  comes with the patient, follows them to the lift, then waits where its case sends it
 *   Staffer           one of THEATRE_STAFF: carries out a `Task` (a spot, a facing, an animation, maybe a seat); the case or the team sets it
 */
import type { StaffMember } from '@/content/staff'
import { CONFIG } from '../config'
import { Actor } from '../er/actor'
import type { QueueLike } from '../er/ports'
import { inDoorway } from '../er/spots'
import type { World } from '../er/world'
import { isWalkable } from '../nav/layout'
import type { PeopleContext } from '../person'
import type { Rng } from '../rng'
import type { AnimState, Outfit, SeatSpec, Vec2 } from '../types'
import type { Walker } from '../walker'

// ---------------------------------------------------------------------------------------------------------------------
// The patient
// ---------------------------------------------------------------------------------------------------------------------

type CheckIn = 'idle' | 'fade' | 'queueing' | 'serving'

export class SurgicalPatient extends Actor {
  /** True once the reception desk has checked them in (the case then sends them to the lift). */
  checkedIn = false
  private check: CheckIn = 'idle'
  private queue: QueueLike | null = null
  private queueIdx = -2
  private timer = 0
  private retry = 0
  private serving = false

  constructor(
    readonly world: World,
    readonly caseId: string,
    name: string,
    at: Vec2,
    heading: number,
    walker: Walker,
    private readonly prng: Rng,
  ) {
    super(`${caseId}-patient`, 'patient', name, at, heading, walker, 'everyday')
    this.crowdWalker = world.walkerFor
    this.cruise = CONFIG.er.walkSpeed * (0.9 + (this.entity.variant % 20) / 100)
    this.entity.mood = 'neutral'
  }

  /** Start the walk to the reception queue (call once they have been added and `fadeIn()` has been called). */
  beginCheckIn(): void {
    this.checkedIn = false
    this.check = 'fade'
  }

  /** On the stretcher the porter holds: a glide onto it, then carried (no second body in the crowd). */
  loadOn(pusher: Actor): void {
    this.world.attach(pusher, this)
    this.mountOn(pusher, 'stretcher')
  }

  /** Off the stretcher onto `seat` (a bed or the table), or onto their feet where they are. */
  unloadTo(seat: SeatSpec | null): void {
    this.world.detach(this)
    if (seat) this.dismount(seat.x, seat.z, seat.heading, seat)
    else this.dismount(this.walker.x, this.walker.z, this.walker.heading, null)
  }

  get mounted(): boolean {
    return this.mode === 'ride' && this.done
  }

  /** Standing, sitting or lying still, off every vehicle. */
  get settled(): boolean {
    return this.mode === 'static' && this.done && this.pusher === null
  }

  think(dt: number, _ctx: PeopleContext): void {
    switch (this.check) {
      case 'idle':
        break
      case 'fade':
        if (this.visibleFully) {
          this.entity.mood = 'waiting'
          this.joinQueue()
          this.check = 'queueing'
        }
        break
      case 'queueing':
        this.thinkQueue(dt)
        break
      case 'serving':
        this.timer -= dt
        if (this.timer <= 0) {
          this.leaveQueue()
          this.entity.mood = 'neutral'
          this.checkedIn = true
          this.check = 'idle'
        }
        break
    }
  }

  // The reception desk (the same line the ER's walk-ins and the outpatients use).

  private joinQueue(): void {
    const q = this.world.reception
    const idx = q.join(this.entity.id)
    if (idx >= 0) {
      this.queue = q
      this.queueIdx = idx
      const spot = q.spotFor(idx)
      this.moveTo(spot.at, { face: spot.heading })
    } else this.queue = null
  }

  private leaveQueue(): void {
    if (this.serving) {
      this.world.serverBusy.reception = false
      this.serving = false
    }
    if (this.queue) {
      this.queue.leave(this.entity.id)
      this.queue = null
    }
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
    const idx = q.indexOf(this.entity.id)
    if (idx < 0) return
    if (idx !== this.queueIdx) {
      this.queueIdx = idx
      const spot = q.spotFor(idx)
      this.moveTo(spot.at, { face: spot.heading })
      return
    }
    if (idx === 0 && this.done && !this.world.serverBusy.reception) {
      this.world.serverBusy.reception = true
      this.serving = true
      this.timer = this.prng.between(CONFIG.er.checkInSeconds)
      this.check = 'serving'
    }
  }

  override onRemoved(world: World): void {
    this.leaveQueue()
    world.detach(this)
    world.seats.releaseBy(this.entity.id)
    world.releaseName(this.entity.name)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The companion
// ---------------------------------------------------------------------------------------------------------------------

export class SurgeryCompanion extends Actor {
  /** While set, they walk after this person (the patient, in the lobby and at check-in). */
  follow: Actor | null = null
  private followAt = 0

  constructor(
    readonly world: World,
    caseId: string,
    name: string,
    at: Vec2,
    heading: number,
    walker: Walker,
    patient: Actor,
  ) {
    super(`${caseId}-companion`, 'visitor', name, at, heading, walker, 'everyday')
    this.crowdWalker = world.walkerFor
    this.cruise = patient.cruise
    this.entity.mood = 'neutral'
  }

  /**
   * Go to a seat (sit on it) or a spot (stand there, facing `face`). A person on a seat stands up first (nobody walks off a sofa through it).
   * Cancels any following.
   */
  sendTo(target: { seat: SeatSpec } | { at: Vec2; face: number }): void {
    this.follow = null
    this.pending = target
    if (this.seat !== null && this.mode === 'static') this.standUp()
  }

  private pending: { seat: SeatSpec } | { at: Vec2; face: number } | null = null

  think(dt: number, _ctx: PeopleContext): void {
    if (this.pending !== null) {
      if (this.mode === 'static' && this.done && this.seat === null) {
        const p = this.pending
        this.pending = null
        if ('seat' in p) this.sitOn(p.seat)
        else this.moveTo(p.at, { face: p.face })
      } else if (this.seat !== null && this.mode === 'static' && this.done) this.standUp()
      return
    }
    if (this.follow === null || this.seat !== null) return
    this.followAt += dt
    if (this.followAt < 0.6) return
    this.followAt = 0
    const p = this.follow
    if (Math.hypot(p.walker.x - this.walker.x, p.walker.z - this.walker.z) <= 1.7) return
    const h = p.walker.heading
    const behind = { x: p.walker.x - Math.sin(h) * 1.0 + Math.cos(h) * 0.6, z: p.walker.z - Math.cos(h) * 1.0 - Math.sin(h) * 0.6 }
    // never aim at a wall, a doorway or furniture: stand where the patient stands if the spot behind is no good
    this.moveTo(isWalkable(behind.x, behind.z, 0.35) && !inDoorway(behind.x, behind.z) ? behind : { x: p.walker.x, z: p.walker.z })
  }

  override onRemoved(world: World): void {
    world.seats.releaseBy(this.entity.id)
    world.releaseName(this.entity.name)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The team
// ---------------------------------------------------------------------------------------------------------------------

/** What a member of the team is doing: be at `at` facing `face`, in animation `anim` (or sit on `seat`, whose approach is `at`). */
export interface Task {
  /** Identifies the task: setting a task with the same key again changes nothing. */
  key: string
  at: Vec2
  face: number
  anim: AnimState
  seat?: SeatSpec | null
  /** The animation while walking there (a porter pushing a stretcher: 'push'). */
  walkAnim?: AnimState
  speed?: number
  leader?: Actor | null
}

export type Title = 'surgeon' | 'assistant' | 'anaesthetist' | 'scrub' | 'circulator' | 'preOp' | 'pacu' | 'porter' | 'cleaner'
  // R4: the cryoablation suite's people (src/sim/cryoSuite), who reuse the Staffer
  | 'ir'
  | 'ctRadiographer'
  | 'sedation'
  | 'wardPorter'

export class Staffer extends Actor {
  /** The case (or '') that has this person for a job; the team's own routine leaves them alone meanwhile. */
  engagedBy: string | null = null
  task: Task | null = null
  private pending: Task | null = null
  private applied: AnimState | null = null
  private readonly baseCruise: number

  constructor(
    readonly world: World,
    readonly staff: StaffMember,
    readonly title: Title,
    at: Vec2,
    heading: number,
    walker: Walker,
    outfit: Outfit,
  ) {
    super(staff.id, staff.role, staff.name, at, heading, walker, outfit)
    this.crowdWalker = world.walkerFor
    this.baseCruise = this.cruise
  }

  /** Is the current task `key`, and has the person got there (standing or sitting still)? */
  isAt(key: string): boolean {
    return this.task !== null && this.task.key === key && this.pending === null && this.done && this.mode === 'static'
  }

  /** Doing something now (walking to a task, or at it). */
  setTask(t: Task): void {
    if (this.task !== null && this.task.key === t.key) return
    this.task = t
    this.applied = null
    this.pending = null
    if (this.mode === 'slide') {
      // mid-slide onto or off a seat: take the new task once it is over
      this.pending = t
      return
    }
    if (this.seat !== null && t.seat === this.seat) {
      // staying on the same seat: only the pose changes
      this.idleAnim = t.anim
      return
    }
    if (this.seat !== null) {
      this.pending = t
      this.standUp()
      return
    }
    this.begin(t)
  }

  /** Put the person at the task's spot (or on its seat) at once: a warm start. */
  settleTask(t: Task): void {
    this.task = t
    this.pending = null
    this.applied = null
    this.walkAnim = t.walkAnim ?? 'walk'
    this.idleAnim = t.anim
    this.stand()
    if (t.seat) this.placeOnSeat(t.seat)
    else this.placeAt(t.at.x, t.at.z, t.face)
    this.entity.anim = t.anim
  }

  private begin(t: Task): void {
    this.walkAnim = t.walkAnim ?? 'walk'
    this.idleAnim = t.anim
    const opts = { speed: t.speed ?? this.baseCruise, leader: t.leader ?? null }
    if (t.seat) this.sitOn(t.seat, opts)
    else this.moveTo(t.at, { ...opts, face: t.face })
  }

  think(_dt: number, _ctx: PeopleContext): void {
    if (this.pending !== null) {
      if (this.mode === 'static' && this.done) {
        const p = this.pending
        if (this.seat !== null && p.seat !== this.seat) {
          this.standUp()
          return
        }
        this.pending = null
        this.begin(p)
      }
      return
    }
    const t = this.task
    if (t === null || !this.done || this.mode !== 'static') return
    // (arriving puts the idle pose back, a seat puts 'sit': switch to the task's pose, unless a conversation with you has taken over)
    const e = this.entity
    if (e.anim !== t.anim && (e.anim === 'idle' || e.anim === 'sit' || e.anim === this.applied)) {
      e.anim = t.anim
      this.applied = t.anim
    }
  }
}
