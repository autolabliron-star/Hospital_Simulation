/**
 * The glide between two shots: a Catmull-Rom dolly eased in and out, with the heading turning along it. Pure maths with every number a field
 * (nothing is allocated per frame: `tick` writes `x`, `z`, `yaw` and `pitch` in place), so node can test it and the player system can run it
 * at priority -10 without a GC pause.
 *
 * The path runs through four control points: the point before the start (the shot before it in the loop, or the start mirrored when the glide
 * begins away from any shot), the start, the end, and the shot after the end. A uniform Catmull-Rom spline passes through the middle two with
 * a tangent that follows their neighbours, so the dolly bends gently into the next move instead of running along a ruler. Time is eased with a
 * smootherstep, so every glide starts and ends at rest (no snap, no lurch), 6 to 8 seconds long. The yaw takes the short way round and eases
 * with the same curve.
 *
 * The body is NOT teleported along this path: the player system asks `BodyMover.glide` to walk the body to each point, so walls, furniture,
 * doors and people still push back and the sim's collision stays coherent.
 */
export interface GlidePose {
  x: number
  z: number
  /** Compass radians, atan2(dx, dz). */
  yaw: number
  /** Elevation above level, radians (positive looks down). */
  pitch: number
}

export const GLIDE_MIN_SECONDS = 6
export const GLIDE_MAX_SECONDS = 8

const TAU = Math.PI * 2

/** Ken Perlin's smootherstep: 0 at 0 and 1 at 1 with zero first and second derivative at both ends. */
export function smootherstep(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** One coordinate of a uniform Catmull-Rom segment through p1 (t = 0) and p2 (t = 1). */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3)
}

/** The shortest signed turn from `from` to `to`, in (-pi, pi]. */
export function shortestTurn(from: number, to: number): number {
  let d = (to - from) % TAU
  if (d > Math.PI) d -= TAU
  else if (d <= -Math.PI) d += TAU
  return d
}

/** How long a glide over `chord` metres takes: 6 s for a short hop, more for a long one, never over 8 s. */
export function glideSeconds(chord: number): number {
  const s = 5 + 0.35 * chord
  return s < GLIDE_MIN_SECONDS ? GLIDE_MIN_SECONDS : s > GLIDE_MAX_SECONDS ? GLIDE_MAX_SECONDS : s
}

export class Glide {
  /** A glide is under way. */
  active = false
  /** The pose now (valid while `active`, and exactly the end pose on the frame it finishes). */
  x = 0
  z = 0
  yaw = 0
  pitch = 0
  /** Eased progress 0..1 and the seconds so far / in all. */
  progress = 0
  elapsed = 0
  seconds = 1
  private p0x = 0
  private p0z = 0
  private p1x = 0
  private p1z = 0
  private p2x = 0
  private p2z = 0
  private p3x = 0
  private p3z = 0
  private yaw0 = 0
  private dyaw = 0
  private pitch0 = 0
  private dpitch = 0

  /**
   * Begin a glide from `from` to `to`. `before` and `after` are the control points around them (null: mirror the move, so the path is straight
   * on that side). `seconds` defaults to `glideSeconds` of the chord.
   */
  start(from: GlidePose, to: GlidePose, before: GlidePose | null, after: GlidePose | null, seconds?: number): void {
    this.p1x = from.x
    this.p1z = from.z
    this.p2x = to.x
    this.p2z = to.z
    this.p0x = before ? before.x : 2 * from.x - to.x
    this.p0z = before ? before.z : 2 * from.z - to.z
    this.p3x = after ? after.x : 2 * to.x - from.x
    this.p3z = after ? after.z : 2 * to.z - from.z
    this.yaw0 = from.yaw
    this.dyaw = shortestTurn(from.yaw, to.yaw)
    this.pitch0 = from.pitch
    this.dpitch = to.pitch - from.pitch
    this.seconds = seconds ?? glideSeconds(Math.hypot(to.x - from.x, to.z - from.z))
    this.elapsed = 0
    this.progress = 0
    this.x = from.x
    this.z = from.z
    this.yaw = from.yaw
    this.pitch = from.pitch
    this.active = true
  }

  /** Advance by `dt` seconds and write the pose. Returns true on the frame the glide ends (the pose is then exactly the end pose). */
  tick(dt: number): boolean {
    if (!this.active) return false
    this.elapsed += dt > 0 ? dt : 0
    const t = this.elapsed >= this.seconds ? 1 : this.elapsed / this.seconds
    const u = smootherstep(t)
    this.progress = u
    if (t >= 1) {
      this.x = this.p2x
      this.z = this.p2z
      this.yaw = this.yaw0 + this.dyaw
      this.pitch = this.pitch0 + this.dpitch
      this.active = false
      return true
    }
    this.x = catmullRom(this.p0x, this.p1x, this.p2x, this.p3x, u)
    this.z = catmullRom(this.p0z, this.p1z, this.p2z, this.p3z, u)
    this.yaw = this.yaw0 + this.dyaw * u
    this.pitch = this.pitch0 + this.dpitch * u
    return false
  }

  /** Stop where it is (a key press takes over). */
  cancel(): void {
    this.active = false
  }
}
