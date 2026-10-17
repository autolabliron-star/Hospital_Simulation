/**
 * Crowd movement: how a hundred people share the floor. This is layer 3 of the living-world skill, adapted to our
 * kinematic path follower (no physics, no yuka vehicles): every walker still follows its planned polyline exactly with a
 * `PathFollower`; the crowd only decides where the BODY stands relative to that path and how fast the path is walked.
 *
 *   body = path point + keep-right offset + avoidance displacement
 *
 * Keep right. A walker on a corridor takes a personal lateral offset of 0.30-0.45 m to the right of its direction of travel
 * (in open halls 0.45-0.9 m), so people walking in opposite directions pass each other. The offset is capped wherever it
 * would not be walkable (walls and furniture; W2: the whole corridor is walkable, there are no robot lanes or crossing zones on
 * the floor), and it fades to nothing at the end of the route and in doorways. The offset is rate-limited (0.9 m/s), so turns at
 * corners are smooth.
 *
 * Courtesy (W1 walk-in). `setCourtesy(side, metres)` biases that keep-right target sideways by `metres` more, to the right
 * (+1) or to the left (-1) of the path, so a walker who sees the player coming moves over to one side of the corridor well
 * before they meet (and `courtesyPick` says which side clears a given body best). It uses exactly the caps of the keep-right
 * offset (walls and furniture) and the same 0.9 m/s rate, and it applies only
 * where keep-right does (along a corridor, in halls) plus the other open areas, never in a doorway, never within reach of a
 * single-file door, and it fades out at the end of the route. Nothing changes for a walker that never gets a courtesy.
 *
 * Local avoidance. A uniform-grid spatial hash is rebuilt once per sim step (`beginStep`, from a snapshot of every walker, so
 * the result never depends on the order people are stepped in). Each walker then:
 *   - is pushed away from bodies closer than ~0.7 m (static people push with full strength, movers with half each);
 *   - slows down behind a slower walker going the same way (it never passes through them), and stops short of a
 *     standing or seated person who is in its way, stepping round them to the side with more room first;
 *   - gives way at a single-file door (1.7 m or less): the walker who is inside the door, or nearer to it, goes first and the
 *     one coming the other way waits outside the door width (after 5 s it goes anyway, so no door can deadlock);
 *   - is finally clamped: never overlapping a body by more than 1.5 cm, and always back onto walkable ground
 *     (`nearestWalkable`), so nobody is pushed into a wall or furniture.
 * A walker blocked for 4 s ignores the others for 2.5 s (last resort: no jam can last).
 *
 * Cost: allocation-free in `step`; all state is in typed arrays and fields. See crowd.test.ts for the measured cost.
 */
import { DOORS } from '../places'
import { hashString } from '../rng'
import type { Vec2, WardId } from '../types'
import type { WalkStatus, Walker, WalkerOptions } from '../walker'
import { PathFollower } from './follower'
import { planRoute } from './graph'
import { inCorridorBand, isWalkable, nearestWalkable, zoneAt } from './layout'

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

/** Body radius of an ordinary person (m). */
export const BODY_RADIUS = 0.25
/** Clearance of the body centre from walls and furniture. */
const BODY_MARGIN = 0.25
/** Bodies may overlap by at most this much (m) after the hard correction. */
const HARD_SLACK = 0.015
/**
 * A step that would bring a body closer than this to another (their radii sum, less this; and closer than it was) is not
 * taken. 4.5 cm leaves room for the tests' 5 cm and for the other walker's own move in the same step.
 */
const VETO_SLACK = 0.045
/** Soft personal space beyond touching (m): bodies closer than radius sum + this are pushed apart. */
const COMFORT = 0.2
/** Only neighbours within this distance are looked at (m). */
const INTERACT = 1.6
/** How far ahead a walker looks for something in its way (m). */
const LOOK = 1.7
/** Push gain (m/s of avoidance velocity per metre of overlap). */
const PUSH_GAIN = 2.2
/** The avoidance displacement relaxes back to zero at this rate (1/s) and is never larger than this (m). */
const S_DECAY = 2.0
const S_MAX = 0.9
/** The keep-right offset moves at most this fast (m/s). */
const LAT_RATE = 0.9
/** The most a courtesy sidestep may add to the keep-right offset (m). */
export const COURTESY_MAX = 0.6
/** The planned braking deceleration used for stopping short of things (m/s^2). */
const BRAKE = 1.2
/** A courtesy sidestep with less room than this on its side is not made (m). */
const MIN_COURTESY = 0.1
/** The offset target is re-evaluated every this many steps (staggered per walker). */
const RECOMPUTE = 6
/** An offset that is smaller than this when the route ends is dropped at once; a larger one is relaxed at SETTLE_RATE (m/s). */
const SETTLE_SNAP = 0.04
const SETTLE_RATE = 1.5
/** Giving up settling onto a spot that a neighbour makes unreachable cleanly (s). */
const SETTLE_MAX = 1.5
/** A walker blocked this long ignores the others for GHOST_TIME. */
const BLOCKED_AFTER = 4
const GHOST_TIME = 2.5
/** A walker yielding at a door this long goes through anyway for DOOR_GRACE. */
const YIELD_AFTER = 5
const DOOR_GRACE = 3

// the hash grid
const CELL = 1.5
const GX0 = -66
const GZ0 = -26
const COLS = 72
const ROWS = 35

const MAX_NEIGHBOURS = 24

// ---------------------------------------------------------------------------------------------
// Static data: single-file doors, halls
// ---------------------------------------------------------------------------------------------

/** A door only one person fits through at a time (width under 1.8 m): walkers going opposite ways take turns. */
interface Gate {
  cx: number
  cz: number
  /** Unit vectors along the way through the door and across it. */
  axX: number
  axZ: number
  acX: number
  acZ: number
  hw: number
}

const GATE_HALF = 0.8
const GATE_APPROACH = 2.4

const GATES: Gate[] = DOORS.filter((d) => d.width < 1.8 && d.kind !== 'counter').map((d) => {
  const alongZ = d.wallAxis === 'x' // the wall runs along x, so walkers pass along z
  return { cx: d.center.x, cz: d.center.z, axX: alongZ ? 0 : 1, axZ: alongZ ? 1 : 0, acX: alongZ ? 1 : 0, acZ: alongZ ? 0 : 1, hw: d.width / 2 }
})

/** Areas big enough to keep right in with a wider offset. */
const HALLS = new Set<string>(['lobby', 'triage', 'er', 'atrium', 'diagnostics', 'spine', 'command'])

function brakeSpeed(distance: number): number {
  return distance > 0 ? Math.sqrt(2 * BRAKE * distance) : 0
}

const TMP: Vec2 = { x: 0, z: 0 }

/** May a body stand at (x, z)? On walkable ground: clear of walls and furniture (the whole corridor is open to people). */
function placeOk(x: number, z: number): boolean {
  return isWalkable(x, z, BODY_MARGIN)
}

// ---------------------------------------------------------------------------------------------
// The crowd
// ---------------------------------------------------------------------------------------------

export class Crowd {
  /** Bumped by every `beginStep`. */
  seq = 0
  /** Slots ever used (a freed slot is reused). */
  count = 0
  /**
   * Diagnostics: how often the last-resort "blocked for 4 s, ignore the others" rule has fired. Tests watch it (a jam that needs it
   * is a jam the avoidance did not solve); `onBlockedFallback`, if set, is told where (the body position).
   */
  blockedFallbacks = 0
  onBlockedFallback: ((x: number, z: number) => void) | null = null

  // per-slot state (struct of arrays)
  private cap = 0
  /** Live body position and velocity (written by each walker), and the snapshot taken by `beginStep` (what others read). */
  px = new Float64Array(0)
  pz = new Float64Array(0)
  vx = new Float64Array(0)
  vz = new Float64Array(0)
  sx = new Float64Array(0)
  sz = new Float64Array(0)
  svx = new Float64Array(0)
  svz = new Float64Array(0)
  rad = new Float64Array(0)
  act = new Uint8Array(0)
  stat = new Uint8Array(0)
  sstat = new Uint8Array(0)
  /** Single-file door negotiation: the door a walker is heading through (-1: none), its direction, and its priority key. */
  gDoor = new Int16Array(0)
  gSign = new Int8Array(0)
  gKey = new Float64Array(0)
  private cellOf = new Int32Array(0)
  private cellItems = new Int32Array(0)
  private walkers: (CrowdWalker | null)[] = []
  private readonly freeSlots: number[] = []

  readonly cellStart = new Int32Array(COLS * ROWS + 1)
  private readonly cellFill = new Int32Array(COLS * ROWS)
  readonly bestPos = new Float64Array(GATES.length)
  readonly bestNeg = new Float64Array(GATES.length)

  constructor() {
    this.grow(64)
  }

  /** A walker that shares this crowd. `makeWalker(crowd)` does this. */
  createWalker(opts: WalkerOptions = {}): CrowdWalker {
    return new CrowdWalker(this, opts)
  }

  /** Walkers currently registered. */
  get size(): number {
    return this.count - this.freeSlots.length
  }

  /** Walker in a slot (for tests and debugging). */
  walkerAt(slot: number): CrowdWalker | null {
    return this.walkers[slot] ?? null
  }

  register(w: CrowdWalker, x: number, z: number, radius: number): number {
    let slot: number
    if (this.freeSlots.length > 0) slot = this.freeSlots.pop()!
    else {
      slot = this.count++
      if (slot >= this.cap) this.grow(this.cap * 2)
    }
    this.walkers[slot] = w
    this.act[slot] = 1
    this.stat[slot] = 1
    this.sstat[slot] = 1
    this.px[slot] = this.sx[slot] = x
    this.pz[slot] = this.sz[slot] = z
    this.vx[slot] = this.vz[slot] = this.svx[slot] = this.svz[slot] = 0
    this.rad[slot] = radius
    this.gDoor[slot] = -1
    this.cellOf[slot] = -1
    return slot
  }

  unregister(slot: number): void {
    if (!this.act[slot]) return
    this.act[slot] = 0
    this.gDoor[slot] = -1
    this.walkers[slot] = null
    this.freeSlots.push(slot)
  }

  private grow(cap: number): void {
    const f64 = (a: Float64Array) => {
      const n = new Float64Array(cap)
      n.set(a)
      return n
    }
    const u8 = (a: Uint8Array) => {
      const n = new Uint8Array(cap)
      n.set(a)
      return n
    }
    this.px = f64(this.px)
    this.pz = f64(this.pz)
    this.vx = f64(this.vx)
    this.vz = f64(this.vz)
    this.sx = f64(this.sx)
    this.sz = f64(this.sz)
    this.svx = f64(this.svx)
    this.svz = f64(this.svz)
    this.rad = f64(this.rad)
    this.gKey = f64(this.gKey)
    this.act = u8(this.act)
    this.stat = u8(this.stat)
    this.sstat = u8(this.sstat)
    const g = new Int16Array(cap).fill(-1)
    g.set(this.gDoor)
    this.gDoor = g
    const s = new Int8Array(cap)
    s.set(this.gSign)
    this.gSign = s
    const c = new Int32Array(cap).fill(-1)
    c.set(this.cellOf)
    this.cellOf = c
    this.cellItems = new Int32Array(cap)
    this.cap = cap
  }

  /**
   * Rebuild the spatial hash from a snapshot of every registered walker. Call once per sim step before the people update:
   * everyone then reads the same picture of the floor, whatever order they are stepped in. (If it is never called, walkers
   * notice the start of a new step themselves, because the same walker is stepped twice within one snapshot.)
   */
  beginStep(): void {
    this.seq++
    const n = this.count
    const start = this.cellStart
    start.fill(0)
    for (let i = 0; i < n; i++) {
      if (!this.act[i]) {
        this.cellOf[i] = -1
        continue
      }
      this.sx[i] = this.px[i]
      this.sz[i] = this.pz[i]
      this.svx[i] = this.vx[i]
      this.svz[i] = this.vz[i]
      this.sstat[i] = this.stat[i]
      const c = cellIndex(this.sx[i], this.sz[i])
      this.cellOf[i] = c
      start[c + 1]++
    }
    for (let c = 0; c < COLS * ROWS; c++) start[c + 1] += start[c]
    for (let c = 0; c < COLS * ROWS; c++) this.cellFill[c] = start[c]
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i]
      if (c >= 0) this.cellItems[this.cellFill[c]++] = i
    }
    // who is heading through each single-file door, and the best (lowest) priority key per direction
    this.bestPos.fill(Infinity)
    this.bestNeg.fill(Infinity)
    for (let i = 0; i < n; i++) {
      const g = this.gDoor[i]
      if (!this.act[i] || g < 0) continue
      if (this.gSign[i] > 0) {
        if (this.gKey[i] < this.bestPos[g]) this.bestPos[g] = this.gKey[i]
      } else if (this.gKey[i] < this.bestNeg[g]) this.bestNeg[g] = this.gKey[i]
    }
  }

  /** Items of a hash cell, for `CrowdWalker.scan`. */
  get items(): Int32Array {
    return this.cellItems
  }
}

function cellIndex(x: number, z: number): number {
  let cx = Math.floor((x - GX0) / CELL)
  let cz = Math.floor((z - GZ0) / CELL)
  if (cx < 0) cx = 0
  else if (cx >= COLS) cx = COLS - 1
  if (cz < 0) cz = 0
  else if (cz >= ROWS) cz = ROWS - 1
  return cz * COLS + cx
}

// ---------------------------------------------------------------------------------------------
// One walker
// ---------------------------------------------------------------------------------------------

export class CrowdWalker implements Walker {
  private crowd: Crowd | null
  readonly slot: number
  private readonly f = new PathFollower()
  private readonly here: Vec2 = { x: 0, z: 0 }

  // the body
  private bx = 0
  private bz = 0
  /** Keep-right offset (vector) and the avoidance displacement. */
  private lx = 0
  private lz = 0
  private ax = 0
  private az = 0
  /** Their candidate values for this step, committed when the step succeeds. */
  private nlx = 0
  private nlz = 0
  private nax = 0
  private naz = 0

  // personal
  private readonly pref: number
  private readonly prefHall: number
  private readonly gait: number
  private radius: number
  private forcedStatic = false

  // per-step scratch
  private dirX = 0
  private dirZ = 1
  private tgtLat = 0
  /** The courtesy sidestep (W1): +1 right, -1 left, 0 none; the extra metres it adds; whether the target currently uses it. */
  private courtSide: -1 | 0 | 1 = 0
  private courtMetres = 0
  private courtOn = false
  private countdown: number
  private seqSeen = -1
  private clock = 0
  private pushX = 0
  private pushZ = 0
  private vLim = 1e9
  private nbN = 0
  private readonly nb = new Int32Array(MAX_NEIGHBOURS)
  private blockedT = 0
  private settleT = 0
  private ghostUntil = -1
  /** The obstacle being walked round and which side (+1: right) was chosen, kept until it is behind (no dithering). */
  private sideObs = -1
  private sideDir = 1
  private sideSeen = false
  /** ... and whether it is standing (then keep-right is dropped while going round: the whole width is needed). */
  private sideStill = false

  // single-file door
  private gate = -1
  private gateSign = 1
  private yieldT = 0
  private ignoreGateUntil = -1

  constructor(crowd: Crowd, opts: WalkerOptions = {}) {
    this.crowd = crowd
    this.radius = opts.radius ?? BODY_RADIUS
    this.slot = crowd.register(this, 0, 0, this.radius)
    const key = opts.id ?? `walker${this.slot}`
    const h1 = hashString(key)
    const h2 = hashString(`${key}#2`)
    this.pref = 0.3 + 0.15 * ((h1 & 0xffff) / 65536)
    this.prefHall = 0.45 + 0.45 * (((h1 >>> 16) & 0xffff) / 65536)
    this.gait = 0.95 + 0.1 * ((h2 & 0xffff) / 65536)
    this.countdown = 1 + (this.slot % RECOMPUTE)
  }

  // --- Walker interface ---------------------------------------------------------------------

  get x(): number {
    return this.bx
  }
  get z(): number {
    return this.bz
  }
  get heading(): number {
    return this.f.heading
  }
  get speed(): number {
    return this.f.speed
  }
  /** Where the planned path stands (the body is this plus the offsets). */
  get pathX(): number {
    return this.f.x
  }
  get pathZ(): number {
    return this.f.z
  }

  goTo(to: Vec2): void {
    this.here.x = this.bx
    this.here.z = this.bz
    // the route starts at the body; the path point joins it, so nothing jumps
    this.f.x = this.bx
    this.f.z = this.bz
    this.lx = this.lz = this.ax = this.az = 0
    this.f.setPath(planRoute(this.here, to))
    this.forcedStatic = false
    this.gate = -1
    this.countdown = 1
    this.blockedT = 0
    this.yieldT = 0
    this.publish()
  }

  place(x: number, z: number, heading: number): void {
    this.f.reset(x, z, heading)
    this.bx = x
    this.bz = z
    this.lx = this.lz = this.ax = this.az = 0
    this.gate = -1
    this.blockedT = 0
    this.yieldT = 0
    this.publish()
  }

  face(heading: number): void {
    this.f.heading = heading
  }

  /** Mark a standing or seated person as a fixed obstacle (a walker with no route is one anyway). `goTo` clears it. */
  setStatic(on: boolean): void {
    this.forcedStatic = on
    this.publish()
  }

  setRadius(r: number): void {
    this.radius = r
    if (this.crowd) this.crowd.rad[this.slot] = r
  }

  /** Leave the crowd (a person who walks out of the building). The walker keeps working on its own. */
  remove(): void {
    if (!this.crowd) return
    this.crowd.unregister(this.slot)
    this.crowd = null
    this.gate = -1
    // from here on the path point is the body
    this.f.x = this.bx
    this.f.z = this.bz
    this.lx = this.lz = this.ax = this.az = 0
  }

  step(dt: number, speed: number): WalkStatus {
    const crowd = this.crowd
    if (crowd === null) {
      // left the crowd: the plain follower, with the body following the path point
      const st = this.f.step(dt, speed)
      this.bx = this.f.x
      this.bz = this.f.z
      return st
    }
    if (crowd.seq === 0 || this.seqSeen === crowd.seq) crowd.beginStep()
    this.seqSeen = crowd.seq
    this.clock += dt
    const f = this.f
    if (!f.active) return this.settle(dt)

    // direction of travel
    const tx = f.targetX - f.x
    const tz = f.targetZ - f.z
    const len = Math.sqrt(tx * tx + tz * tz)
    if (len > 1e-6) {
      this.dirX = tx / len
      this.dirZ = tz / len
    }
    if (--this.countdown <= 0) {
      this.countdown = RECOMPUTE
      this.recompute()
    }
    const dirX = this.dirX
    const dirZ = this.dirZ
    const rem = f.remaining

    // the others
    this.vLim = 1e9
    this.pushX = 0
    this.pushZ = 0
    this.nbN = 0
    this.sideSeen = false
    this.sideStill = false
    const ghost = this.clock < this.ghostUntil
    this.scan(crowd, dirX, dirZ, rem, ghost)
    if (!this.sideSeen) this.sideObs = -1
    this.doorNegotiation(crowd, f.x, f.z)

    // keep right: the offset vector chases its target at a limited rate (so a corner turns it smoothly)
    // (a courtesy sidestep is kept while going round somebody standing: it is what makes room)
    const target = this.sideStill && !this.courtOn ? 0 : rem < 1.5 ? this.tgtLat * (rem / 1.5) : this.tgtLat
    const goalX = -dirZ * target
    const goalZ = dirX * target
    const ex = goalX - this.lx
    const ez = goalZ - this.lz
    const el = Math.sqrt(ex * ex + ez * ez)
    const maxMove = LAT_RATE * dt
    if (el <= maxMove) {
      this.nlx = goalX
      this.nlz = goalZ
    } else {
      this.nlx = this.lx + (ex / el) * maxMove
      this.nlz = this.lz + (ez / el) * maxMove
    }


    // avoidance displacement: pushed, then relaxing back
    let nax = this.ax + this.pushX * dt
    let naz = this.az + this.pushZ * dt
    // (while stepping round someone it does not relax: the push alone decides how far to go)
    const relax = this.sideSeen ? 0 : Math.min(1, S_DECAY * dt)
    nax -= nax * relax
    naz -= naz * relax
    const sl = Math.sqrt(nax * nax + naz * naz)
    if (sl > S_MAX) {
      nax *= S_MAX / sl
      naz *= S_MAX / sl
    }
    this.nax = nax
    this.naz = naz

    // how fast the path may be walked
    let cruise = speed * this.gait
    if (this.vLim < cruise) cruise = this.vLim
    if (speed > 0 && this.vLim < 0.05) {
      this.blockedT += dt
      if (this.blockedT > BLOCKED_AFTER) {
        this.ghostUntil = this.clock + GHOST_TIME
        this.blockedT = 0
        crowd.blockedFallbacks++
        crowd.onBlockedFallback?.(this.bx, this.bz)
      }
    } else this.blockedT = Math.max(0, this.blockedT - dt)

    const oldX = this.bx
    const oldZ = this.bz
    f.save()
    const st = f.step(dt, cruise)
    const olx = this.lx
    const olz = this.lz
    const oax = this.ax
    const oaz = this.az
    this.lx = this.nlx
    this.lz = this.nlz
    this.ax = this.nax
    this.az = this.naz
    this.constrain()
    if (this.wouldCrowd(crowd, oldX, oldZ, dt)) {
      // this step would put the body into someone: take it back and stand still (never closer than touching, whatever else)
      f.restore()
      this.lx = olx
      this.lz = olz
      this.ax = oax
      this.az = oaz
      this.bx = oldX
      this.bz = oldZ
      this.blockedT += dt
      if (this.blockedT > BLOCKED_AFTER) {
        this.ghostUntil = this.clock + GHOST_TIME
        this.blockedT = 0
        crowd.blockedFallbacks++
        crowd.onBlockedFallback?.(this.bx, this.bz)
      }
      this.publish()
      return 'waiting'
    }
    this.publish()
    if (st === 'arrived') {
      if (Math.abs(this.lx) + Math.abs(this.lz) + Math.abs(this.ax) + Math.abs(this.az) < SETTLE_SNAP) {
        this.lx = this.lz = this.ax = this.az = 0
        this.bx = f.x
        this.bz = f.z
        this.gate = -1
        this.publish()
        return 'arrived'
      }
      return 'moving'
    }
    return speed > 0 && f.speed < 0.05 && this.vLim < 0.05 ? 'waiting' : 'moving'
  }

  // --- the route is done: relax the offsets, then report arrival ---------------------------------

  private settle(dt: number): WalkStatus {
    const f = this.f
    f.speed = 0
    this.gate = -1
    const n = Math.abs(this.lx) + Math.abs(this.lz) + Math.abs(this.ax) + Math.abs(this.az)
    if (n === 0) {
      this.settleT = 0
      this.publish()
      return 'arrived'
    }
    this.settleT += dt
    if (n < SETTLE_SNAP || this.settleT > SETTLE_MAX) {
      // (after SETTLE_MAX a spot too close to a neighbour to be reached cleanly is taken anyway)
      this.lx = this.lz = this.ax = this.az = 0
      this.settleT = 0
      this.bx = f.x
      this.bz = f.z
      this.publish()
      return 'arrived'
    }
    const k = Math.max(0, 1 - (SETTLE_RATE * dt) / Math.max(Math.hypot(this.lx + this.ax, this.lz + this.az), 1e-6))
    this.lx *= k
    this.lz *= k
    this.ax *= k
    this.az *= k
    this.gather(this.crowd!)
    this.constrain()
    this.publish()
    return 'moving'
  }

  /** The neighbours within reach, for the hard separation (a walker with no route does not run the full scan). */
  private gather(crowd: Crowd): void {
    this.nbN = 0
    const slot = this.slot
    let cx = Math.floor((this.bx - GX0) / CELL)
    let cz = Math.floor((this.bz - GZ0) / CELL)
    if (cx < 0) cx = 0
    else if (cx >= COLS) cx = COLS - 1
    if (cz < 0) cz = 0
    else if (cz >= ROWS) cz = ROWS - 1
    for (let r = Math.max(0, cz - 1); r <= Math.min(ROWS - 1, cz + 1); r++) {
      for (let c = Math.max(0, cx - 1); c <= Math.min(COLS - 1, cx + 1); c++) {
        const cell = r * COLS + c
        for (let k = crowd.cellStart[cell], end = crowd.cellStart[cell + 1]; k < end; k++) {
          const j = crowd.items[k]
          if (j === slot || crowd.act[j] === 0 || this.nbN >= MAX_NEIGHBOURS) continue
          const dx = crowd.sx[j] - this.bx
          const dz = crowd.sz[j] - this.bz
          if (dx * dx + dz * dz <= INTERACT * INTERACT) this.nb[this.nbN++] = j
        }
      }
    }
  }

  // --- cheap periodic work: what offset is allowed here, and is a single-file door ahead --------

  private recompute(): void {
    const f = this.f
    const px = f.x
    const pz = f.z
    const ward = inCorridorBand(px, pz)
    let pref = 0
    if (ward !== null) {
      if (Math.abs(this.dirX) > 0.6) pref = this.pref
    } else {
      const z = zoneAt(px, pz, 0)
      if (z !== null && z.area !== undefined && HALLS.has(z.area)) pref = this.prefHall
    }
    let k = pref
    if (k > 0) {
      const rX = -this.dirZ
      const rZ = this.dirX
      for (let t = 0; t <= 1.5 && k > 0; t += 0.75) k = this.capAt(px + this.dirX * t, pz + this.dirZ * t, rX, rZ, k)
    }
    this.tgtLat = k
    this.findGate()
    this.courtOn = false
    if (this.courtSide !== 0 && this.gate < 0) this.courtesyTarget(ward, pref)
  }

  /**
   * The courtesy sidestep: replace the keep-right target by one `courtMetres` further out, on `courtSide`. Left alone (keep-right
   * as it was) where a sidestep is out of place: crossing a corridor, in a doorway, or where there is no room on that side.
   */
  private courtesyTarget(ward: WardId | null, pref: number): void {
    const f = this.f
    if (ward !== null) {
      if (Math.abs(this.dirX) <= 0.6) return
    } else {
      const z = zoneAt(f.x, f.z, 0)
      if (z === null || z.kind !== 'area') return
    }
    let k = pref + this.courtMetres
    const s = this.courtSide
    const rX = -this.dirZ * s
    const rZ = this.dirX * s
    for (let t = 0; t <= 1.5 && k > 0; t += 0.75) k = this.capAt(f.x + this.dirX * t, f.z + this.dirZ * t, rX, rZ, k)
    if (k < MIN_COURTESY) return
    this.tgtLat = s * k
    this.courtOn = true
  }

  /**
   * Ask this walker to step aside: `side` +1 moves over to the right of its path (where keep-right already sits), -1 to the left,
   * 0 ends it (the keep-right offset comes back). `metres` (0..COURTESY_MAX) is how much further out than keep-right it goes,
   * when there is room: see the module comment. Cheap; call it only when the request changes.
   */
  setCourtesy(side: -1 | 0 | 1, metres = 0): void {
    const m = side === 0 ? 0 : Math.min(COURTESY_MAX, Math.max(0, metres))
    if (side === this.courtSide && m === this.courtMetres) return
    this.courtSide = side
    this.courtMetres = m
    // (a request is acted on at the next step; ending one returns to keep-right at the usual rate)
    this.countdown = 1
  }

  /** The courtesy side now (+1 right, -1 left, 0 none), and how many metres beyond keep-right it asks for. */
  get courtesy(): -1 | 0 | 1 {
    return this.courtSide
  }
  get courtesyMetres(): number {
    return this.courtMetres
  }

  /**
   * Which side should this walker step to, to clear a body standing at (x, z) once it gets there? Looks at where each side's
   * offset could be (caps as for keep-right, at the point of the path next to the body) and takes the side that leaves more
   * room between the two bodies: the right, where everybody already keeps, unless the left is clearly better (more so for a
   * walker that is on the left already: `current`). A tie goes right. Allocation-free.
   */
  courtesyPick(x: number, z: number, metres: number, current: -1 | 0 | 1 = 0): -1 | 1 {
    const f = this.f
    const dx = x - f.x
    const dz = z - f.z
    const dirX = this.dirX
    const dirZ = this.dirZ
    const fwd = dx * dirX + dz * dirZ
    // how far to the right of the path the body stands
    const rp = -dx * dirZ + dz * dirX
    const a = fwd < 0 ? 0 : fwd > f.remaining ? f.remaining : fwd
    const qx = f.x + dirX * a
    const qz = f.z + dirZ * a
    const ward = inCorridorBand(qx, qz)
    let base = 0
    if (ward !== null) {
      if (Math.abs(dirX) > 0.6) base = this.pref
    } else {
      const zn = zoneAt(qx, qz, 0)
      if (zn !== null && zn.area !== undefined && HALLS.has(zn.area)) base = this.prefHall
    }
    const want = base + (metres > COURTESY_MAX ? COURTESY_MAX : metres)
    const roomR = this.capAt(qx, qz, -dirZ, dirX, want)
    const roomL = this.capAt(qx, qz, dirZ, -dirX, want)
    const clearR = Math.abs(roomR - rp)
    const clearL = Math.abs(-roomL - rp)
    return clearL > clearR + (current < 0 ? -0.25 : 0.15) ? -1 : 1
  }

  /** The largest offset (<= kmax, in steps of 5 cm) to the right of the path point (qx, qz) that is allowed there. */
  private capAt(qx: number, qz: number, rX: number, rZ: number, kmax: number): number {
    for (let k = kmax; k > 0.001; k -= 0.05) if (placeOk(qx + rX * k, qz + rZ * k)) return k
    return 0
  }

  private findGate(): void {
    const f = this.f
    this.gate = -1
    for (let i = 0; i < GATES.length; i++) {
      const g = GATES[i]
      const rx = f.x - g.cx
      const rz = f.z - g.cz
      const across = rx * g.acX + rz * g.acZ
      if (across > g.hw + 0.35 || across < -g.hw - 0.35) continue
      const along = this.dirX * g.axX + this.dirZ * g.axZ
      if (along < 0.6 && along > -0.6) continue
      const sign = along > 0 ? 1 : -1
      const ahead = -(rx * g.axX + rz * g.axZ) * sign
      if (ahead < -GATE_HALF || ahead > GATE_HALF + GATE_APPROACH) continue
      this.gate = i
      this.gateSign = sign
      return
    }
  }

  // --- the neighbours -------------------------------------------------------------------------

  private scan(crowd: Crowd, dirX: number, dirZ: number, rem: number, ghost: boolean): void {
    const rX = -dirZ
    const rZ = dirX
    const slot = this.slot
    const bx = this.bx
    const bz = this.bz
    const myR = this.radius
    let cx = Math.floor((bx - GX0) / CELL)
    let cz = Math.floor((bz - GZ0) / CELL)
    if (cx < 0) cx = 0
    else if (cx >= COLS) cx = COLS - 1
    if (cz < 0) cz = 0
    else if (cz >= ROWS) cz = ROWS - 1
    const start = crowd.cellStart
    const items = crowd.items
    const sx = crowd.sx
    const sz = crowd.sz
    const svx = crowd.svx
    const svz = crowd.svz
    const rad = crowd.rad
    const sstat = crowd.sstat
    const act = crowd.act
    const r0 = cz > 0 ? cz - 1 : 0
    const r1 = cz < ROWS - 1 ? cz + 1 : ROWS - 1
    const c0 = cx > 0 ? cx - 1 : 0
    const c1 = cx < COLS - 1 ? cx + 1 : COLS - 1
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * COLS + c
        for (let k = start[cell], end = start[cell + 1]; k < end; k++) {
          const j = items[k]
          if (j === slot || act[j] === 0) continue
          const dx = sx[j] - bx
          const dz = sz[j] - bz
          const d2 = dx * dx + dz * dz
          if (d2 > INTERACT * INTERACT) continue
          const d = Math.sqrt(d2)
          if (this.nbN < MAX_NEIGHBOURS) this.nb[this.nbN++] = j
          const sumR = myR + rad[j]
          const isStatic = sstat[j] === 1

          // soft personal space
          const comfort = sumR + COMFORT
          if (d < comfort) {
            const o = comfort - d
            const w = (isStatic ? 1 : 0.5) * PUSH_GAIN * o
            if (d > 1e-4) {
              this.pushX -= (dx / d) * w
              this.pushZ -= (dz / d) * w
            } else {
              // exactly on top of each other: a fixed, per-slot direction
              this.pushX += (slot & 1 ? 1 : -1) * w
              this.pushZ += (slot & 2 ? 1 : -1) * w
            }
          }

          // something in the way ahead
          const fwd = dx * dirX + dz * dirZ
          if (fwd <= 0 || fwd >= LOOK) continue
          // beyond where this route ends: not in the way
          if (fwd > rem + sumR) continue
          const lr = dx * rX + dz * rZ
          const al = lr < 0 ? -lr : lr
          if (al >= sumR + 0.3) continue
          const gap = fwd - sumR
          const va = svx[j] * dirX + svz[j] * dirZ
          if (!isStatic && va > 0.15) {
            // someone walking the same way, slower: stay behind them
            if (!ghost) {
              const lim = va + (gap - 0.3)
              if (lim < this.vLim) this.vLim = lim > 0 ? lim : 0
            }
          } else {
            // standing, seated or coming towards me: step round to the side with room, and stop short if still in the way.
            // (not when my destination is right at them: a queue forms, nobody sidesteps out of it)
            // (people coming the other way keep right and only need to clear each other; a standing person needs more room)
            if (rem > fwd + 0.25) {
              const need = (isStatic ? sumR + 0.18 : sumR + 0.06) - al
              if (need > 0) {
                const side = this.pickSide(j, lr, al, rX, rZ, need)
                if (isStatic || svx[j] * svx[j] + svz[j] * svz[j] < 0.0225) this.sideStill = true
                const k2 = (1 - fwd / LOOK) * need * PUSH_GAIN * 1.5 * side
                this.pushX += rX * k2
                this.pushZ += rZ * k2
              }
            }
            if (!ghost && al < (isStatic ? sumR + 0.08 : sumR + 0.02)) {
              // two movers who have both stopped for each other: the lower slot goes on (the hard separation keeps them
              // apart as they pass), the other waits. Otherwise both would stand there until the ghost rule broke them up.
              const mutual = !isStatic && j > slot && svx[j] * svx[j] + svz[j] * svz[j] < 0.0225
              if (!mutual) {
                const lim = brakeSpeed(gap - 0.2)
                if (lim < this.vLim) this.vLim = lim
              }
            }
          }
        }
      }
    }
  }

  /**
   * Which side to step round obstacle `j` on: a side where the body can actually stand once clear of it (walls and furniture),
   * else away from the obstacle. Once chosen it is kept while the obstacle is ahead.
   */
  private pickSide(j: number, lr: number, al: number, rX: number, rZ: number, need: number): number {
    this.sideSeen = true
    if (this.sideObs === j) return this.sideDir
    const reach = need + 0.05
    const rightOk = placeOk(this.bx + rX * reach, this.bz + rZ * reach)
    const leftOk = placeOk(this.bx - rX * reach, this.bz - rZ * reach)
    let side = al < 0.06 ? 1 : lr > 0 ? -1 : 1
    if (rightOk && !leftOk) side = 1
    else if (leftOk && !rightOk) side = -1
    // (a walker already making way, with the obstacle on the other side, goes on to its own side: at its limit "the only side
    // with room" would be the one towards the obstacle)
    if (this.courtOn && lr * this.courtSide < 0) side = this.courtSide
    this.sideObs = j
    this.sideDir = side
    return side
  }

  /** Single-file doors: the walker inside the door or nearer to it goes first; the one from the other side waits outside. */
  private doorNegotiation(crowd: Crowd, px: number, pz: number): void {
    const slot = this.slot
    if (this.gate < 0) {
      crowd.gDoor[slot] = -1
      this.yieldT = 0
      return
    }
    const g = GATES[this.gate]
    const s = (px - g.cx) * g.axX + (pz - g.cz) * g.axZ
    const ahead = -s * this.gateSign
    if (ahead < -GATE_HALF - 0.05) {
      // through and out the other side
      this.gate = -1
      crowd.gDoor[slot] = -1
      this.yieldT = 0
      return
    }
    const inside = ahead <= GATE_HALF
    const key = (inside ? 0 : 1 + (ahead - GATE_HALF)) + slot * 1e-6
    crowd.gDoor[slot] = this.gate
    crowd.gSign[slot] = this.gateSign
    crowd.gKey[slot] = key
    if (inside) {
      this.yieldT = 0
      return
    }
    const opp = this.gateSign > 0 ? crowd.bestNeg[this.gate] : crowd.bestPos[this.gate]
    if (this.clock >= this.ignoreGateUntil && opp < key - 1e-9) {
      // wait outside the door width: stop 0.35 m before the door's edge
      const lim = brakeSpeed(ahead - GATE_HALF - 0.35)
      if (lim < this.vLim) this.vLim = lim
      this.yieldT += 1 / 60
      if (this.yieldT > YIELD_AFTER) {
        this.ignoreGateUntil = this.clock + DOOR_GRACE
        this.yieldT = 0
      }
    } else if (opp === Infinity) this.yieldT = 0
  }

  // --- the final position ---------------------------------------------------------------------

  /** Body = path point + offsets, pulled back to a legal place. Corrections are absorbed into the avoidance displacement. */
  /** Would the move from (oldX, oldZ) to the new body leave it closer than touching to someone, and closer than before? */
  private wouldCrowd(crowd: Crowd, oldX: number, oldZ: number, dt: number): boolean {
    for (let i = 0; i < this.nbN; i++) {
      const j = this.nb[i]
      const min = this.radius + crowd.rad[j] - VETO_SLACK
      // where the other will be after this step too, if it keeps its velocity
      const jx = crowd.sx[j] + crowd.svx[j] * dt
      const jz = crowd.sz[j] + crowd.svz[j] * dt
      const nx = jx - this.bx
      const nz = jz - this.bz
      const dNew2 = nx * nx + nz * nz
      if (dNew2 >= min * min) continue
      const ox = crowd.sx[j] - oldX
      const oz = crowd.sz[j] - oldZ
      if (dNew2 < ox * ox + oz * oz - 1e-6) return true
    }
    return false
  }

  private constrain(): void {
    const f = this.f
    const px = f.x
    const pz = f.z
    const small = Math.abs(this.lx) + Math.abs(this.lz) + Math.abs(this.ax) + Math.abs(this.az)
    let x = px + this.lx + this.ax
    let z = pz + this.lz + this.az
    if (small < 1e-4) {
      this.bx = px
      this.bz = pz
      return
    }
    const crowd = this.crowd!
    const myR = this.radius
    for (let pass = 0; pass < 3; pass++) {
      // never overlap a body by more than HARD_SLACK (even a walker who has been blocked and ignores the others); two movers
      // share the correction on the first pass, and whoever is left with an overlap takes the rest
      for (let i = 0; i < this.nbN; i++) {
        const j = this.nb[i]
        const dx = crowd.sx[j] - x
        const dz = crowd.sz[j] - z
        const min = myR + crowd.rad[j] - HARD_SLACK
        const d2 = dx * dx + dz * dz
        if (d2 >= min * min) continue
        const d = Math.sqrt(d2)
        const w = (crowd.sstat[j] === 1 || pass > 0 ? 1 : 0.5) * (min - d)
        if (d > 1e-4) {
          x -= (dx / d) * w
          z -= (dz / d) * w
          // if that pushes into a wall or furniture, slide round the other body instead
          if (!isWalkable(x, z, BODY_MARGIN)) {
            this.slideRound(crowd.sx[j], crowd.sz[j], min, -dx / d, -dz / d, x, z)
            x = this.slX
            z = this.slZ
          }
        }
      }
      // walls and furniture have the last word
      if (!isWalkable(x, z, BODY_MARGIN)) {
        nearestWalkable(x, z, BODY_MARGIN, TMP)
        x = TMP.x
        z = TMP.z
      }
    }
    this.ax = x - px - this.lx
    this.az = z - pz - this.lz
    this.bx = x
    this.bz = z
  }

  private slX = 0
  private slZ = 0

  /**
   * Put the body at distance `min` from the other body (ox, oz), as near to (x, z) as possible on walkable ground: away from
   * them if that is free, else sliding round them (the directions turned by up to 90 degrees either way).
   */
  private slideRound(ox: number, oz: number, min: number, awayX: number, awayZ: number, x: number, z: number): void {
    this.slX = x
    this.slZ = z
    let best = Infinity
    for (let k = 0; k < 7; k++) {
      const a = (k - 3) * (Math.PI / 6)
      const c = Math.cos(a)
      const sn = Math.sin(a)
      const cx = ox + (awayX * c - awayZ * sn) * min
      const cz = oz + (awayX * sn + awayZ * c) * min
      if (!isWalkable(cx, cz, BODY_MARGIN)) continue
      const d = (cx - x) * (cx - x) + (cz - z) * (cz - z)
      if (d < best) {
        best = d
        this.slX = cx
        this.slZ = cz
      }
    }
  }

  // --- publishing to the crowd ---------------------------------------------------------------

  private publish(): void {
    const c = this.crowd
    if (c === null) return
    c.px[this.slot] = this.bx
    c.pz[this.slot] = this.bz
    const moving = this.f.active && !this.forcedStatic
    c.stat[this.slot] = moving ? 0 : 1
    this.publishVelocity(moving ? this.f.speed : 0)
  }

  private publishVelocity(v: number): void {
    const c = this.crowd
    if (c === null) return
    c.vx[this.slot] = this.dirX * v
    c.vz[this.slot] = this.dirZ * v
  }
}
