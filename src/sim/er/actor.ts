/**
 * Actor: the movement layer shared by every M3 person (patients, companions, ER staff, porters, cleaners, paramedics,
 * visitors, ambient people). A controller thinks in whole commands and polls `done`:
 *
 *   moveTo(spot)      walk the nav graph (optionally trailing a leader), then stand there
 *   sitOn(seat)       walk to the seat's approach spot, then slide onto it (pose sit / lie)
 *   standUp()         slide off the seat to its approach spot
 *   slideTo(...)      a short, eased glide (seat <-> approach, bed <-> wheelchair): nobody pops
 *   mountOn / dismount  get on or off a wheelchair / stretcher a pusher holds
 *
 * Modes: static (standing or seated), walk (the walker steps), slide (placed along a short line), ride (placed by
 * the world 0.8 m ahead of the pusher every step). `entity.seated`, `anim`, `vehicle` and `riding` follow the mode,
 * as the contract in types.ts describes. Allocation-free in the per-step path.
 */
import { CONFIG } from '../config'
import { newEntity, Person, type PeopleContext } from '../person'
import { groundHeightAt, VEHICLE_AHEAD } from '../places'
import type { AnimState, Entity, Outfit, Role, SeatSpec, Vec2, VehicleKind } from '../types'
import { makeWalker, type Walker } from '../walker'
import { headingTo, standHeading } from './spots'

export type Mode = 'static' | 'walk' | 'slide' | 'ride'
type SlideEnd = 'seat' | 'stand' | 'ride' | 'none'

/** A scanner table that carries the person lying on it: the body is placed at lerp(out, in, state.tablePos) every step. */
export interface TableRef {
  out: Vec2
  in: Vec2
  heading: number
  state: { tablePos: number }
}

const TAU = Math.PI * 2
/** A rider is carried by the pusher, so the crowd should not see a second body 0.8 m ahead of them. */
const RIDER_RADIUS = 0.05
const BODY_RADIUS = 0.25
/** A person pushing a wheelchair, stretcher or cart takes up more room. */
const PUSHER_RADIUS: Record<VehicleKind, number> = { none: BODY_RADIUS, wheelchair: 0.4, stretcher: 0.45, cleaningCart: 0.38, linenCart: 0.38 }


function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  else if (d < -Math.PI) d += TAU
  return a + d * t
}

/** Smooth start and stop. */
function ease(k: number): number {
  return k * k * (3 - 2 * k)
}

export abstract class Actor extends Person {
  mode: Mode = 'static'
  /** True once the last command has finished. Commands set it false. */
  done = true
  /** Walking speed (m/s), set per person for variety. */
  cruise: number = CONFIG.people.walkSpeed
  /** The seat the person is sitting or lying on (snapped), or null. */
  seat: SeatSpec | null = null
  /** The pusher this person rides with, or null. */
  pusher: Actor | null = null
  /** The person this one pushes in a wheelchair or on a stretcher, or null. */
  rider: Actor | null = null
  /** How a rider gets a crowd walker back when it gets off (set by whoever creates riders). */
  crowdWalker: ((id: string) => Walker) | null = null
  /** The scanner table this person lies on (MRI / CT: it slides in and out), or null. */
  private table: TableRef | null = null
  private tableK = Number.NaN
  private solo = false
  /** Anim while walking and standing; pushers use 'push'. */
  walkAnim: AnimState = 'walk'
  idleAnim: AnimState = 'idle'

  // walking
  private dest: Vec2 = { x: 0, z: 0 }
  private destHeading: number | null = null
  private sitTarget: SeatSpec | null = null
  private leader: Actor | null = null
  // sliding
  private sx = 0
  private sz = 0
  private sh = 0
  private tx = 0
  private tz = 0
  private th = 0
  private sk = 0
  private sd = 1
  private slideEnd: SlideEnd = 'none'
  private slideSeat: SeatSpec | null = null
  // polling
  private pollAcc: number

  constructor(
    id: string,
    role: Role,
    name: string,
    at: Vec2,
    heading: number,
    walker: Walker,
    outfit: Outfit = 'role',
  ) {
    super(newEntity(id, role, name, at, heading, outfit), walker)
    this.pollAcc = (this.entity.variant / 1000) * CONFIG.er.pollSeconds
    // a little variety in how briskly people walk
    this.cruise = CONFIG.people.walkSpeed * (0.9 + (this.entity.variant % 21) / 100)
  }

  get x(): number {
    return this.walker.x
  }
  get z(): number {
    return this.walker.z
  }
  get pos(): Vec2 {
    return { x: this.walker.x, z: this.walker.z }
  }

  /** True every `every` seconds (staggered per person) so job boards are not polled 60 times a second. */
  protected due(dt: number, every: number = CONFIG.er.pollSeconds): boolean {
    this.pollAcc += dt
    if (this.pollAcc < every) return false
    this.pollAcc -= every
    return true
  }

  abstract think(dt: number, ctx: PeopleContext): void

  update(dt: number, ctx: PeopleContext): void {
    this.tickEmote(ctx)
    this.stepMotion(dt, ctx)
    this.think(dt, ctx)
    // W1: somebody in a conversation or a greeting speaks (the controller above may have put an idle pose back)
    if (this.mode === 'static' && this.wantsTalkPose(ctx.t)) this.talkPose()
  }

  // --- commands --------------------------------------------------------------------------------------

  /** Walk to `dest` and stand there, optionally facing `face` and trailing `leader` (an escort). */
  moveTo(dest: Vec2, o: { speed?: number; face?: number | null; leader?: Actor | null } = {}): void {
    this.releaseSeatBody()
    this.dest.x = dest.x
    this.dest.z = dest.z
    this.destHeading = o.face ?? null
    this.sitTarget = null
    this.leader = o.leader ?? null
    if (o.speed !== undefined) this.cruise = o.speed
    this.walker.goTo(dest)
    this.mode = 'walk'
    this.done = false
    this.entity.anim = this.walkAnim
  }

  /** Walk to the seat's approach spot, then slide onto the seat. */
  sitOn(seat: SeatSpec, o: { speed?: number; leader?: Actor | null } = {}): void {
    this.moveTo(seat.approach, o)
    this.sitTarget = seat
  }

  /** Show an emote until sim time `until` (default: until it is replaced). */
  protected showEmote(e: Entity['emote'], now: number, seconds = Infinity): void {
    this.entity.emote = e
    this.emoteUntil = now + seconds
  }

  /** Already on a vehicle the pusher holds (an ambulance patient arriving): no glide. */
  startRiding(pusher: Actor, kind: 'wheelchair' | 'stretcher'): void {
    this.releaseSeatBody()
    this.leaveCrowd()
    this.pusher = pusher
    this.entity.vehicle = kind
    this.entity.riding = true
    this.entity.anim = kind === 'stretcher' ? 'lie' : 'sit'
    this.mode = 'ride'
    this.done = true
  }

  /** Lying on a scanner table: from now on the body travels with it (call after the patient is on the seat). */
  rideTable(ref: TableRef): void {
    this.table = ref
    this.tableK = Number.NaN
  }

  /** Slide off the seat to its approach spot, facing away from it. */
  standUp(): void {
    const seat = this.seat
    if (!seat) {
      this.done = true
      return
    }
    this.releaseSeatBody()
    this.entity.anim = this.idleAnim
    this.slideTo(seat.approach.x, seat.approach.z, standHeading(seat), CONFIG.transfer.seatSeconds, 'stand', null, seat.x, seat.z, seat.heading)
  }

  /** Stand still where you are, facing a heading. */
  stand(face?: number): void {
    this.releaseSeatBody()
    this.mode = 'static'
    this.done = true
    this.entity.speed = 0
    this.entity.anim = this.idleAnim
    if (face !== undefined) this.walker.face(face)
  }

  /** Put somebody at a place and heading without walking (spawn, seat snap), standing still. */
  placeAt(x: number, z: number, heading: number): void {
    this.walker.place(x, z, heading)
    this.entity.position.x = x
    this.entity.position.z = z
    this.entity.heading = heading
    this.prevX = x
    this.prevZ = z
    this.prevHeading = heading
    this.mode = 'static'
    this.done = true
  }

  /** Spawn already sitting or lying on a seat (the first moments of the day). */
  placeOnSeat(seat: SeatSpec): void {
    this.placeAt(seat.x, seat.z, seat.heading)
    this.seat = seat
    this.entity.seated = { seatId: seat.id, pose: seat.pose }
    this.entity.anim = seat.pose === 'lie' ? 'lie' : 'sit'
    this.entity.position.y = groundHeightAt(seat.x, seat.z)
  }

  /** A glide from where the body is to (x, z, heading). */
  slideTo(x: number, z: number, heading: number, seconds: number, end: SlideEnd, seat: SeatSpec | null = null, fromX?: number, fromZ?: number, fromH?: number): void {
    this.sx = fromX ?? this.walker.x
    this.sz = fromZ ?? this.walker.z
    this.sh = fromH ?? this.walker.heading
    this.tx = x
    this.tz = z
    this.th = heading
    this.sk = 0
    this.sd = Math.max(0.05, seconds)
    this.slideEnd = end
    this.slideSeat = seat
    this.mode = 'slide'
    this.done = false
    this.entity.speed = 0
  }

  /** Get on a wheelchair or stretcher that `pusher` holds: glide to the spot 0.8 m ahead of them. */
  mountOn(pusher: Actor, kind: Exclude<VehicleKind, 'none' | 'cleaningCart' | 'linenCart'>): void {
    this.releaseSeatBody()
    this.leaveCrowd()
    this.pusher = pusher
    this.entity.vehicle = kind
    this.entity.riding = true
    this.entity.anim = kind === 'stretcher' ? 'lie' : 'sit'
    const ahead = VEHICLE_AHEAD[kind]
    const h = pusher.walker.heading
    this.slideTo(pusher.walker.x + Math.sin(h) * ahead, pusher.walker.z + Math.cos(h) * ahead, h, CONFIG.transfer.vehicleSeconds, 'ride')
  }

  /** Get off the vehicle: glide to (x, z), then sit on the seat (if any) or just stand. */
  dismount(x: number, z: number, heading: number, seat: SeatSpec | null): void {
    this.rejoinCrowd()
    this.pusher = null
    this.entity.vehicle = 'none'
    this.entity.riding = false
    if (seat) this.entity.anim = seat.pose === 'lie' ? 'lie' : 'sit'
    else this.entity.anim = this.idleAnim
    this.slideTo(x, z, heading, CONFIG.transfer.vehicleSeconds, seat ? 'seat' : 'none', seat)
  }

  /**
   * A rider is carried by the pusher: it must not be a second body 0.8 m in front of them (the crowd would make the
   * pusher stop short of it). So the rider steps out of the crowd onto a solo walker, and back in when it gets off.
   */
  private leaveCrowd(): void {
    if (this.solo) return
    const old = this.walker
    const solo = makeWalker(undefined, { id: this.entity.id })
    solo.place(old.x, old.z, old.heading)
    old.remove()
    this.walker = solo
    this.solo = true
  }

  private rejoinCrowd(): void {
    if (!this.solo || this.crowdWalker === null) return
    const old = this.walker
    const w = this.crowdWalker(this.entity.id)
    w.place(old.x, old.z, old.heading)
    w.setRadius?.(RIDER_RADIUS)
    this.walker = w
    this.solo = false
  }

  // --- per-step motion -------------------------------------------------------------------------------

  private releaseSeatBody(): void {
    if (this.entity.seated) this.entity.seated = undefined
    this.seat = null
    this.table = null
  }

  private followSpeed(): number {
    const l = this.leader
    if (l === null || l.mode !== 'walk') return this.cruise
    const d = Math.hypot(l.walker.x - this.walker.x, l.walker.z - this.walker.z)
    const v = l.walker.speed + (d - 1.3) * 1.2
    return v < 0 ? 0 : v > this.cruise * 1.6 ? this.cruise * 1.6 : v
  }

  private stepMotion(dt: number, ctx: PeopleContext): void {
    const e = this.entity
    switch (this.mode) {
      case 'walk': {
        // (stepWalker honours the W1 talk hold and courtesy pace; without a player it is exactly walker.step)
        const st = this.stepWalker(dt, ctx, this.leader ? this.followSpeed() : this.cruise)
        e.speed = this.walker.speed
        if (st === 'arrived') this.arrive()
        else if (st === 'held') {
          // stopped for the player: the talking pose, unless the hands are full (pushing, carrying)
          const a = this.walkAnim === 'walk' && this.walker.speed < 0.3 ? 'talk' : this.walkAnim
          if (e.anim !== a) e.anim = a
        } else if (e.anim !== this.walkAnim) e.anim = this.walkAnim
        break
      }
      case 'slide': {
        this.sk += dt / this.sd
        const done = this.sk >= 1
        const k = done ? 1 : ease(this.sk)
        this.walker.place(
          this.sx + (this.tx - this.sx) * k,
          this.sz + (this.tz - this.sz) * k,
          lerpAngle(this.sh, this.th, k),
        )
        e.speed = 0
        if (done) this.finishSlide()
        break
      }
      case 'ride':
      case 'static':
        e.speed = 0
        if (this.table !== null) {
          const tb = this.table
          const k = tb.state.tablePos
          if (k !== this.tableK) {
            this.tableK = k
            this.walker.place(tb.out.x + (tb.in.x - tb.out.x) * k, tb.out.z + (tb.in.z - tb.out.z) * k, tb.heading)
          }
        }
        break
    }
  }

  private arrive(): void {
    this.leader = null
    if (this.destHeading !== null) this.walker.face(this.destHeading)
    const seat = this.sitTarget
    if (seat) {
      this.sitTarget = null
      this.entity.anim = seat.pose === 'lie' ? 'lie' : 'sit'
      this.slideTo(seat.x, seat.z, seat.heading, CONFIG.transfer.seatSeconds, 'seat', seat)
      return
    }
    this.mode = 'static'
    this.done = true
    this.entity.speed = 0
    this.entity.anim = this.idleAnim
  }

  private finishSlide(): void {
    const e = this.entity
    switch (this.slideEnd) {
      case 'seat': {
        const seat = this.slideSeat!
        this.walker.setRadius?.(BODY_RADIUS)
        this.seat = seat
        e.seated = { seatId: seat.id, pose: seat.pose }
        e.anim = seat.pose === 'lie' ? 'lie' : 'sit'
        this.mode = 'static'
        break
      }
      case 'stand':
        this.mode = 'static'
        e.anim = this.idleAnim
        break
      case 'ride':
        this.mode = 'ride'
        break
      case 'none':
        this.walker.setRadius?.(BODY_RADIUS)
        this.mode = 'static'
        break
    }
    this.slideSeat = null
    this.done = true
  }

  /** Hold or put down a cart or vehicle: the body takes up more room while pushing it. */
  setVehicle(kind: VehicleKind): void {
    this.entity.vehicle = kind
    this.walker.setRadius?.(PUSHER_RADIUS[kind])
  }

  /** For a pusher: look at a spot (a bed, a chair) without moving. */
  faceTowards(p: Vec2): void {
    this.walker.face(headingTo(this.pos, p))
  }
}
