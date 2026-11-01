/**
 * R5 wave 3: short hops inside the CT room. The people nav graph (src/sim/nav) has no node inside this room's floor, so a step of a few metres from one
 * spot to another is planned round the whole room: the radiologist's hop between the robot's guide and the table's north side (0.39 m apart) was routed
 * 3.8 m through the scan-room door, and the radiographer's from the table's south side to its foot (1.8 m apart) 6.6 m round the south lattice. Changing
 * the graph would move every other route in the hospital (the ER's timings and goldens among them), so the cryo team fixes it locally: when the straight
 * line between a person and the place the script sends them to is clear (walkable along its whole length, the nav layout's exact segment test), or
 * clear in two legs round one corner (the table's foot end), they walk that line instead of the planned route.
 *
 *   `hopRoute`    the direct route from a to b inside the scan room: [a, b], or [a, corner, b] when the straight line is blocked, or null (plan it)
 *   `HopWalker`   a `Walker` that wraps a person's own (crowd) walker: `goTo` takes a hop when the team allows it (`allow`, set only around the script's own
 *                 tasks, never the stretcher's pushes) and the way is clear of the others (the team's own people, and every body in the crowd: the porter,
 *                 a stretcher's discs, a visitor, you); every other call is the wrapped walker's. While a hop is walked the wrapped walker is kept at the
 *                 body's place every step (`place`), so the crowd still sees the person and the position is one. It says which crowd walker it wraps
 *                 (`crowdWalker`), so you can still make a person of the team step aside (src/sim/reactions.ts).
 *
 * R5 wave 3, fix round 3: the same wrapper drives a person along the stretcher's lane (lane.ts), forwards or backwards, and turns them on the spot slowly
 * (the stretcher swinging round its pusher at about a radian a second, not at the walker's turn rate). `armLane` / `armTurn` say what the NEXT `goTo` does
 * (the task's own walk: the Actor's walk mode, its arrival and its pose are all as for any other walk); the drive looks ahead along the stretcher's footprint
 * for another body of the crowd (a visitor, a vehicle) and waits for it to pass, for at most `GATE_WAIT` s, then goes on regardless.
 *
 * Allocation: a hop makes its route array once, when the walk begins (a task change); the per-step path allocates nothing, a drive allocates nothing at all.
 */
import { CrowdWalker } from '../nav/crowd'
import { PathFollower } from '../nav/follower'
import { segmentWalkable } from '../nav/layout'
import { areaById, VEHICLE_AHEAD, VEHICLE_HALF } from '../places'
import type { Vec2 } from '../types'
import type { Walker, WalkStatus } from '../walker'
import type { LanePose, PoseLane } from './lane'

/** The clearance (m) the hop's legs keep from walls and furniture: the margin the suite's own spots are chosen at (sites.ts `CLEAR`). */
export const HOP_MARGIN = 0.3
/** How close (m) a hop may pass another person of the team: two bodies (0.25 m each). */
export const HOP_PEOPLE = 0.5
/** The room (m) a hop leaves between its body's edge and any other body in the crowd (`CrowdWalker.bodyNear`). */
export const HOP_GAP = 0.05

/** A drive speeds up at this rate (m/s^2), slows down at this one, and never crawls slower than `DRIVE_CREEP` while there is lane left (m/s). */
const DRIVE_ACCEL = 1.0
const DRIVE_DECEL = 1.2
const DRIVE_CREEP = 0.1
/** A drive that has waited this long (s) for somebody to clear its way goes on, and ignores the others for `GATE_GHOST` s (no jam can last). */
export const GATE_WAIT = 4
const GATE_GHOST = 2.5
/** How far ahead (m) of the stretcher's pose, beyond the braking distance, a drive looks for another body. */
const LOOK_EXTRA = 0.3
/** A turn on the spot eases in and out over this fraction of its length (so the stretcher does not start swinging at full rate). */
const TURN_EASE = 0.25

const STRETCHER_AHEAD = VEHICLE_AHEAD.stretcher
const STRETCHER_HL = VEHICLE_HALF.stretcher[1]

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** The scan room's floor (the area `l2Cryo`): hops stay inside it. */
const ROOM = areaById('l2Cryo').rect

/** Is the point inside the scan room, a body's clearance in from its walls? */
export function inScanRoom(x: number, z: number): boolean {
  return x >= ROOM.x0 + HOP_MARGIN && x <= ROOM.x1 - HOP_MARGIN && z >= ROOM.z0 + HOP_MARGIN && z <= ROOM.z1 - HOP_MARGIN
}

const clear = (ax: number, az: number, bx: number, bz: number): boolean => segmentWalkable(ax, az, bx, bz, HOP_MARGIN)

/**
 * The direct route from `a` to `b` when both are inside the scan room: `[a, b]` when the straight line is clear, else `[a, corner, b]` through the
 * nearer of the two corners of the rectangle they span when both of its legs are clear, else null (the graph plans the walk). Allocates the route.
 */
export function hopRoute(a: Vec2, b: Vec2): Vec2[] | null {
  if (!inScanRoom(a.x, a.z) || !inScanRoom(b.x, b.z)) return null
  if (clear(a.x, a.z, b.x, b.z)) return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }]
  // (the legs of an L round the table's foot end, or round the robot's corner)
  const c1 = { x: a.x, z: b.z }
  const c2 = { x: b.x, z: a.z }
  const ok1 = clear(a.x, a.z, c1.x, c1.z) && clear(c1.x, c1.z, b.x, b.z)
  const ok2 = clear(a.x, a.z, c2.x, c2.z) && clear(c2.x, c2.z, b.x, b.z)
  if (!ok1 && !ok2) return null
  // (the two corners give the same length: the leg lengths swap; take the first that is clear)
  const c = ok1 ? c1 : c2
  return [{ x: a.x, z: a.z }, c, { x: b.x, z: b.z }]
}

/** Distance from point p to the segment a-b. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  let u = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0
  u = u < 0 ? 0 : u > 1 ? 1 : u
  return Math.hypot(ax + dx * u - px, az + dz * u - pz)
}

/** Is somebody else in the way of the route (the team knows who stands where)? */
export type HopBlocked = (route: readonly Vec2[]) => boolean

/** A walker that takes a clear short hop in the scan room directly and does everything else through the walker it wraps. */
export class HopWalker implements Walker {
  /** The team sets this only while it gives a person a script task: a hop is then allowed (the stretcher's pushes and every other call are planned). */
  allow = false
  /** Hops this walker has taken (tests). */
  hops = 0
  private readonly f = new PathFollower()
  private hopping = false
  /** The crowd walker that is wrapped (null: a solo walker: only the team's own people are looked for). */
  private readonly crowd: CrowdWalker | null
  // --- the lane drive and the turn (fix round 3) ---
  /** What the next `goTo` begins: a drive along `lane` from `armFrom` to `armTo` (arc length), or a turn to `armHeading` (`armSign`: 1 left, -1 right). */
  private armedLane: PoseLane | null = null
  private armedTurn = false
  private armFrom = 0
  private armTo = 0
  private armHeading = 0
  private armSign: -1 | 0 | 1 = 1
  private armRate = 1
  /** A drive in progress: 1 on the lane, 2 turning on the spot, 0 none. */
  private drive: 0 | 1 | 2 = 0
  private lane: PoseLane | null = null
  private laneAt = 0
  private laneEnd = 0
  private laneV = 0
  private turnFrom = 0
  private turnTotal = 0
  private turnDone = 0
  private turnRate = 1
  private driveHold = 0
  private ghost = 0
  /** Scratch poses (the drive allocates nothing). */
  private readonly pose: LanePose = { x: 0, z: 0, heading: 0 }
  private readonly ahead: LanePose = { x: 0, z: 0, heading: 0 }
  /** While set, the wrapped walker's arrival does not snap the heading to the task's (the crowd's walk to the lane's stage: the case turns the stretcher on the spot, slowly, after it). */
  ignoreFace = false
  /** Seconds this walker's drives have waited for somebody (tests), and how many times one went on regardless. */
  waited = 0
  ghosted = 0

  constructor(
    private readonly inner: Walker,
    private readonly blocked: HopBlocked,
  ) {
    this.crowd = inner instanceof CrowdWalker ? inner : null
  }

  /** The wrapped crowd walker, so the courtesy sidestep (src/sim/reactions.ts) reaches it. */
  get crowdWalker(): CrowdWalker | null {
    return this.crowd
  }

  get x(): number {
    return this.inner.x
  }
  get z(): number {
    return this.inner.z
  }
  get heading(): number {
    return this.hopping ? this.f.heading : this.inner.heading
  }
  get speed(): number {
    return this.drive === 1 ? this.laneV : this.hopping ? this.f.speed : this.inner.speed
  }
  /** Is a hop being walked now? */
  get isHopping(): boolean {
    return this.hopping
  }

  /** Is a lane drive or a turn on the spot under way? */
  get isDriving(): boolean {
    return this.drive !== 0
  }

  /** Where on its lane (arc length, m) the drive is now, or last was. */
  get laneProgress(): number {
    return this.laneAt
  }

  /**
   * The next `goTo` drives along `lane` from arc length `from` to `to` (more or less: forwards or backwards) instead of planning a walk; the person is put
   * at `from` first if they are not within 15 cm of it. The task's destination is the pose at `to`.
   */
  armLane(lane: PoseLane, from: number, to: number): void {
    this.armedLane = lane
    this.armedTurn = false
    this.armFrom = from
    this.armTo = to
  }

  /**
   * The next `goTo` turns the person on the spot to `heading` at about `rate` rad/s, the way round given by `sign` (1: increasing heading, a left turn; -1:
   * a right turn; 0: the shorter way). The stretcher in front of them swings round with them.
   */
  armTurn(heading: number, rate: number, sign: -1 | 0 | 1): void {
    this.armedTurn = true
    this.armedLane = null
    this.armHeading = heading
    this.armRate = rate
    this.armSign = sign
  }

  goTo(to: Vec2): void {
    if (this.armedLane !== null) {
      this.beginLane(this.armedLane, this.armFrom, this.armTo)
      this.armedLane = null
      return
    }
    if (this.armedTurn) {
      this.beginTurn(this.armHeading, this.armRate, this.armSign)
      this.armedTurn = false
      return
    }
    this.drive = 0
    if (this.allow) {
      const here = { x: this.inner.x, z: this.inner.z }
      const route = hopRoute(here, to)
      if (route !== null && !this.blocked(route) && !this.bodyOnRoute(route)) {
        this.f.reset(here.x, here.z, this.inner.heading)
        this.f.speed = this.inner.speed
        this.f.setPath(route)
        this.hopping = true
        this.hops++
        return
      }
    }
    this.hopping = false
    this.inner.goTo(to)
  }

  /** Is any other body of the crowd (not only the team: the porter and a stretcher, a visitor, the player) within reach of the hop's route? */
  private bodyOnRoute(route: readonly Vec2[]): boolean {
    const cw = this.crowd
    if (cw === null) return false
    for (let i = 1; i < route.length; i++) if (cw.bodyNear(route[i - 1].x, route[i - 1].z, route[i].x, route[i].z, HOP_GAP)) return true
    return false
  }

  place(x: number, z: number, heading: number): void {
    this.hopping = false
    this.drive = 0
    this.armedLane = null
    this.armedTurn = false
    this.inner.place(x, z, heading)
  }

  face(heading: number): void {
    if (this.ignoreFace) return
    if (this.hopping) this.f.heading = heading
    this.inner.face(heading)
  }

  // --- the lane drive and the turn ---------------------------------------------------------------------------------------

  private beginLane(lane: PoseLane, from: number, to: number): void {
    this.hopping = false
    this.lane = lane
    this.laneAt = from
    this.laneEnd = to
    this.laneV = 0
    this.driveHold = 0
    this.ghost = 0
    this.drive = 1
    lane.poseAt(from, this.pose)
    // (the wrapped walker is put on the lane at once if it is not there: a drive begins where the lane says)
    if (Math.hypot(this.inner.x - this.pose.x, this.inner.z - this.pose.z) > 0.15) this.inner.place(this.pose.x, this.pose.z, this.pose.heading)
  }

  private beginTurn(heading: number, rate: number, sign: -1 | 0 | 1): void {
    this.hopping = false
    this.drive = 2
    this.turnFrom = this.inner.heading
    const d = wrapPi(heading - this.turnFrom)
    // (1: the angle in the increasing direction, in [0, 2 pi); -1: in the decreasing direction, in (-2 pi, 0]; 0: the shorter)
    this.turnTotal = sign === 0 ? d : sign > 0 ? (d < 0 ? d + 2 * Math.PI : d) : d > 0 ? d - 2 * Math.PI : d
    this.turnDone = 0
    this.turnRate = Math.max(0.1, rate)
  }

  /** Is another body of the crowd on the stretcher's footprint at lane position `s`, or on the pusher's way to it? */
  private laneBlocked(s: number, fromS: number): boolean {
    const cw = this.crowd
    const lane = this.lane
    if (cw === null || lane === null) return false
    lane.poseAt(s, this.ahead)
    const a = this.ahead
    const sx = Math.sin(a.heading)
    const cz = Math.cos(a.heading)
    // (the footprint's axis: the pusher's own body counts as the crowd's radius in `bodyNear`, 0.45 m, the stretcher's half width and a body's radius with it)
    const nx = a.x + sx * (STRETCHER_AHEAD - STRETCHER_HL)
    const nz = a.z + cz * (STRETCHER_AHEAD - STRETCHER_HL)
    const fx = a.x + sx * (STRETCHER_AHEAD + STRETCHER_HL)
    const fz = a.z + cz * (STRETCHER_AHEAD + STRETCHER_HL)
    if (cw.bodyNear(nx, nz, fx, fz, 0)) return true
    // the pusher's own way: from where he is to where he will be
    return cw.bodyNear(this.inner.x, this.inner.z, a.x, a.z, 0) && fromS !== s
  }

  private stepLane(dt: number, cruise: number): WalkStatus {
    const lane = this.lane!
    const dir = this.laneEnd >= this.laneAt ? 1 : -1
    const left = Math.abs(this.laneEnd - this.laneAt)
    // the speed this tick: eased up to the cruise, and down for the end of the lane
    let v = this.laneV
    const brake = Math.sqrt(2 * DRIVE_DECEL * left) + DRIVE_CREEP
    const want = cruise < brake ? cruise : brake
    if (v < want) {
      v += DRIVE_ACCEL * dt
      if (v > want) v = want
    } else {
      v -= DRIVE_DECEL * dt
      if (v < want) v = want
    }
    // somebody in the way (the footprint a little ahead of the braking distance): wait, then go on regardless
    if (this.ghost > 0) this.ghost -= dt
    else if (left > 1e-3) {
      const look = v * v / (2 * DRIVE_DECEL) + LOOK_EXTRA + v * dt
      const ahead = Math.min(look, left)
      if (this.laneBlocked(this.laneAt + dir * ahead, this.laneAt)) {
        this.driveHold += dt
        this.waited += dt
        v = Math.max(0, this.laneV - DRIVE_DECEL * dt)
        if (this.driveHold >= GATE_WAIT) {
          this.driveHold = 0
          this.ghost = GATE_GHOST
          this.ghosted++
        } else if (v <= 0) {
          this.laneV = 0
          return 'waiting'
        }
      } else this.driveHold = 0
    }
    let move = v * dt
    if (move < DRIVE_CREEP * dt && left > 1e-3) move = Math.min(left, DRIVE_CREEP * dt)
    if (move >= left - 1e-6) {
      this.laneAt = this.laneEnd
      lane.poseAt(this.laneAt, this.pose)
      this.inner.place(this.pose.x, this.pose.z, this.pose.heading)
      this.laneV = 0
      this.drive = 0
      return 'arrived'
    }
    this.laneAt += dir * move
    this.laneV = v
    lane.poseAt(this.laneAt, this.pose)
    this.inner.place(this.pose.x, this.pose.z, this.pose.heading)
    return 'moving'
  }

  private stepTurn(dt: number): WalkStatus {
    const total = this.turnTotal
    const len = Math.abs(total)
    const dir = total >= 0 ? 1 : -1
    // an eased rate: slow at the start and the end of the turn
    const done = this.turnDone
    const edge = Math.min(done, len - done)
    const ease = edge >= len * TURN_EASE || len < 1e-6 ? 1 : 0.25 + 0.75 * (edge / (len * TURN_EASE))
    this.turnDone = Math.min(len, done + this.turnRate * ease * dt)
    const h = wrapPi(this.turnFrom + dir * this.turnDone)
    this.inner.place(this.inner.x, this.inner.z, h)
    if (this.turnDone >= len - 1e-9) {
      this.drive = 0
      return 'arrived'
    }
    return 'moving'
  }

  step(dt: number, speed: number): WalkStatus {
    if (this.drive === 1) return this.stepLane(dt, speed)
    if (this.drive === 2) return this.stepTurn(dt)
    if (!this.hopping) return this.inner.step(dt, speed)
    const st = this.f.step(dt, speed)
    // the wrapped walker is where the body is: the crowd and every reader of the position see one person
    this.inner.place(this.f.x, this.f.z, this.f.heading)
    if (st === 'arrived') this.hopping = false
    return st
  }

  remove(): void {
    this.inner.remove()
  }

  setStatic(on: boolean): void {
    this.inner.setStatic(on)
  }

  setRadius(radius: number): void {
    this.inner.setRadius?.(radius)
  }

  setFootprint(f: { ahead: number; halfWidth: number; halfLength: number } | null): void {
    this.inner.setFootprint?.(f)
  }
}

