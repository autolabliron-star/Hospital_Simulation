/**
 * Kinematic path follower for one walker. Allocation-free in `step`.
 *
 * The body moves exactly along the polyline, so a route that hugs the corridor centre line stays on it (no corner
 * cutting). Only the heading lags: it is turned smoothly (at most ~6 rad/s), and the walker slows while it is
 * still turning towards the path, so corners look like a person rounding a corner, not a sliding box.
 *
 *   - Speed ramps softly (1.5 m/s^2 up and down) towards the commanded cruise speed.
 *   - It slows into sharp corners and into the final waypoint, and snaps exactly onto the last waypoint.
 *   - Rounded corners (opt-in, `roundCorners`, the crowd's walkers): the path point still walks the polyline exactly (progress, `remaining`,
 *     arrival are unchanged), and `rx, rz` is the displacement from it to a curve that leaves the polyline `r` before a waypoint and joins it
 *     `r` after (a quadratic Bezier through the corner): D = (r - d)^2 / (4 r) (b - a), d the distance to the corner along the path, a and b
 *     the unit directions in and out. D and its slope are 0 at d = r, so the body bends smoothly into a corner instead of pivoting on it.
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
/** On a rounded corner the path point runs at most 1 / this faster than the body's pace (the tangent is cos(turn / 2) long at the apex). */
const CURVE_MIN_TANGENT = 0.5

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
  /** Rounded corners: per waypoint its radius (0: a sharp corner) and b - a (out minus in unit direction); where the path started. */
  private cr = new Float64Array(32)
  private ckx = new Float64Array(32)
  private ckz = new Float64Array(32)
  /** The unit direction into each rounded corner. */
  private cax = new Float64Array(32)
  private caz = new Float64Array(32)
  /** On a rounded corner this step: the curve's tangent (a + u (b - a), not unit length). */
  private tnx = 0
  private tnz = 0
  private startX = 0
  private startZ = 0

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
      this.cr = new Float64Array(cap)
      this.ckx = new Float64Array(cap)
      this.ckz = new Float64Array(cap)
      this.cax = new Float64Array(cap)
      this.caz = new Float64Array(cap)
    }
    this.startX = this.x
    this.startZ = this.z
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
    this.cr.fill(0, 0, Math.max(n, 1))
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

  /**
   * Round the corners of the current path (call right after `setPath`): each waypoint with a way out turns on a curve of radius up to `maxR`
   * (at most 0.45 of either leg, none for turns under `minTurn` or over `maxTurn` rad: a U-turn is walked to its end), shrunk by halves (twice)
   * until `ok` says the apex and the quarter points are free, else left sharp. The final waypoint is never rounded.
   */
  roundCorners(maxR: number, ok: (x: number, z: number) => boolean, minTurn = 0.08, maxTurn = 2.4): void {
    const n = this.n
    let inX = this.startX
    let inZ = this.startZ
    for (let i = 0; i < n - 1; i++) {
      const wx = this.px[i]
      const wz = this.pz[i]
      const ax = wx - inX
      const az = wz - inZ
      const la = Math.sqrt(ax * ax + az * az)
      const bx = this.px[i + 1] - wx
      const bz = this.pz[i + 1] - wz
      const lb = Math.sqrt(bx * bx + bz * bz)
      inX = wx
      inZ = wz
      this.cr[i] = 0
      if (la < 1e-6 || lb < 1e-6) continue
      const kx = bx / lb - ax / la
      const kz = bz / lb - az / la
      const turn = Math.abs(wrapPi(Math.atan2(bx, bz) - Math.atan2(ax, az)))
      if (turn < minTurn || turn > maxTurn) continue
      let r = Math.min(maxR, 0.45 * la, 0.45 * lb)
      for (let tries = 0; tries < 3 && r > 0.05; tries++, r *= 0.5) {
        // the apex (d = 0) and the curve a quarter in from either end (d = r / 2)
        const qa = r / 4
        const qq = r / 16
        if (
          ok(wx + kx * qa, wz + kz * qa) &&
          ok(wx - (ax / la) * (r / 2) + kx * qq, wz - (az / la) * (r / 2) + kz * qq) &&
          ok(wx + (bx / lb) * (r / 2) + kx * qq, wz + (bz / lb) * (r / 2) + kz * qq)
        ) {
          this.cr[i] = r
          this.ckx[i] = kx
          this.ckz[i] = kz
          this.cax[i] = ax / la
          this.caz[i] = az / la
          break
        }
      }
    }
  }

  /** The rounded-corner displacement at the current position (see the module comment), written by `updateRound`; 0 on a straight. */
  rx = 0
  rz = 0

  /** Work out `rx, rz` for where the path point is now. Allocation-free. */
  updateRound(): void {
    this.rx = 0
    this.rz = 0
    const i = this.idx
    if (i >= this.n) return
    // the corner ahead (the next waypoint), then the one just passed
    let r = this.cr[i]
    if (r > 0) {
      const dx = this.px[i] - this.x
      const dz = this.pz[i] - this.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < r) {
        const k = ((r - d) * (r - d)) / (4 * r)
        this.rx = k * this.ckx[i]
        this.rz = k * this.ckz[i]
        return
      }
    }
    if (i > 0) {
      r = this.cr[i - 1]
      if (r > 0) {
        const dx = this.x - this.px[i - 1]
        const dz = this.z - this.pz[i - 1]
        const d = Math.sqrt(dx * dx + dz * dz)
        if (d < r) {
          const k = ((r - d) * (r - d)) / (4 * r)
          this.rx = k * this.ckx[i - 1]
          this.rz = k * this.ckz[i - 1]
        }
      }
    }
  }

  /**
   * Is the path point on a rounded corner (within its radius of the waypoint ahead or of the one just passed)? Then `tnx, tnz` is the curve's
   * tangent there: the walker heads along it (no heading error to slow for, as there is at a sharp corner) and the path point runs 1 / |tangent|
   * faster, so the body keeps its pace round the curve instead of slowing to cos(turn / 2) of it at the apex.
   */
  private onCurve(): boolean {
    const i = this.idx
    if (i >= this.n) return false
    let r = this.cr[i]
    if (r > 0) {
      const dx = this.px[i] - this.x
      const dz = this.pz[i] - this.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < r) {
        const u = (r - d) / (2 * r)
        this.tnx = this.cax[i] + u * this.ckx[i]
        this.tnz = this.caz[i] + u * this.ckz[i]
        return true
      }
    }
    if (i > 0) {
      r = this.cr[i - 1]
      if (r > 0) {
        const dx = this.x - this.px[i - 1]
        const dz = this.z - this.pz[i - 1]
        const d = Math.sqrt(dx * dx + dz * dz)
        if (d < r) {
          const u = (r + d) / (2 * r)
          this.tnx = this.cax[i - 1] + u * this.ckx[i - 1]
          this.tnz = this.caz[i - 1] + u * this.ckz[i - 1]
          return true
        }
      }
    }
    return false
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

    // 1. turn towards the next waypoint (on a rounded corner: along the curve, and the path point keeps the body at pace)
    let hx = dx
    let hz = dz
    let stretch = 1
    if (this.onCurve()) {
      hx = this.tnx
      hz = this.tnz
      stretch = 1 / Math.max(CURVE_MIN_TANGENT, Math.sqrt(hx * hx + hz * hz))
    }
    let err = wrapPi(Math.atan2(hx, hz) - this.heading)
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
    this.advance(v * dt * stretch)
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
