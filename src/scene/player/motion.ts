/**
 * How your body moves, as plain functions on plain numbers (adapted from Waltz City's `motion.ts`): input becomes a velocity
 * with a short acceleration and a shorter braking time, the body turns smoothly to face where it goes, and other people are
 * circles you cannot walk through. Collision against walls and furniture is `collision.ts`; this file knows nothing of the building.
 */
import { angleDelta, clamp, wrapAngle } from './chaseMath'
import { CROWD, MOVE } from './tuning'

export interface Planar {
  x: number
  z: number
}

/** The horizontal motion state. */
export interface Velocity extends Planar {
  /** Rate (m/s^2) at which the current braking started, 0 when not braking. */
  brake: number
}

export function newVelocity(): Velocity {
  return { x: 0, z: 0, brake: 0 }
}

export function speedOf(v: Planar): number {
  return Math.hypot(v.x, v.z)
}

/**
 * Move `v` toward the wanted velocity (a unit direction times `wishSpeed`). Speeding up or turning takes `accelSeconds` to reach
 * full wishSpeed; releasing all input brakes to a stop in `decelSeconds`, measured from the speed at the moment of release.
 * Slowing from a hurry to a walk uses the braking time. It always ends at exactly the wanted velocity, or at exactly zero.
 */
export function stepVelocity(
  v: Velocity,
  dirX: number,
  dirZ: number,
  wishSpeed: number,
  dt: number,
  accelSeconds: number = MOVE.accelSeconds,
  decelSeconds: number = MOVE.decelSeconds,
): Velocity {
  const wanting = wishSpeed > 1e-4 && (Math.abs(dirX) > 1e-6 || Math.abs(dirZ) > 1e-6)
  const speed = speedOf(v)
  if (!wanting) {
    if (speed < 1e-4) {
      v.x = 0
      v.z = 0
      v.brake = 0
      return v
    }
    if (v.brake === 0) v.brake = Math.max(speed, 0.3) / decelSeconds
    const drop = v.brake * dt
    if (drop >= speed) {
      v.x = 0
      v.z = 0
      v.brake = 0
    } else {
      const k = (speed - drop) / speed
      v.x *= k
      v.z *= k
    }
    return v
  }
  v.brake = 0
  const len = Math.hypot(dirX, dirZ)
  const tx = (dirX / len) * wishSpeed
  const tz = (dirZ / len) * wishSpeed
  const dx = tx - v.x
  const dz = tz - v.z
  const dl = Math.hypot(dx, dz)
  if (dl < 1e-6) return v
  const slowing = wishSpeed < speed && dx * v.x + dz * v.z < 0
  const rate = slowing ? Math.max(speed, wishSpeed) / decelSeconds : wishSpeed / accelSeconds
  const step = Math.min(dl, rate * dt)
  v.x += (dx / dl) * step
  v.z += (dz / dl) * step
  return v
}

/**
 * Turn the body towards `target` (radians) with an exponential approach and a speed limit, so a quarter turn takes about a tenth
 * of a second and a U-turn a little over a fifth. Returns the new heading.
 */
export function turnTowards(heading: number, target: number, dt: number, seconds: number = MOVE.turnSeconds, maxRate: number = MOVE.maxTurnRate): number {
  const diff = angleDelta(heading, target)
  const k = 1 - Math.exp(-Math.max(dt, 0) / Math.max(seconds, 1e-4))
  const step = clamp(diff * k, -maxRate * dt, maxRate * dt)
  return wrapAngle(heading + step)
}

/** The heading a body wants given its velocity, or null when it is too slow to say. */
export function facingFromVelocity(v: Planar, threshold: number = MOVE.facingSpeed): number | null {
  return speedOf(v) > threshold ? Math.atan2(v.x, v.z) : null
}

/**
 * Other people as circles: the displacement (written to `out`) that pushes a body of radius `bodyRadius` at (px, pz) out of a
 * person standing at (cx, cz). Zero when clear. It is a push along the line between the two centres, capped at `maxStep`, so a
 * crowd never throws you about and never traps you: you slide round people the way you slide along a wall.
 */
export function pushOutOfPerson(px: number, pz: number, cx: number, cz: number, bodyRadius: number, maxStep: number, out: Planar): Planar {
  const dx = px - cx
  const dz = pz - cz
  const reach = bodyRadius + CROWD.npcRadius
  const d2 = dx * dx + dz * dz
  if (d2 >= reach * reach) {
    out.x = 0
    out.z = 0
    return out
  }
  const d = Math.sqrt(d2)
  const push = Math.min(reach - d, maxStep)
  if (d < 1e-4) {
    // dead on top of each other: step aside to the east, always the same way
    out.x = push
    out.z = 0
    return out
  }
  out.x = (dx / d) * push
  out.z = (dz / d) * push
  return out
}
