/**
 * How a hanging MedPod moves on its own (pure maths, no three.js, no allocation, tested in node):
 *
 *   sway     the body is a pendulum on the rail's bogie. Speeding up or braking (along the rail) swings it back or forward
 *            (pitch); a turn swings it outwards (roll). Each axis is a damped spring chasing the angle its acceleration
 *            "wants" (a / g, taken gently and soft-limited to a few degrees), so a hard stop rocks the pod a couple of times and
 *            it settles in about two seconds. Integrated in SIM time with small sub-steps: it freezes when the sim is paused
 *            and runs faster at 2x and 4x without ever going unstable.
 *   dock     a pod that is delivering or loading is held by its dock clamp: a stiffer, critically damped pendulum, so the sway of
 *            the stop dies within about half a second (a funnel waits 1 cm under a pod at a drawer).
 *   hatches  the bottom hatch is open for the whole of `delivering` (over a drawer's funnel), eased in 0.2 s and closed again on
 *            undock; the side hatch is open while the pod is loading (beside the MedVend). A sim-driven open amount can replace
 *            `bottomHatchWants` / `sideHatchWants` later.
 */
import { ROBOT } from '@/sim/places'
import type { PodState } from '@/sim/types'

export const SWAY = {
  /** The pendulum arm: from the pivot (the rail underside) to the middle of the body (m). */
  arm: ROBOT.rail.undersideY - (ROBOT.podBottomY + ROBOT.podTopY) / 2,
  g: 9.81,
  /** Damping ratio: about 0.3 swings a couple of times and settles in roughly two seconds. */
  damping: 0.3,
  /** Share of the full "lag" angle (acceleration / g) the body takes: a gentle hang. */
  gain: 0.55,
  /** Largest target angle (rad, about 4.3 degrees); the first overshoot can add a little, never more than `peak`. */
  max: 0.075,
  peak: 0.1,
  /** Sub-step of the spring integration (s of sim time). */
  substep: 1 / 60,
  /** The dock clamp: the spring is this many times stiffer (twice the frequency) and critically damped. */
  dockStiffness: 4,
  dockDamping: 1,
} as const

/** The angle (rad) an acceleration `accel` (m/s^2) holds the body at, soft-limited by tanh so it never exceeds `SWAY.max`. */
export function swayTarget(accel: number): number {
  const raw = (SWAY.gain * accel) / SWAY.g
  return SWAY.max * Math.tanh(raw / SWAY.max)
}

const OMEGA = Math.sqrt(SWAY.g / SWAY.arm)
const OMEGA_DOCK = OMEGA * Math.sqrt(SWAY.dockStiffness)

/** True while the dock clamp holds the pod: stopped for a delivery, stopped for loading, or parked in the rank. */
export function isDocked(state: PodState, speed: number): boolean {
  return state === 'delivering' || state === 'loading' || (state === 'charging' && speed < 0.02)
}

/**
 * Advance one axis of sway by `dt` seconds of sim time towards `target`. `state[k]` is the angle and `state[k + 1]` its rate.
 * `dt` <= 0 changes nothing (a paused sim freezes the pods mid-swing). `docked` swaps in the stiff, critically damped dock clamp.
 */
export function stepSway(state: Float32Array, k: number, target: number, dt: number, docked = false): void {
  if (!(dt > 0)) return
  const n = Math.ceil(dt / SWAY.substep)
  const h = dt / n
  const w = docked ? OMEGA_DOCK : OMEGA
  const damp = 2 * (docked ? SWAY.dockDamping : SWAY.damping) * w
  let a = state[k]
  let v = state[k + 1]
  for (let i = 0; i < n; i++) {
    v += (w * w * (target - a) - damp * v) * h
    a += v * h
  }
  state[k] = a
  state[k + 1] = v
}

/** An angle difference wrapped into [-PI, PI]. */
export function wrapPi(d: number): number {
  const t = Math.PI * 2
  return d - t * Math.round(d / t)
}

/** Sideways acceleration (m/s^2) of a pod doing `speed` m/s whose heading turned by `dHeading` rad in `dt` s (positive: turning towards local +x). */
export function lateralAccel(speed: number, dHeading: number, dt: number): number {
  return dt > 0 ? (speed * wrapPi(dHeading)) / dt : 0
}

/** Seconds a hatch takes to open or close (sim time): the bottom one is quick (the first pack leaves about 0.4 s into a delivery), the side one a calmer swing. */
export const HATCH_SECONDS = { bottom: 0.2, side: 0.5 } as const

/** 1 while the bottom hatch should be open (the pod is delivering over a drawer's funnel), else 0. */
export function bottomHatchWants(state: PodState): number {
  return state === 'delivering' ? 1 : 0
}

/** 1 while the side hatch should be open (the pod is loading beside the MedVend), else 0. */
export function sideHatchWants(state: PodState): number {
  return state === 'loading' ? 1 : 0
}

/** Move `open` (0..1) towards `target` over `dt` seconds of sim time, a full stroke taking `seconds`; reaches the target exactly. */
export function moveHatch(open: number, target: number, dt: number, seconds: number): number {
  const step = dt / seconds
  if (target > open) return Math.min(target, open + step)
  return Math.max(target, open - step)
}

/** Ease in and out: the shown opening for a linear 0..1 amount. */
export function easeHatch(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}
