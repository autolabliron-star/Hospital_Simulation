/**
 * Where a walking person's body faces, as drawn. Pure maths, no three.js, allocation-free.
 *
 * Why: the sim's heading is the path follower's (src/sim/nav/follower.ts), the direction of the PATH, but the crowd moves the body off the path
 * (keep-right lanes at up to 0.9 m/s sideways, avoidance pushes, the settle onto a spot), so on a seeded morning about one moving frame in six
 * had the body going more than 20 degrees away from where it faced: people crabbed sideways, and the foot planter (which plans along the facing)
 * answered with sideways and emergency steps. And the sim turns a standing person in ONE step when a controller calls `walker.face()` on arrival
 * (up to 180 degrees). The drawn body now:
 *   - faces where it is actually going once it walks (blended in from `FACING.followFrom` to `followTo` m/s), unless that is backwards
 *     (a brief push back is walked backwards, never spun round for);
 *   - otherwise faces the sim's heading;
 *   - and turns toward either at a human rate: it closes `rate` of the error per second, never faster than `maxTurn` rad/s (both times the sim
 *     speed above 1x), so a 180 degree turn on the spot takes about 0.75 s instead of one frame.
 * Positions are untouched (picking, labels and the sim agree); only the drawn yaw and the feet planted along it change.
 */
import { clamp, smoothstep, wrapPi } from './math'

export const FACING = {
  /** Walking speed (m/s, the measured one) over which the body turns from the sim's heading to the direction of motion. */
  followFrom: 0.3,
  followTo: 0.65,
  /** Motion this far off the sim heading (rad) is a step back or a push, not a direction to face: the follow fades out over this band. */
  backFrom: 1.75,
  backTo: 2.2,
  /** Exponential closing rate (1/s) and the turn-rate cap (rad/s). */
  rate: 10,
  maxTurn: 6,
} as const

/** The yaw to aim for: the sim heading, or the direction of motion while walking (see the module comment). */
export function facingTarget(simHeading: number, vx: number, vz: number, speed: number): number {
  if (speed < FACING.followFrom) return simHeading
  const err = wrapPi(Math.atan2(vx, vz) - simHeading)
  const w = smoothstep(FACING.followFrom, FACING.followTo, speed) * (1 - smoothstep(FACING.backFrom, FACING.backTo, Math.abs(err)))
  return wrapPi(simHeading + err * w)
}

/** One frame of turning `face` toward `target` (radians) over `dt` seconds at sim speed `scale` (>= 1). */
export function turnFacing(face: number, target: number, dt: number, scale = 1): number {
  const err = wrapPi(target - face)
  if (err === 0 || dt <= 0) return face
  const s = scale > 1 ? scale : 1
  const k = 1 - Math.exp(-FACING.rate * s * dt)
  const cap = FACING.maxTurn * s * dt
  return wrapPi(face + clamp(err * k, -cap, cap))
}
