/**
 * How your speed changes, as plain functions on plain numbers: a critically damped SPRING on the speed magnitude (never on the velocity
 * vector: a vector spring lags a 140 degree-a-second turn by about 40 degrees and the doctor walks crabwise), plus the body's turn
 * to face where it goes. Collision against the building is `collision.ts`; this file knows nothing of it.
 *
 * The spring is the exact closed form of x'' = -2 w x' - w^2 (x - target) with w = 2 / T (T is Unity's "smooth time"), so a frame is
 * integrated exactly: the distance covered in a second does not depend on the frame rate, and there is no overshoot. T is derived from the
 * configured "seconds to 95 % of the change" (`CONFIG.player.startSeconds / stopSeconds / shiftSeconds`): a critically damped step is at
 * 95 % when w t = 4.744, that is t = 2.372 T.
 *
 *   start   from rest (or nearly) up to a walk or a run
 *   stop    to rest, from anywhere
 *   shift   walk <-> run, forward <-> backing up, and the slow-down of a reversal
 *
 * The time constant is chosen when the TARGET changes and held until it changes again, so the acceleration never jumps in mid-flight.
 */
import { CONFIG } from '@/sim/config'
import { angleDelta, clamp, wrapAngle } from './chaseMath'
import { MOVE } from './tuning'

export interface Planar {
  x: number
  z: number
}

export function speedOf(v: Planar): number {
  return Math.hypot(v.x, v.z)
}

/** Seconds-to-95-percent over this is the spring's smooth time. */
export const SMOOTH_DIVISOR = 2.37

/** The smooth time T of each kind of speed change, seconds. */
export const SMOOTH_TIME = {
  start: CONFIG.player.startSeconds / SMOOTH_DIVISOR,
  stop: CONFIG.player.stopSeconds / SMOOTH_DIVISOR,
  shift: CONFIG.player.shiftSeconds / SMOOTH_DIVISOR,
} as const

export type SpeedChange = 'start' | 'stop' | 'shift'

/** A slower speed than this counts as "from rest" when a start is chosen (m/s). */
export const FROM_REST = 0.5
/** The spring snaps onto rest below this speed (m/s) when it is heading for zero, and onto its target when it is this close. */
const SNAP_REST = 0.03
const SNAP_TARGET = 1e-4

/** The state of the speed spring: the value, its rate of change (m/s^2), the target and the smooth time in use. */
export interface SpeedSpring {
  v: number
  a: number
  target: number
  T: number
}

export function newSpring(): SpeedSpring {
  return { v: 0, a: 0, target: 0, T: SMOOTH_TIME.stop }
}

/**
 * Aim the spring at `target`. A new target picks its smooth time: `stop` for zero, `start` from (nearly) rest, `shift` otherwise; `kind`
 * overrides it (a reversal's slow-down is a stop-like change). The same target again changes nothing.
 */
export function retarget(s: SpeedSpring, target: number, kind?: SpeedChange): void {
  if (target === s.target && kind === undefined) return
  if (target === s.target) {
    s.T = SMOOTH_TIME[kind!]
    return
  }
  s.target = target
  if (kind !== undefined) s.T = SMOOTH_TIME[kind]
  else if (target === 0) s.T = SMOOTH_TIME.stop
  else if (Math.abs(s.v) < FROM_REST) s.T = SMOOTH_TIME.start
  else s.T = SMOOTH_TIME.shift
}

/**
 * Advance the spring by `dt` seconds towards its target, exactly. Returns the DISTANCE covered in the frame (the integral of the speed over
 * it, metres, signed like the speed). Comes to an exact rest.
 */
export function stepSpring(s: SpeedSpring, dt: number): number {
  if (dt <= 0) return 0
  const w = 2 / Math.max(s.T, 1e-4)
  const target = s.target
  const e0 = s.v - target
  const q = s.a + w * e0
  const E = Math.exp(-w * dt)
  const dist = target * dt + (e0 * (1 - E)) / w + (q * (1 - (1 + w * dt) * E)) / (w * w)
  s.v = target + (e0 + q * dt) * E
  s.a = (s.a - w * q * dt) * E
  if (target === 0) {
    if (Math.abs(s.v) < SNAP_REST) {
      s.v = 0
      s.a = 0
    }
  } else if (Math.abs(s.v - target) < SNAP_TARGET && Math.abs(s.a) < 1e-3) {
    s.v = target
    s.a = 0
  }
  return dist
}

/**
 * How far the spring would still travel if its target became zero right now: the closed form of the rest of a critically damped stop,
 * `v T + a T^2 / 4` (T the stop smooth time), signed like the speed. Never past rest (a hard deceleration cannot reverse it).
 */
export function restDistance(s: SpeedSpring): number {
  const T = SMOOTH_TIME.stop
  const d = s.v * T + (s.a * T * T) / 4
  return s.v >= 0 ? (d > 0 ? d : 0) : d < 0 ? d : 0
}

/** The angle between two unit directions (0..pi). */
export function angleBetween(ax: number, az: number, bx: number, bz: number): number {
  return Math.abs(angleDelta(Math.atan2(ax, az), Math.atan2(bx, bz)))
}

/**
 * Turn the unit direction (dx, dz) towards (wx, wz) by at most `maxStep` radians. Writes the new unit direction into `out` and returns the
 * angle that is still left (radians).
 */
export function turnDirection(dx: number, dz: number, wx: number, wz: number, maxStep: number, out: Planar): number {
  const from = Math.atan2(dx, dz)
  const diff = angleDelta(from, Math.atan2(wx, wz))
  const step = clamp(diff, -maxStep, maxStep)
  const to = from + step
  out.x = Math.sin(to)
  out.z = Math.cos(to)
  return Math.abs(diff) - Math.abs(step)
}

/**
 * Turn the body towards `target` (radians) with an exponential approach and a speed limit, so a quarter turn takes about a tenth
 * of a second and a U-turn a little over a fifth. Returns the new heading. (Classic scheme: the body faces where it goes.)
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
