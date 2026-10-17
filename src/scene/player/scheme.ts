/**
 * How the keys steer you, as plain functions on plain numbers (no three.js, no stores, no DOM), so the two walk schemes can be
 * tested on their own. Ported from Waltz City's `scheme.ts` (without the touch scheme).
 *
 *   easy     (the default) W and S walk forward and back along the way you FACE; A and D TURN you (about 140 degrees a second, 200
 *            while running). The camera follows behind by itself (chaseCamera.ts), so the view turns with you and the mouse is
 *            only an extra look around.
 *   classic  GTA: W A S D move RELATIVE TO THE CAMERA, which you steer with the mouse: W walks the way the camera faces, S back
 *            towards it, D to the right of the picture. Your body turns to face where it goes (`motion.facingFromVelocity`).
 *            Selected with `?controls=classic`.
 *
 * Headings are compass-style radians, atan2(dx, dz): 0 faces +Z, pi / 2 faces +X, pi faces north (-Z). Turning RIGHT (D) is
 * clockwise seen from above, which makes the heading SMALLER; turning left makes it larger. (The mouse works the same way:
 * dragging right turns the view right.) The right-hand side of someone facing `yaw` is (-cos yaw, sin yaw).
 */
import { clamp, wrapAngle } from './chaseMath'
import { EASY } from './tuning'

const DEG = Math.PI / 180

export type ControlScheme = 'easy' | 'classic'

/** The scheme you get with no `?controls=` in the URL. */
export const DEFAULT_SCHEME: ControlScheme = 'easy'

/** The scheme a URL's query string asks for (`?controls=classic`), else the default. Anything it does not know is the default. */
export function schemeFromSearch(search: string): ControlScheme {
  const asked = new URLSearchParams(search).get('controls')
  return asked !== null && asked.trim().toLowerCase() === 'classic' ? 'classic' : DEFAULT_SCHEME
}

/** What the keys ask for this frame, after the scheme has read them. */
export interface Steering {
  /** Wanted walking direction, a unit vector, or 0, 0 for none. */
  dirX: number
  dirZ: number
  /** Turn input for the body: -1 left, 0 none, +1 right. Only the easy scheme turns the body with keys. */
  turn: number
  /** Share of the walking speed asked for: 1 going forward, `EASY.backSpeedFactor` backing up, 0 standing. */
  speedFactor: number
  /** Backing up: no running. */
  backing: boolean
  /** True when any key is asking for movement or a turn. */
  active: boolean
}

export function newSteering(): Steering {
  return { dirX: 0, dirZ: 0, turn: 0, speedFactor: 0, backing: false, active: false }
}

/**
 * Turn the two key axes (`forward` +1 for W, -1 for S; `right` +1 for D, -1 for A) into a steering request. `heading` is the way you
 * face and `cameraYaw` the way the camera faces. In the classic scheme a diagonal is normalised, so two keys never walk faster than one.
 */
export function routeInput(scheme: ControlScheme, forward: number, right: number, heading: number, cameraYaw: number, out: Steering = newSteering()): Steering {
  out.active = forward !== 0 || right !== 0
  if (scheme === 'easy') {
    // (a plain 0, not -0, when only A or D is held)
    out.dirX = forward === 0 ? 0 : Math.sin(heading) * forward
    out.dirZ = forward === 0 ? 0 : Math.cos(heading) * forward
    out.turn = right
    out.backing = forward < 0
    out.speedFactor = forward > 0 ? 1 : forward < 0 ? EASY.backSpeedFactor : 0
    return out
  }
  out.turn = 0
  out.backing = false
  const len = Math.hypot(forward, right)
  if (len <= 0) {
    out.dirX = 0
    out.dirZ = 0
    out.speedFactor = 0
    return out
  }
  const fx = Math.sin(cameraYaw)
  const fz = Math.cos(cameraYaw)
  out.dirX = (fx * forward + -fz * right) / len
  out.dirZ = (fz * forward + fx * right) / len
  out.speedFactor = 1
  return out
}

/** The turning state of the body: the current rate, radians per second of HEADING (positive turns left). */
export interface TurnState {
  rate: number
}

export function newTurn(): TurnState {
  return { rate: 0 }
}

/** The fastest turn, radians per second. */
export function maxTurnRate(running: boolean): number {
  return (running ? EASY.sprintTurnDegPerSecond : EASY.turnDegPerSecond) * DEG
}

/**
 * One frame of turning: returns the change of heading (radians, add it to the heading) for the turn input (-1 left, +1 right). A key
 * press starts the turn at once (`EASY.turnKick` of the full rate on the first frame, so there is never a dead frame), the rate then
 * ramps up over `EASY.turnRampSeconds`, and letting go stops it in about `EASY.turnReleaseSeconds`, ending in an exact stop.
 */
export function stepTurn(s: TurnState, turn: number, running: boolean, dt: number): number {
  const d = Math.max(dt, 0)
  const target = -clamp(turn, -1, 1) * maxTurnRate(running)
  if (target === 0) {
    s.rate *= Math.exp(-d / EASY.turnReleaseSeconds)
    if (Math.abs(s.rate) < 1e-3) s.rate = 0
  } else {
    const kick = target * EASY.turnKick
    // starting from rest, or reversing: begin at the kick rate, never slower
    if (Math.sign(s.rate) !== Math.sign(target) || Math.abs(s.rate) < Math.abs(kick)) s.rate = kick
    s.rate += (target - s.rate) * (1 - Math.exp(-d / EASY.turnRampSeconds))
  }
  return s.rate * d
}

/** The heading after a frame of turning. */
export function turnedHeading(heading: number, delta: number): number {
  return wrapAngle(heading + delta)
}
