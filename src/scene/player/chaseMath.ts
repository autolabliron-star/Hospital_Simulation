/**
 * The maths of the chase camera, with no three.js, no React and no physics in it, so it can be tested on its own (adapted from
 * Waltz City's `chaseMath.ts`). The camera orbits a PIVOT (just above your head, over your right shoulder) on a boom:
 *
 *   camera = pivot + boom * orbitOffset(yaw, pitch)        look-at = pivot + a little ahead
 *
 *  - `yaw` is the compass direction the camera FACES, in radians, atan2(dx, dz): 0 looks along +Z, pi / 2 along +X.
 *  - `pitch` is how far the camera sits ABOVE the pivot, in radians: 0 is level with it, positive looks down on you,
 *    negative looks up at you.
 *  - The shoulder offset moves the pivot `CHASE.shoulder` metres along the camera's right (`rightOf`), so you stand a little
 *    left of the middle of the picture and the crosshair is clear of your head. It swaps to the left shoulder (the offset runs
 *    along `-rightOf`) when a wall is at your right: see `ChaseCamera`.
 *
 * The collision-aware part works on lengths: the probe sweeps a ball along the boom and says how far it got, `boomAfterHit` turns
 * that into a boom length, `boomWithinSlab` keeps it between the floor and the ceiling, and `smoothBoom` shortens at once and
 * lengthens slowly. Every smoother here comes to an EXACT rest (see `REST`).
 */
import type { Vec3 } from '@/sim/types'
import { CHASE, MOVE } from './tuning'

export interface CameraPose {
  position: Vec3
  target: Vec3
}

export const TAU = Math.PI * 2

/**
 * Below this a smoothed value is AT its target (and its velocity is nothing): a critically damped spring approaches forever, and
 * that endless sub-pixel creep is what makes text in the picture seem to keep moving after the mouse was let go. 5e-5 is 0.003
 * degrees or 0.05 millimetres: about a twentieth of a pixel on a screen, so the last bit is a snap nobody can see.
 */
export const REST = { position: 5e-5, velocity: 0.02 } as const

/** How far apart two camera poses are: the larger of the distance between the cameras and between what they look at, metres. */
export function poseGap(a: CameraPose, b: CameraPose): number {
  const dp = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z)
  const dt = Math.hypot(a.target.x - b.target.x, a.target.y - b.target.y, a.target.z - b.target.z)
  return Math.max(dp, dt)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** `a` wrapped into (-pi, pi]. */
export function wrapAngle(a: number): number {
  let x = (a + Math.PI) % TAU
  if (x <= 0) x += TAU
  return x - Math.PI
}

/** Shortest signed turn from `from` to `to`, in (-pi, pi]. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from)
}

/** Heading of a horizontal direction, atan2(dx, dz). */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz)
}

/** Unit vector the camera faces (horizontal) for a yaw. */
export function forwardOf(yaw: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = Math.sin(yaw)
  out.y = 0
  out.z = Math.cos(yaw)
  return out
}

/** Unit vector to the RIGHT of someone facing `yaw` (facing +z, the right hand is -x: x is east and z is south). */
export function rightOf(yaw: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = -Math.cos(yaw)
  out.y = 0
  out.z = Math.sin(yaw)
  return out
}

/** Unit vector from the pivot to the camera. */
export function orbitOffset(yaw: number, pitch: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const cp = Math.cos(pitch)
  out.x = -Math.sin(yaw) * cp
  out.y = Math.sin(pitch)
  out.z = -Math.cos(yaw) * cp
  return out
}

/** The boom length and elevation a walk starts with (the config's boom, a little above eye level). */
export function defaultBoom(): { dist: number; pitch: number } {
  return { dist: CHASE.boom, pitch: CHASE.pitch }
}

/**
 * What the camera looks at: the pivot, a little ahead of you so there is a hall in front of you. `ahead` is the extra look-ahead
 * for your ground speed (`lookAheadFor`, smoothed), added on top.
 */
export function lookTargetFor(pivot: Vec3, yaw: number, out: Vec3 = { x: 0, y: 0, z: 0 }, ahead?: { x: number; z: number }): Vec3 {
  out.x = pivot.x + Math.sin(yaw) * CHASE.lookAhead + (ahead ? ahead.x : 0)
  out.y = pivot.y + CHASE.lookRaise
  out.z = pivot.z + Math.cos(yaw) * CHASE.lookAhead + (ahead ? ahead.z : 0)
  return out
}

/**
 * Look-ahead: how far the aim point moves along the way you are going, for a ground velocity. Zero when standing,
 * `lookAheadSeconds` metres per m/s otherwise, up to `lookAheadMax`: hurrying frames a little more hall than strolling.
 */
export function lookAheadFor(vx: number, vz: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const speed = Math.hypot(vx, vz)
  if (speed < 1e-4) {
    out.x = 0
    out.z = 0
    return out
  }
  const len = Math.min(speed * CHASE.lookAheadSeconds, CHASE.lookAheadMax)
  out.x = (vx / speed) * len
  out.z = (vz / speed) * len
  return out
}

/**
 * The rest pose behind you: the camera at the default boom and elevation, `yaw` facing, with the pivot over your right
 * shoulder (`side` 1, the default) or your left (`side` -1) and nothing in the way. The camera chase settles to exactly this
 * when the hall is clear.
 */
export function shoulderPose(feet: Vec3, yaw: number, side: 1 | -1 = 1): CameraPose {
  const r = rightOf(yaw)
  const reach = CHASE.shoulder * side
  const pivot = { x: feet.x + r.x * reach, y: feet.y + CHASE.pivotHeight, z: feet.z + r.z * reach }
  const { dist, pitch } = defaultBoom()
  const o = orbitOffset(yaw, pitch)
  return {
    position: { x: pivot.x + o.x * dist, y: pivot.y + o.y * dist, z: pivot.z + o.z * dist },
    target: lookTargetFor(pivot, yaw),
  }
}

/**
 * The lowest pitch that keeps a camera at boom length `dist` above `minHeight` over the floor, when the pivot is
 * `pivotAboveGround` metres up. Never below the configured minimum.
 */
export function minPitchAboveGround(dist: number, pivotAboveGround: number, minHeight: number): number {
  const need = (pivotAboveGround - minHeight) / Math.max(dist, 1e-3)
  const lowest = Math.asin(clamp(need, -1, 1))
  return Math.max(CHASE.minPitch, -lowest)
}

/** Mouse look in pixels to a new yaw and pitch (right turns the view right, down looks down on you). */
export function dragOrbit(
  yaw: number,
  pitch: number,
  dx: number,
  dy: number,
  minPitch: number = CHASE.minPitch,
  maxPitch: number = CHASE.maxPitch,
): { yaw: number; pitch: number } {
  return {
    yaw: wrapAngle(yaw - dx * CHASE.yawPerPixel),
    pitch: clamp(pitch + dy * CHASE.pitchPerPixel, minPitch, maxPitch),
  }
}

/**
 * Wheel to boom length. A notch (about 100 units) changes the length by 12 %, a trackpad's small deltas change it in
 * proportion, and nothing changes it by more than one notch at a time. Scrolling down (positive) pulls the camera back.
 */
export function zoomBoom(dist: number, wheelDeltaY: number): number {
  const units = clamp(wheelDeltaY, -240, 240) / 100
  return dist * Math.exp(units * 0.12)
}

/**
 * The boom length after a sweep. `hitDistance` is how far along the boom the camera ball got before it touched something
 * (null: it did not). The ball is already camera-sized, so `margin` is only a hair of air; the result never exceeds the wanted
 * length and never goes below `minLength`.
 */
export function boomAfterHit(desired: number, hitDistance: number | null, margin: number, minLength: number): number {
  if (hitDistance === null || !Number.isFinite(hitDistance)) return desired
  const room = hitDistance - margin
  return clamp(room, Math.min(minLength, desired), desired)
}

/**
 * How long the boom may be before the camera leaves the slab `minY <= y <= maxY`: the floor and the ceiling as a geometric
 * guarantee. `originY` is the pivot height and `dirY` the vertical component of the unit boom direction.
 */
export function boomWithinSlab(originY: number, dirY: number, desired: number, minY: number, maxY: number): number {
  if (Math.abs(dirY) < 1e-6) return desired
  const limit = dirY > 0 ? (maxY - originY) / dirY : (minY - originY) / dirY
  if (!(limit >= 0)) return Math.min(desired, CHASE.minBoom)
  return Math.min(desired, limit)
}

/**
 * The boom shortens at once and lengthens slowly. Shortening is exponential (`shortenSeconds`). Lengthening starts out exponential
 * (`lengthenSeconds`, so a boom brushing along a wall does not pump) but is never allowed to crawl: the speed has a floor that
 * falls with the square root of what is left (`CHASE.lengthenFinish`), so the boom arrives in finite time, with its speed running
 * down to zero as it does. A pure exponential never arrives. `current` and `target` may be in any unit; the floor is relative to `target`.
 */
export function smoothBoom(
  current: number,
  target: number,
  dt: number,
  shortenSeconds: number = CHASE.shortenSeconds,
  lengthenSeconds: number = CHASE.lengthenSeconds,
): number {
  const step = Math.max(dt, 0)
  const lengthening = target > current
  const seconds = lengthening ? lengthenSeconds : shortenSeconds
  const k = 1 - Math.exp(-step / Math.max(seconds, 1e-4))
  let move = (target - current) * k
  if (lengthening) {
    const scale = Math.max(Math.abs(target), 1e-3)
    const left = (target - current) / scale
    move = Math.max(move, scale * CHASE.lengthenFinish * Math.sqrt(left) * step)
  }
  const next = current + move
  // arrived (a step that would pass the target lands on it, and so does a tail too small to see)
  if (lengthening ? next >= target : Math.abs(target - next) < REST.position * Math.max(Math.abs(target), 1)) return target
  return next
}

/**
 * Critically damped smoothing (Unity's SmoothDamp). `vel.v` carries the velocity between calls. It comes to an exact rest: once
 * it is within `REST.position` of the target and slower than `REST.velocity` it IS the target, with no velocity left.
 */
export function smoothDamp(current: number, target: number, vel: { v: number }, smoothTime: number, dt: number): number {
  if (dt <= 0) return current
  const omega = 2 / Math.max(1e-4, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const temp = (vel.v + omega * change) * dt
  vel.v = (vel.v - omega * temp) * exp
  let out = target + (change + temp) * exp
  // never overshoot
  if (target - current > 0 === out > target) {
    out = target
    vel.v = (out - target) / dt
  }
  // ...and arrive: the spring's endless tail ends in an exact stop
  if (Math.abs(out - target) < REST.position && Math.abs(vel.v) < REST.velocity) {
    out = target
    vel.v = 0
  }
  return out
}

/**
 * `smoothDamp` with a speed limit (Unity's `maxSpeed`): the spring never sees a target further than `maxSpeed * smoothTime` away, and
 * the speed it ends a step with is clamped to `maxSpeed` as well, so a carried velocity (from a spring that was going the other way)
 * cannot exceed it either. Same exact rest as `smoothDamp`. Used by the boom and the shoulder: a wall that appears suddenly is a
 * jump of the target, and the camera must glide at a bounded speed instead of following that jump.
 */
export function smoothDampMax(current: number, target: number, vel: { v: number }, smoothTime: number, dt: number, maxSpeed: number): number {
  if (dt <= 0) return current
  const omega = 2 / Math.max(1e-4, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const maxChange = maxSpeed * smoothTime
  const change = clamp(current - target, -maxChange, maxChange)
  const aim = current - change
  const temp = (vel.v + omega * change) * dt
  vel.v = (vel.v - omega * temp) * exp
  let out = aim + (change + temp) * exp
  // never overshoot the real target
  if (target - current > 0 === out > target) {
    out = target
    vel.v = 0
  }
  // never faster than the limit, whatever velocity the spring was carrying
  const speed = (out - current) / dt
  if (speed > maxSpeed) {
    out = current + maxSpeed * dt
    vel.v = maxSpeed
  } else if (speed < -maxSpeed) {
    out = current - maxSpeed * dt
    vel.v = -maxSpeed
  }
  // ...and arrive
  if (Math.abs(out - target) < REST.position && Math.abs(vel.v) < REST.velocity) {
    out = target
    vel.v = 0
  }
  return out
}

/**
 * One length of the camera that must never snap: the boom, and the shoulder room. It shortens as a critically damped spring
 * (`inSeconds`, at most `inMax` per second) and lengthens as a slower one (`outSeconds`, at most `outMax`); the velocity is carried
 * from one to the other, so a wall that goes away in the middle of a pull-in turns the motion round without a jump. A spring's tail
 * never quite arrives, so lengthening has the floor `smoothBoom` has: it never goes slower than `finish * sqrt(share still to grow)` per
 * second (the share is of `scale`, the size of the thing), which brings it in finite time with its speed running down to nothing.
 * Comes to an exact rest.
 */
export function smoothLength(
  current: number,
  target: number,
  vel: { v: number },
  dt: number,
  inSeconds: number,
  inMax: number,
  outSeconds: number,
  outMax: number,
  finish = 0,
  scale = 1,
): number {
  if (target < current) return smoothDampMax(current, target, vel, inSeconds, dt, inMax)
  let out = smoothDampMax(current, target, vel, outSeconds, dt, outMax)
  if (finish > 0 && dt > 0 && out < target) {
    const left = (target - current) / Math.max(Math.abs(scale), 1e-6)
    const floor = Math.min(finish * Math.sqrt(Math.max(left, 0)), outMax)
    if ((out - current) / dt < floor) {
      out = Math.min(target, current + floor * dt)
      vel.v = out >= target ? 0 : (out - current) / dt
    }
  }
  return out
}

/**
 * A soft ceiling for a non-negative `x`: it is `x` itself up to `knee`, then bends over (a tanh, so the slope is 1 where it starts and
 * falls to 0) and never reaches `limit`. No corner anywhere, so a lag that is squeezed by it has no kink in its speed.
 */
export function softLimit(x: number, knee: number, limit: number): number {
  if (x <= knee) return x
  const room = limit - knee
  if (room <= 0) return Math.min(x, limit)
  return knee + room * Math.tanh((x - knee) / room)
}

/** Where the soft limit on a follow lag begins, as a share of its cap. */
export const LAG_KNEE = 0.6

/** SmoothDamp for an angle: takes the short way round and returns a value near `current`, not wrapped. */
export function dampAngle(current: number, target: number, vel: { v: number }, smoothTime: number, dt: number): number {
  const unwrapped = current + angleDelta(current, target)
  return smoothDamp(current, unwrapped, vel, smoothTime, dt)
}

/**
 * `dampAngle` that ENDS on `target` itself (wrapped, as given), not on an equal angle a few ulps away: the spring's tail snaps to
 * rest (`smoothDamp`), and a snap onto "current + the short way round" can sit one last bit off the number it should be, which would
 * make an otherwise still camera creep in the last bit forever. Used by the easy scheme's follow yaw and look offset.
 */
export function dampAngleRest(current: number, target: number, vel: { v: number }, smoothTime: number, dt: number): number {
  const next = dampAngle(current, target, vel, smoothTime, dt)
  if (vel.v === 0 && Math.abs(angleDelta(next, target)) < REST.position) return target
  return next
}

/**
 * A camera that follows a heading lazily (the easy scheme): critically damped towards `target` over `smoothTime`, and never more than
 * `maxLag` radians behind it, so a fast turn cannot leave the view looking somewhere else. Returns the new yaw (near `current`), and
 * exactly `target` once it has arrived.
 *
 * The limit is SOFT: a lag beyond `LAG_KNEE * maxLag` is squeezed through `softLimit`, which never reaches `maxLag`, and the spring's
 * velocity is set to the rate the yaw really moved at, so a running turn that would trail further than the cap (200 degrees a second
 * times 0.22 s is 44 degrees) tightens up smoothly instead of hitting a wall: no kink in the rate. A lag that is already bigger than
 * `maxLag` (the view was turned by hand, or you were placed somewhere facing another way) is left to shrink at the smoothing's own
 * pace, and is only kept from growing.
 */
export function followYawStep(current: number, target: number, vel: { v: number }, smoothTime: number, maxLag: number, dt: number): number {
  if (dt <= 0) return current
  const before = Math.abs(angleDelta(current, target))
  const next = dampAngleRest(current, target, vel, smoothTime, dt)
  const lag = angleDelta(next, target)
  const size = Math.abs(lag)
  let applied = size
  if (before <= maxLag) applied = softLimit(size, LAG_KNEE * maxLag, maxLag)
  else if (size > before) applied = before
  if (applied === size) return next
  const out = target - Math.sign(lag) * applied
  vel.v = angleDelta(current, out) / dt
  return out
}

export interface DampedVec3 {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export function newDamped(p: Vec3): DampedVec3 {
  return { x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0 }
}

const _vx = { v: 0 }
const _vy = { v: 0 }
const _vz = { v: 0 }

/**
 * Keep a damped follow point within `maxLag` metres of the point it follows (straight-line), so a hitch or a teleport cannot leave it
 * behind. Soft, like the yaw's: beyond `LAG_KNEE * maxLag` the distance is squeezed through `softLimit` (never reaching `maxLag`), and
 * with `dt` given the follow point's velocity gets the rate it was really moved at, so the squeeze leaves no kink in its speed.
 */
export function limitFollowLag(follow: DampedVec3, pivot: Vec3, maxLag: number, dt = 0): DampedVec3 {
  const dx = follow.x - pivot.x
  const dy = follow.y - pivot.y
  const dz = follow.z - pivot.z
  const d = Math.hypot(dx, dy, dz)
  if (d <= LAG_KNEE * maxLag) return follow
  const to = softLimit(d, LAG_KNEE * maxLag, maxLag)
  if (to >= d) return follow
  const k = to / d
  follow.x = pivot.x + dx * k
  follow.y = pivot.y + dy * k
  follow.z = pivot.z + dz * k
  if (dt > 0) {
    // the follow point was moved toward the pivot by (d - to) in this step: that is extra speed along the way to the pivot
    const extra = (d - to) / dt / d
    follow.vx -= dx * extra
    follow.vy -= dy * extra
    follow.vz -= dz * extra
  }
  return follow
}

/** SmoothDamp for a point (the chase camera's follow point). Mutates `state` and returns it. */
export function dampVec3(state: DampedVec3, target: Vec3, smoothTime: number, dt: number): DampedVec3 {
  _vx.v = state.vx
  _vy.v = state.vy
  _vz.v = state.vz
  state.x = smoothDamp(state.x, target.x, _vx, smoothTime, dt)
  state.y = smoothDamp(state.y, target.y, _vy, smoothTime, dt)
  state.z = smoothDamp(state.z, target.z, _vz, smoothTime, dt)
  state.vx = _vx.v
  state.vy = _vy.v
  state.vz = _vz.v
  return state
}

/** Smooth 0..1 easing for the camera blends. */
export function smooth01(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Move `value` towards `target` by at most `step` (a blend factor that runs at a fixed rate). */
export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step)
  return Math.max(target, value - step)
}

/** The camera's vertical field of view, degrees: the chase view, blended toward first person (0 to 1, as the camera blends it). */
export function chaseFov(firstPerson: number): number {
  return lerp(CHASE.fov, CHASE.firstPersonFov, smooth01(firstPerson))
}

/**
 * How much of a run the camera shows, 0..1: your ground speed from a walk (0) to a hurry (1), or the run blend of your legs
 * (`walkStride.run`), whichever is more. The lens widens with it and the bob grows with it.
 */
export function runShare(speed: number, legsRun: number): number {
  const fromSpeed = smooth01((speed - MOVE.walkSpeed) / Math.max(MOVE.hurrySpeed - MOVE.walkSpeed, 1e-3))
  return Math.max(fromSpeed, clamp(legsRun, 0, 1))
}

/**
 * The footfall bob as a number in -1..1 for a gait phase (0..1, 0 at a left heel strike and 0.5 at a right one): two bounces a cycle,
 * lowest (-1) at each heel strike, highest (+1) between them. Continuous across the 1 -> 0 wrap.
 */
export function gaitBob(phase: number): number {
  return -Math.cos(4 * Math.PI * phase)
}

/** How visible your avatar is for a boom length (1 = fully, 0 = gone): it fades out below `hideAvatarBelow` and in first person. */
export function avatarFade(boom: number, firstPersonBlend: number): number {
  const fromBoom = smooth01((boom - CHASE.hideAvatarBelow) / CHASE.avatarFadeRange)
  const fromFirst = 1 - smooth01((firstPersonBlend - 0.2) / 0.65)
  return Math.min(fromBoom, fromFirst)
}
