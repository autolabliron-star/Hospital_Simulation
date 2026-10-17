/**
 * Kinematic path follower for one walker. Allocation-free in `step`.
 *
 * The body moves exactly along the polyline, so a route that hugs the corridor centre line stays on it (no corner
 * cutting). Only the heading lags: it is turned smoothly (at most ~6 rad/s), and the walker slows while it is
 * still turning towards the path, so corners look like a person rounding a corner, not a sliding box.
 *
 *   - Speed ramps softly (1.5 m/s^2 up and down) towards the commanded cruise speed.
 *   - It slows into sharp corners and into the final waypoint, and snaps exactly onto the last waypoint.
 *
 * Coordinates: metres, x east, z south. Heading is atan2(dx, dz): 0 faces +z.
 */
import type { Vec2 } from '../types'

export type FollowState = 'moving' | 'arrived'

/** m/s^2 */
const ACCEL = 1.5
const DECEL = 1.5
/** The slow-down curve plans with a gentler decel than the real one so the real brake can always follow it. */
const BRAKE_PLAN = 1.2
/** Maximum heading change, rad/s. */
const MAX_TURN = 6
/** The heading closes this fraction of the remaining error per second (before the cap above). */
const TURN_RATE = 14
/** Never plan a speed below this while there is still path to cover (avoids an asymptotic crawl at the end). */
const MIN_CREEP = 0.12
const ARRIVE_EPS = 1e-4
/** Leading waypoints closer than this to the current position are dropped (routes start at the walker). */
const SKIP_START = 0.05
const TAU = Math.PI * 2
const NO_LIMIT = 1e9

function wrapPi(a: number): number {
  return a - TAU * Math.round(a / TAU)
}

/** Speed limit at a waypoint where the path turns by `turn` radians. */
function cornerSpeed(turn: number): number {
  if (turn < 0.25) return NO_LIMIT
  return Math.max(0.4, 2.4 * (1 - turn / Math.PI))
}

export class PathFollower {
  x = 0
  z = 0
  /** atan2(dx, dz), smoothly turned. */
  heading = 0
  /** Current speed in m/s. */
  speed = 0

  private px = new Float64Array(32)
  private pz = new Float64Array(32)
  /** Length from waypoint i to the end of the path. */
  private tail = new Float64Array(32)
  /** Speed limit on arriving at waypoint i. */
  private corner = new Float64Array(32)
  private n = 0
  private idx = 0
  // scratch for the candidate move
  private nx = 0
  private nz = 0
  private nIdx = 0
  // saved by `save` for `restore` (the crowd takes a step back when it would put the body into someone)
  private saveX = 0
  private saveZ = 0
  private saveIdx = 0
  // the heading's per-step closing fraction, cached for the last dt (an exp per step per walker adds up)
  private kDt = -1
  private kTurn = 0

  constructor(x = 0, z = 0, heading = 0) {
    this.x = x
    this.z = z
    this.heading = heading
  }

  /** Put the walker at a spot, stopped, with no path. */
  reset(x: number, z: number, heading = this.heading): void {
    this.x = x
    this.z = z
    this.heading = heading
    this.speed = 0
    this.n = 0
    this.idx = 0
  }

  /** Remember where the walker is on the path (position and waypoint), to `restore` after a step. */
  save(): void {
    this.saveX = this.x
    this.saveZ = this.z
    this.saveIdx = this.idx
  }

  /** Go back to the saved place on the path, stopped (the heading keeps what it has turned). */
  restore(): void {
    this.x = this.saveX
    this.z = this.saveZ
    this.idx = this.saveIdx
    this.speed = 0
  }

  /** True while there is path left to walk. */
  get active(): boolean {
    return this.idx < this.n
  }

  /** Distance left along the path from the current position. */
  get remaining(): number {
    if (this.idx >= this.n) return 0
    return Math.hypot(this.px[this.idx] - this.x, this.pz[this.idx] - this.z) + this.tail[this.idx]
  }

  /** Next waypoint (valid while `active`). */
  get targetX(): number {
    return this.idx < this.n ? this.px[this.idx] : this.x
  }

  get targetZ(): number {
    return this.idx < this.n ? this.pz[this.idx] : this.z
  }

  /**
   * Replace the path. The first points may be the walker's own position (a route starts at `from`): leading
   * points within 5 cm are dropped. The final point is always kept, so the walker ends exactly on it. The speed
   * is kept, so re-routing a moving walker is smooth.
   */
  setPath(points: readonly Vec2[]): void {
    const len = points.length
    if (this.px.length < len) {
      const cap = Math.max(len, this.px.length * 2)
      this.px = new Float64Array(cap)
      this.pz = new Float64Array(cap)
      this.tail = new Float64Array(cap)
      this.corner = new Float64Array(cap)
    }
    let n = 0
    for (let i = 0; i < len; i++) {
      const p = points[i]
      const prevX = n > 0 ? this.px[n - 1] : this.x
      const prevZ = n > 0 ? this.pz[n - 1] : this.z
      const d = Math.hypot(p.x - prevX, p.z - prevZ)
      const isLast = i === len - 1
      if (isLast) {
        if (n > 0 && d < ARRIVE_EPS) {
          // the last point coincides with the one before: make that one the exact final point
          this.px[n - 1] = p.x
          this.pz[n - 1] = p.z
          continue
        }
      } else if (d < SKIP_START) {
        continue
      }
      this.px[n] = p.x
      this.pz[n] = p.z
      n++
    }
    this.n = n
    this.idx = 0
    if (n === 0) return
    this.tail[n - 1] = 0
    for (let i = n - 2; i >= 0; i--) this.tail[i] = this.tail[i + 1] + Math.hypot(this.px[i + 1] - this.px[i], this.pz[i + 1] - this.pz[i])
    this.corner[n - 1] = 0
    let inX = this.px[0] - this.x
    let inZ = this.pz[0] - this.z
    for (let i = 0; i < n - 1; i++) {
      const outX = this.px[i + 1] - this.px[i]
      const outZ = this.pz[i + 1] - this.pz[i]
      if ((inX === 0 && inZ === 0) || (outX === 0 && outZ === 0)) {
        this.corner[i] = NO_LIMIT
      } else {
        this.corner[i] = cornerSpeed(Math.abs(wrapPi(Math.atan2(outX, outZ) - Math.atan2(inX, inZ))))
      }
      inX = outX
      inZ = outZ
    }
  }

  /** Where moving `len` metres along the path from the current position ends up (written to nx, nz, nIdx). */
  private advance(len: number): void {
    let x = this.x
    let z = this.z
    let i = this.idx
    let rem = len
    while (i < this.n) {
      const dx = this.px[i] - x
      const dz = this.pz[i] - z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d <= rem) {
        x = this.px[i]
        z = this.pz[i]
        rem -= d
        i++
        if (rem <= 1e-9) break
      } else {
        const k = rem / d
        x += dx * k
        z += dz * k
        break
      }
    }
    this.nx = x
    this.nz = z
    this.nIdx = i
  }

  /**
   * Advance one fixed step. `cruise` is the speed to walk at (m/s). Returns 'moving' or 'arrived' (on the last waypoint, or
   * there is no path).
   */
  step(dt: number, cruise: number): FollowState {
    if (this.idx >= this.n) {
      this.speed = 0
      return 'arrived'
    }
    let dx = this.px[this.idx] - this.x
    let dz = this.pz[this.idx] - this.z
    let d = Math.sqrt(dx * dx + dz * dz)
    while (d < ARRIVE_EPS && this.idx < this.n - 1) {
      this.idx++
      dx = this.px[this.idx] - this.x
      dz = this.pz[this.idx] - this.z
      d = Math.sqrt(dx * dx + dz * dz)
    }
    if (d < ARRIVE_EPS) {
      this.x = this.px[this.idx]
      this.z = this.pz[this.idx]
      this.idx = this.n
      this.speed = 0
      return 'arrived'
    }

    // 1. turn towards the next waypoint
    let err = wrapPi(Math.atan2(dx, dz) - this.heading)
    if (dt !== this.kDt) {
      this.kDt = dt
      this.kTurn = 1 - Math.exp(-TURN_RATE * dt)
    }
    let turn = err * this.kTurn
    const cap = MAX_TURN * dt
    if (turn > cap) turn = cap
    else if (turn < -cap) turn = -cap
    this.heading = wrapPi(this.heading + turn)
    err -= turn

    // 2. the speed we may run at: cruise, braking for the corner and for the end, easing while still turning
    const want = cruise > 0 ? cruise : 0
    let vMax = want
    const vc = this.corner[this.idx]
    const vCorner = Math.sqrt(vc * vc + 2 * BRAKE_PLAN * d)
    if (vCorner < vMax) vMax = vCorner
    const vEnd = Math.sqrt(2 * BRAKE_PLAN * (d + this.tail[this.idx]))
    if (vEnd < vMax) vMax = vEnd
    if (want > 0 && vMax < MIN_CREEP) vMax = Math.min(want, MIN_CREEP)
    const ae = Math.abs(err)
    if (ae > 0.3) vMax *= 1 - 0.85 * Math.min(1, (ae - 0.3) / (Math.PI / 2 - 0.3))

    let v = this.speed
    if (v < vMax) {
      v += ACCEL * dt
      if (v > vMax) v = vMax
    } else {
      v -= DECEL * dt
      if (v < vMax) v = vMax
    }

    // 3. the move
    this.advance(v * dt)
    this.x = this.nx
    this.z = this.nz
    this.idx = this.nIdx
    if (this.idx >= this.n) {
      this.speed = 0
      return 'arrived'
    }
    this.speed = v
    return 'moving'
  }
}
