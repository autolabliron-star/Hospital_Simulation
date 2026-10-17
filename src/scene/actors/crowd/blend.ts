// Ported from Waltz City (src/scene/actors/crowd/blend.ts); the modes and the anim mapping are the hospital's.
/**
 * Pose modes and the blender that moves between them.
 *
 * A person is always in exactly one "mode" (relaxed, talking, pushing a chair, lying in bed, ...) but the
 * body never jumps between modes: the blender holds one weight per mode, the weights always add up to 1
 * and a change of mode moves them along a smooth curve over 0.25 s. If the mode changes again half way,
 * the new blend starts from the weights as they are right now, so nothing snaps.
 *
 * Standing, seated and lying people use the same blender; the seated and lying modes are just more entries.
 */
import type { AnimState, PropKind, SeatPose } from '@/sim/types'
import { smoothstep } from './math'

export const MODES = [
  'relaxed', // idle, walk, run, carry: the arm swing follows the real speed
  'talk', // gestures
  'wave',
  'tablet', // looking at a tablet held in front
  'give', // handing something forward
  'push', // both hands on a handle, leaning in
  'clean', // a mopping sweep
  'sit',
  'typing', // seated, hands at a keyboard
  'sitTalk',
  'sitTablet', // seated, a tablet in the lap
  'sitListen',
  'lie',
] as const
export type Mode = (typeof MODES)[number]
export const MODE_COUNT = MODES.length
export const MODE_INDEX: Readonly<Record<Mode, number>> = Object.fromEntries(MODES.map((m, i) => [m, i])) as Record<Mode, number>

/** Seconds a change of pose takes. */
export const BLEND_SECONDS = 0.25

export interface Blender {
  /** Current weight per mode. Always sums to 1. */
  weights: Float32Array
  from: Float32Array
  to: Float32Array
  /** Progress of the running blend, 0 to 1. */
  t: number
  /** Index of the mode being blended towards. */
  target: number
  duration: number
}

export function createBlender(mode: Mode, duration = BLEND_SECONDS): Blender {
  const weights = new Float32Array(MODE_COUNT)
  const from = new Float32Array(MODE_COUNT)
  const to = new Float32Array(MODE_COUNT)
  const target = MODE_INDEX[mode]
  weights[target] = 1
  from[target] = 1
  to[target] = 1
  return { weights, from, to, t: 1, target, duration }
}

/** Ask for a mode. Blending starts from the weights as they are now. A repeated request changes nothing. */
export function blendTo(b: Blender, mode: Mode): void {
  const idx = MODE_INDEX[mode]
  if (idx === b.target) return
  b.from.set(b.weights)
  b.to.fill(0)
  b.to[idx] = 1
  b.target = idx
  b.t = 0
}

/** Advance the running blend by `dt` seconds and recompute the weights. */
export function advanceBlend(b: Blender, dt: number): void {
  if (b.t < 1) b.t = Math.min(1, b.t + (b.duration > 0 ? dt / b.duration : 1))
  const e = smoothstep(0, 1, b.t)
  let sum = 0
  for (let i = 0; i < MODE_COUNT; i++) {
    const w = b.from[i] + (b.to[i] - b.from[i]) * e
    b.weights[i] = w > 0 ? w : 0
    sum += b.weights[i]
  }
  // from and to both sum to 1, so this is a no-op up to rounding; it keeps the invariant exact for tests and for hours of play
  if (sum > 0 && Math.abs(sum - 1) > 1e-7) for (let i = 0; i < MODE_COUNT; i++) b.weights[i] /= sum
  else if (sum <= 0) {
    b.weights.fill(0)
    b.weights[b.target] = 1
  }
}

export function weightSum(b: Blender): number {
  let s = 0
  for (let i = 0; i < MODE_COUNT; i++) s += b.weights[i]
  return s
}

// ---------------------------------------------------------------------------------------------
// What the simulation says -> which mode
// ---------------------------------------------------------------------------------------------

/** How the body is held: on its feet, on a seat, or flat on a bed or stretcher. */
export type Posture = 'stand' | 'sit' | 'lie'

/**
 * The posture of an entity. `anim` 'sit' / 'lie' decide first; otherwise a seat the sim put the person on
 * (`seated.pose`) does; otherwise a rider is seated in a wheelchair or lying on a stretcher.
 */
export function postureOf(anim: AnimState, seatedPose: SeatPose | undefined, riding: boolean, vehicle: string | undefined): Posture {
  // a patient in a bed with the head raised (L1 meals and visits) is a lying body with a raised torso, not a seated one
  if (seatedPose === 'recline') return 'lie'
  if (anim === 'lie') return 'lie'
  if (anim === 'sit') return 'sit'
  if (seatedPose) return seatedPose === 'lie' ? 'lie' : 'sit'
  if (riding) return vehicle === 'stretcher' ? 'lie' : vehicle === 'wheelchair' ? 'sit' : 'stand'
  return 'stand'
}

/** The mode of a person from the posture and the animation state. Walking itself is not a mode: it comes from real motion. */
export function modeFor(anim: AnimState, posture: Posture, prop: PropKind): Mode {
  if (posture === 'lie') return 'lie'
  if (posture === 'sit') {
    switch (anim) {
      case 'talk':
      case 'wave':
        return 'sitTalk'
      case 'tablet':
        return prop === 'tablet' ? 'sitTablet' : 'typing'
      default:
        return prop === 'tablet' ? 'sitTablet' : 'sit'
    }
  }
  switch (anim) {
    case 'talk':
      return 'talk'
    case 'wave':
      return 'wave'
    case 'tablet':
      return 'tablet'
    case 'give':
      return 'give'
    case 'push':
      return 'push'
    case 'clean':
      return 'clean'
    default:
      return 'relaxed'
  }
}

export const isSeatedMode = (m: Mode): boolean => m === 'sit' || m === 'typing' || m === 'sitTalk' || m === 'sitTablet' || m === 'sitListen'
