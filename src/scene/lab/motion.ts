/**
 * W4 lab: the pure motion maths of the rig (no three.js, no DOM, nothing allocated per call): lid and rotor angles, the swing of a rotor
 * bucket, probe and gripper heights, flash decay, the tube's orientation along a pipe, and the table that gives each tube in a centrifuge its
 * bucket. The rig (rig.ts) calls these every frame; the tests call them with numbers.
 */
import { LID_MAX, PROBE_Y, GRIPPER_Y, ROTOR_MAX_REV_PER_S } from './labDims'

const TAU = Math.PI * 2

export const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** Smooth 0..1 ease. */
export const ease = (t: number): number => {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

/** The lid's hinge angle (radians) for the sim's opening 0..1. */
export const lidAngle = (lid01: number): number => clamp01(lid01) * LID_MAX

/** Revolutions per second drawn for the sim's rotor speed 0..1: never above `ROTOR_MAX_REV_PER_S`, so a 60 Hz frame never aliases the rotor to a standstill. */
export const rotorRevPerS = (rpm01: number): number => clamp01(rpm01) * ROTOR_MAX_REV_PER_S

/** The rotor angle after `dt` seconds at `rpm01`, wrapped to [0, 2 pi). */
export function rotorAdvance(angle: number, rpm01: number, dt: number): number {
  const a = (angle + rotorRevPerS(rpm01) * TAU * dt) % TAU
  return a < 0 ? a + TAU : a
}

/** How far a swinging bucket has lifted from upright (0) towards horizontal (pi / 2) at this rotor speed. */
export function bucketSwing(rpm01: number): number {
  return ease((clamp01(rpm01) - 0.15) / 0.6) * (Math.PI / 2)
}

/** The probe tip's height for the analyser's dip 0..1. */
export const probeTip = (probe01: number): number => lerp(PROBE_Y.rest, PROBE_Y.dip, clamp01(probe01))
/** The gripper head's height for a stroke 0 (up) .. 1 (down on the tube). */
export const gripperTip = (stroke01: number): number => lerp(GRIPPER_Y.rest, GRIPPER_Y.down, clamp01(stroke01))

/** A flash (the camera, a ring) after `dt` more seconds: it decays linearly and is gone after `1 / rate` s. */
export const flashDecay = (level: number, dt: number, rate = 4): number => (level - dt * rate > 0 ? level - dt * rate : 0)

/** The stroke of a gripper that works while a tube is in its module: a smooth down and up at 1.6 Hz; at rest it eases back up. */
export function gripperStroke(working: boolean, phase: number): number {
  return working ? 0.5 - 0.5 * Math.cos(phase * TAU) : 0
}

/** The position of bucket `k` of `n` on a rotor of radius `r` turned by `angle`: (x, z) relative to the rotor's centre. `out` is written. */
export function bucketOffset(k: number, n: number, r: number, angle: number, out: { x: number; z: number }): { x: number; z: number } {
  const a = angle + (k * TAU) / n
  out.x = Math.cos(a) * r
  out.z = Math.sin(a) * r
  return out
}

export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

/** The rotation that turns +y (a tube's cap end) to the unit direction (dx, dy, dz). `out` is written. */
export function quatUpTo(dx: number, dy: number, dz: number, out: Quat): Quat {
  const w = 1 + dy
  if (w < 1e-6) {
    out.x = 1
    out.y = 0
    out.z = 0
    out.w = 0
    return out
  }
  // cross((0, 1, 0), d) = (dz, 0, -dx)
  const len = Math.hypot(dz, dx, w)
  out.x = dz / len
  out.y = 0
  out.z = -dx / len
  out.w = w / len
  return out
}

/** Write a Matrix4 (column-major) with position, rotation `q` and uniform scale `s` into `a` at instance `i`. */
export function composeInto(a: Float32Array, i: number, px: number, py: number, pz: number, q: Quat, s: number): void {
  const o = i * 16
  const x2 = q.x + q.x
  const y2 = q.y + q.y
  const z2 = q.z + q.z
  const xx = q.x * x2
  const xy = q.x * y2
  const xz = q.x * z2
  const yy = q.y * y2
  const yz = q.y * z2
  const zz = q.z * z2
  const wx = q.w * x2
  const wy = q.w * y2
  const wz = q.w * z2
  a[o] = (1 - (yy + zz)) * s
  a[o + 1] = (xy + wz) * s
  a[o + 2] = (xz - wy) * s
  a[o + 3] = 0
  a[o + 4] = (xy - wz) * s
  a[o + 5] = (1 - (xx + zz)) * s
  a[o + 6] = (yz + wx) * s
  a[o + 7] = 0
  a[o + 8] = (xz + wy) * s
  a[o + 9] = (yz - wx) * s
  a[o + 10] = (1 - (xx + yy)) * s
  a[o + 11] = 0
  a[o + 12] = px
  a[o + 13] = py
  a[o + 14] = pz
  a[o + 15] = 1
}

/** Collapse instance `i` (an all-zero matrix draws nothing). */
export function hideInstance(a: Float32Array, i: number): void {
  a.fill(0, i * 16, i * 16 + 16)
}

/**
 * Which bucket of which centrifuge each tube in it sits in. A tube takes the first free bucket of its centrifuge when it first shows up there and
 * keeps it until it is gone, so the others never shuffle; `sweep` (once a frame, after every tube was asked for) frees the buckets nobody asked
 * for. Fixed arrays, nothing allocated.
 */
export class BucketTable {
  private readonly owner: string[]
  private readonly stamp: Int32Array
  private frame = 1

  constructor(
    readonly centrifuges: number,
    readonly buckets: number,
  ) {
    this.owner = new Array<string>(centrifuges * buckets).fill('')
    this.stamp = new Int32Array(centrifuges * buckets)
  }

  /** The bucket of tube `id` in centrifuge `c` (assigned if new), or -1 when the centrifuge is full. */
  assign(c: number, id: string): number {
    const base = c * this.buckets
    let free = -1
    for (let k = 0; k < this.buckets; k++) {
      const o = this.owner[base + k]
      if (o === id) {
        this.stamp[base + k] = this.frame
        return k
      }
      if (free < 0 && o === '') free = k
    }
    if (free < 0) return -1
    this.owner[base + free] = id
    this.stamp[base + free] = this.frame
    return free
  }

  /** Free every bucket that was not asked for since the last sweep. */
  sweep(): void {
    for (let i = 0; i < this.owner.length; i++) if (this.owner[i] !== '' && this.stamp[i] !== this.frame) this.owner[i] = ''
    this.frame++
  }

  occupied(c: number): number {
    let n = 0
    for (let k = 0; k < this.buckets; k++) if (this.owner[c * this.buckets + k] !== '') n++
    return n
  }
}
