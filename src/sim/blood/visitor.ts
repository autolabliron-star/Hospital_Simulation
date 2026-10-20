/**
 * A booked blood-test outpatient (and the presenter's demo patient): arrives at the entrance, walks through the imaging hall into the draw
 * centre, checks in at the ticket kiosk (a queue number: P for booked patients, V for patients aged 80 and over), waits on the bench (or
 * stands in the imaging hall when it is full), is called to a robot, sits in the robot's chair with the arm in the cradle, and after the
 * release walks out by the entrance.
 *
 *   fade -> queueing -> serving -> toBench -> waiting -> toChair -> (the station's script) -> leaving -> gone
 *
 * The demo patient skips the check-in and the bench: it appears at the door already called.
 */
import { CONFIG } from '../config'
import { Actor } from '../er/actor'
import type { World } from '../er/world'
import type { PeopleContext } from '../people'
import { DEPARTURES, DRAW_CENTRE, type Spot } from '../places'
import type { Rng } from '../rng'
import type { LabOrder, SeatSpec, Vec2 } from '../types'
import type { Walker } from '../walker'
import type { DrawSubject } from './subject'

type State = 'fade' | 'queueing' | 'serving' | 'toBench' | 'waiting' | 'toChair' | 'seated' | 'leaving' | 'gone'

/** The one check-in kiosk at the door: one person at the machine, the rest line up behind (further south in the room). */
export class CheckInLine {
  private readonly members: string[] = []
  /** Somebody is at the machine now. */
  busy = false

  get length(): number {
    return this.members.length
  }
  /** The place for index `i`: 0 is in front of the kiosk, the rest stand 0.8 m apart behind it. */
  spot(i: number): Spot {
    const g = DRAW_CENTRE.checkIn.guest
    return { at: { x: g.at.x, z: g.at.z + 0.8 * i }, heading: g.heading }
  }
  /** Join at the back; the index in line, or -1 when the line is as long as the kiosk's capacity. */
  join(id: string): number {
    const i = this.members.indexOf(id)
    if (i >= 0) return i
    if (this.members.length >= DRAW_CENTRE.checkIn.capacity) return -1
    this.members.push(id)
    return this.members.length - 1
  }
  leave(id: string): void {
    const i = this.members.indexOf(id)
    if (i >= 0) this.members.splice(i, 1)
  }
  indexOf(id: string): number {
    return this.members.indexOf(id)
  }
}

/** What a visitor needs from the draw centre (index.ts implements it). */
export interface VisitorServices {
  readonly world: World
  readonly line: CheckInLine
  /** The check-in is done: the draw centre issues the ticket, the lab order and the prep job. */
  checkedIn(v: BloodOutpatient): void
  /** A bench seat for `who` (a registry seat, or one made from the anchors), or null when the bench is full. */
  claimBench(who: string): SeatSpec | null
  releaseBench(who: string): void
  /** A standing spot in the imaging hall when the bench is full. */
  claimOverflow(who: string): Vec2
  releaseOverflow(who: string): void
  /** Told once the person has left the simulation. */
  gone(v: BloodOutpatient): void
}

export class BloodOutpatient extends Actor implements DrawSubject {
  state: State = 'fade'
  /** The lab order's panel and the ticket class are decided at check-in from this age. */
  panel = ''
  /** Sim time of each milestone (tests read them). */
  arrivedAt = 0
  checkedInAt = -1
  seatedAt = -1
  releasedAt = -1
  /** True once they have started the walk out. */
  home = false
  private timer = 0
  private retry = 0
  private lineIdx = -2
  private serving = false
  private standing = false
  private called: SeatSpec | null = null
  private chair: SeatSpec | null = null
  private pending: SeatSpec | null = null
  private leaveStep: 'none' | 'standing' | 'walking' | 'fading' = 'none'

  constructor(
    private readonly svc: VisitorServices,
    id: string,
    name: string,
    readonly age: number,
    at: Vec2,
    heading: number,
    walker: Walker,
    private readonly orng: Rng,
    readonly demo: boolean,
  ) {
    super(id, 'patient', name, at, heading, walker, 'everyday')
    this.entity.mood = 'neutral'
    this.cruise = CONFIG.er.walkSpeed * (0.9 + (this.entity.variant % 20) / 100)
    this.arrivedAt = svc.world.t
  }

  get actor(): Actor {
    return this
  }
  get id(): string {
    return this.entity.id
  }
  get name(): string {
    return this.entity.name
  }

  // --- the draw station's side (DrawSubject) -----------------------------------------------------------------------

  drawCalled(_station: number, seat: SeatSpec): void {
    this.called = seat
    this.svc.releaseBench(this.id)
    this.releaseStanding()
    this.entity.emote = 'none'
  }

  seatedOn(seat: SeatSpec): boolean {
    return this.seat === seat && this.mode === 'static' && this.done
  }

  offChair(seat: SeatSpec): boolean {
    return this.seat !== seat
  }

  armIn(on: boolean): void {
    if (this.seat === null) return
    this.entity.anim = on ? 'armIn' : 'sit'
  }

  drawNearlyDone(): void {}

  drawReleased(): void {
    this.releasedAt = this.svc.world.t
    this.entity.mood = 'happy'
    this.showEmote('check', this.svc.world.t, 8)
    this.beginLeaving()
  }

  drawAborted(): void {
    this.called = null
    this.chair = null
    this.pending = null
    this.beginLeaving()
  }

  resultsReady(_order: LabOrder): void {}

  /** S1 in-flight warm: already checked in, called and sitting in the robot's chair (the station takes it from here). */
  warmSeat(seat: SeatSpec, checkedInAt: number, seatedAt: number): void {
    this.placeOnSeat(seat)
    this.called = seat
    this.chair = seat
    this.pending = null
    this.checkedInAt = checkedInAt
    this.seatedAt = seatedAt
    this.state = 'seated'
    this.entity.mood = 'neutral'
    this.entity.emote = 'none'
  }

  // --- per step ------------------------------------------------------------------------------------------------------

  think(dt: number, _ctx: PeopleContext): void {
    const w = this.svc.world
    switch (this.state) {
      case 'fade':
        if (!this.visibleFully) break
        this.arrivedAt = w.t
        if (this.demo) {
          this.state = 'waiting'
          this.entity.mood = 'waiting'
          break
        }
        this.entity.mood = 'waiting'
        this.showEmote('question', w.t)
        this.state = 'queueing'
        this.joinLine()
        break
      case 'queueing':
        this.thinkLine(dt)
        break
      case 'serving':
        this.timer -= dt
        if (this.timer <= 0) {
          this.leaveLine()
          this.checkedInAt = w.t
          this.entity.mood = 'waiting'
          this.showEmote('hourglass', w.t)
          this.svc.checkedIn(this)
          this.seekBench()
          this.state = 'toBench'
        }
        break
      case 'toBench':
        if (this.called !== null) {
          this.state = 'waiting'
          break
        }
        if (this.done) this.state = 'waiting'
        break
      case 'waiting':
        if (this.called !== null) {
          this.goToChair()
          break
        }
        // a standing patient keeps looking for a seat on the bench
        if (this.standing && this.done) {
          this.retry += dt
          if (this.retry >= 2) {
            this.retry = 0
            const seat = this.svc.claimBench(this.id)
            if (seat) {
              this.releaseStanding()
              this.sitOn(seat)
              this.state = 'toBench'
            }
          }
        }
        break
      case 'toChair':
        if (this.pending !== null && this.done) {
          // got up from the bench: now to the chair
          const seat = this.pending
          this.pending = null
          this.sitOn(seat)
          break
        }
        if (this.chair !== null && this.seat === this.chair && this.done && this.mode === 'static') {
          this.seatedAt = w.t
          this.state = 'seated'
        }
        break
      case 'seated':
        break
      case 'leaving':
        this.thinkLeaving()
        break
      case 'gone':
        break
    }
  }

  private goToChair(): void {
    const seat = this.called!
    this.chair = seat
    this.state = 'toChair'
    if (this.seat !== null) {
      // up off the bench first (never a pop), then to the chair
      this.pending = seat
      this.standUp()
    } else {
      this.pending = null
      this.sitOn(seat)
    }
  }

  // --- check-in -------------------------------------------------------------------------------------------------------

  private joinLine(): void {
    const idx = this.svc.line.join(this.id)
    if (idx < 0) {
      // the kiosk's line is full: wait in the imaging hall and try again
      this.lineIdx = -2
      if (!this.standing) {
        this.standing = true
        this.moveTo(this.svc.claimOverflow(this.id), { face: Math.PI })
      }
      return
    }
    this.releaseStanding()
    this.lineIdx = idx
    const s = this.svc.line.spot(idx)
    this.moveTo(s.at, { face: s.heading })
  }

  private leaveLine(): void {
    this.svc.line.leave(this.id)
    if (this.serving) this.svc.line.busy = false
    this.serving = false
  }

  private thinkLine(dt: number): void {
    const line = this.svc.line
    const idx = line.indexOf(this.id)
    if (idx < 0) {
      // not in the line yet (it was full): retry now and then
      this.retry += dt
      if (this.retry >= 1.5) {
        this.retry = 0
        this.joinLine()
      }
      return
    }
    if (idx !== this.lineIdx) {
      this.lineIdx = idx
      const s = line.spot(idx)
      this.moveTo(s.at, { face: s.heading })
      return
    }
    if (idx === 0 && this.done && !line.busy) {
      line.busy = true
      this.serving = true
      this.timer = this.orng.between(CONFIG.blood.checkInSeconds)
      this.entity.anim = 'finger'
      this.state = 'serving'
    }
  }

  // --- the bench ------------------------------------------------------------------------------------------------------

  private seekBench(): void {
    this.entity.anim = this.idleAnim
    const seat = this.svc.claimBench(this.id)
    if (seat) {
      this.sitOn(seat)
      return
    }
    // the bench is full: stand in the imaging hall by the door
    this.standing = true
    this.moveTo(this.svc.claimOverflow(this.id), { face: Math.PI })
  }

  private releaseStanding(): void {
    if (this.standing) {
      this.svc.releaseOverflow(this.id)
      this.standing = false
    }
  }

  // --- going home -----------------------------------------------------------------------------------------------------

  private beginLeaving(): void {
    this.state = 'leaving'
    this.home = true
    this.cruise = Math.max(this.cruise, CONFIG.er.walkSpeed)
    if (this.seat) {
      this.entity.anim = 'sit'
      this.leaveStep = 'standing'
      this.standUp()
    } else {
      this.leaveStep = 'walking'
      this.moveTo(DEPARTURES.entrance)
    }
  }

  private thinkLeaving(): void {
    if (this.leaveStep === 'standing' && this.done) {
      this.leaveStep = 'walking'
      this.moveTo(DEPARTURES.entrance)
    } else if (this.leaveStep === 'walking' && this.done && !this.fadingOut) {
      this.leaveStep = 'fading'
      this.state = 'gone'
      this.fadeOut()
    }
  }

  override onRemoved(world: World): void {
    this.leaveLine()
    this.svc.releaseBench(this.id)
    this.releaseStanding()
    world.seats.releaseBy(this.id)
    world.releaseName(this.name)
    this.svc.gone(this)
  }
}

/** Seeded age of a booked outpatient (adults, a little weighted to the middle years; some are 80 or older). */
export function drawAge(rng: Rng): number {
  return Math.round(rng.clampedGaussian(57, 17, 18, 93))
}

