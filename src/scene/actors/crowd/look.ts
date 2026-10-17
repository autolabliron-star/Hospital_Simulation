// Ported from Waltz City (src/scene/actors/crowd/look.ts). W1: the eyes follow the same aim (`eyeYaw`, `eyePitch`): they lead the head and cover
// what the neck cannot turn to.
/**
 * Head look-at with smoothing and limits (the crowd's version of LookAt.ts, which works on skinned bones).
 *
 * The simulation hands out a world point (`lookAtTargets`) while somebody is glancing at the player or
 * facing a conversation partner, and nothing the rest of the time. Turning the head straight to that
 * point would snap the moment the point appears or vanishes, so the aim goes through a critically damped
 * spring, is clamped to what a neck can do (about 70 degrees to the side, 30 up, 25 down), and its
 * influence fades in and out. A target more than 125 degrees round the back counts as "behind me" and the
 * head relaxes to the animated pose rather than wringing its neck.
 *
 * The eyes (W1) look at the same point. They move faster than the head and are limited to what an eye can do (about 30 degrees to the side,
 * 18 up and down), and they take up the difference between where the target is and where the head already points: when the target appears
 * the eyes get there first and the head follows; once the head is on target the eyes are centred in it; a target 100 degrees round, which
 * the neck cannot reach (70), leaves the eyes turned 30 degrees.
 */
import { clamp, smoothDamp, wrapPi } from './math'

export const LOOK = {
  maxYaw: (70 * Math.PI) / 180,
  maxPitchUp: (30 * Math.PI) / 180,
  maxPitchDown: (25 * Math.PI) / 180,
  giveUpYaw: (125 * Math.PI) / 180,
  smoothTime: 0.16,
  maxSpeed: 8,
  blendTime: 0.14,
} as const

/** Limits and speed of the eyes: radians, and 1 / seconds. */
export const EYE = {
  maxYaw: (32 * Math.PI) / 180,
  maxPitch: (18 * Math.PI) / 180,
  rate: 22,
} as const

export interface HeadLook {
  /** Smoothed aim relative to the chest's facing, radians. */
  yaw: number
  pitch: number
  /** How much of the aim is applied: 0 = the animated head, 1 = on target. */
  weight: number
  vYaw: { v: number }
  vPitch: { v: number }
  vWeight: { v: number }
  /** Where the eyes look relative to the head's own facing (W1): radians, + yaw to the left, + pitch up. */
  eyeYaw: number
  eyePitch: number
}

export function createHeadLook(): HeadLook {
  return { yaw: 0, pitch: 0, weight: 0, vYaw: { v: 0 }, vPitch: { v: 0 }, vWeight: { v: 0 }, eyeYaw: 0, eyePitch: 0 }
}

/**
 * @param relYaw  direction of the target round the vertical, relative to the chest's facing (+ = to the left)
 * @param pitch   elevation of the target seen from the head (+ = up)
 * @param hasTarget false when the simulation gave no target this frame
 */
export function updateHeadLook(s: HeadLook, dt: number, relYaw: number, pitch: number, hasTarget: boolean): void {
  dt = clamp(dt, 0, 0.1)
  const yaw = wrapPi(relYaw)
  const usable = hasTarget && Math.abs(yaw) <= LOOK.giveUpYaw
  if (usable) {
    if (s.weight < 1e-3) {
      // waking up from nothing: start from the animated pose so the head does not swing from some stale angle
      s.yaw = 0
      s.pitch = 0
      s.vYaw.v = 0
      s.vPitch.v = 0
    }
    const wantYaw = clamp(yaw, -LOOK.maxYaw, LOOK.maxYaw)
    const wantPitch = clamp(pitch, -LOOK.maxPitchDown, LOOK.maxPitchUp)
    s.yaw = smoothDamp(s.yaw, wantYaw, s.vYaw, LOOK.smoothTime, LOOK.maxSpeed, dt)
    s.pitch = smoothDamp(s.pitch, wantPitch, s.vPitch, LOOK.smoothTime, LOOK.maxSpeed, dt)
  }
  const w = smoothDamp(s.weight, usable ? 1 : 0, s.vWeight, LOOK.blendTime, 1 / LOOK.blendTime, dt)
  s.weight = clamp(w, 0, 1)
  if (!usable && s.weight < 1e-3) {
    s.weight = 0
    s.vWeight.v = 0
  }
  // the eyes: what is left between the target and where the head points now
  const eyeYaw = usable ? clamp(yaw - s.yaw * s.weight, -EYE.maxYaw, EYE.maxYaw) : 0
  const eyePitch = usable ? clamp(pitch - s.pitch * s.weight, -EYE.maxPitch, EYE.maxPitch) : 0
  const k = 1 - Math.exp(-EYE.rate * dt)
  s.eyeYaw += (eyeYaw - s.eyeYaw) * k
  s.eyePitch += (eyePitch - s.eyePitch) * k
  if (!usable && Math.abs(s.eyeYaw) + Math.abs(s.eyePitch) < 1e-4) {
    s.eyeYaw = 0
    s.eyePitch = 0
  }
}

/** The head's yaw offset right now (aim times weight). */
export const lookYaw = (s: HeadLook): number => s.yaw * s.weight
export const lookPitch = (s: HeadLook): number => s.pitch * s.weight
