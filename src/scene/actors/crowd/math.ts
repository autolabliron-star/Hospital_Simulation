// Template from Waltz City (src/scene/actors/crowd/math.ts). Needed by gait.ts; adjust imports to your project.
/**
 * Small, allocation-free maths for the crowd rig: scalar helpers, deterministic hashing and noise, and
 * 3x4 affine matrices stored row-major in plain typed arrays:
 *
 *     [ r00 r01 r02 tx ]   index 0..3
 *     [ r10 r11 r12 ty ]   index 4..7
 *     [ r20 r21 r22 tz ]   index 8..11
 *
 * The same 12 floats go straight into the pose texture (three RGBA texels per matrix), so the vertex
 * shader reads exactly what the CPU wrote. Nothing in here touches three.js or the DOM, so it is unit
 * tested in plain node.
 *
 * Conventions (same as the simulation): Y up, heading 0 faces +Z, positive heading turns towards +X.
 * In a character's own frame +X is its left hand, +Z forward.
 */

export const TAU = Math.PI * 2

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Hermite smoothstep between edges a and b. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Perlin's smootherstep on [0, 1]: zero first and second derivative at both ends. */
export function smoother01(t: number): number {
  const x = clamp01(t)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a: number): number {
  let x = (a + Math.PI) % TAU
  if (x < 0) x += TAU
  return x - Math.PI
}

/** Frame-rate independent exponential approach: `lambda` is 1 / time constant. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt)
}

/** Move `current` towards `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current
  return Math.abs(d) <= maxDelta ? target : current + Math.sign(d) * maxDelta
}

// ---------------------------------------------------------------------------------------------
// Deterministic randomness: a person looks and moves the same every run
// ---------------------------------------------------------------------------------------------

/** FNV-1a 32 bit hash of a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Uniform [0, 1) value number `k` of the stream seeded by `h`. Stateless: call with any k, in any order. */
export function rnd(h: number, k: number): number {
  let x = (h ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

/** Gaussian-ish value (sum of 3 uniforms), mean 0, sd about 0.5, within [-1.5, 1.5]. */
export function rndSoft(h: number, k: number): number {
  return rnd(h, k) + rnd(h, k + 977) + rnd(h, k + 1951) - 1.5
}

/**
 * Smooth pseudo-random signal in about [-1, 1]: three sines with incommensurate frequencies and
 * seed-derived phases. Cheap, deterministic, continuous, never repeats noticeably. Used for idle sway,
 * head drift and gesture envelopes, so no two people move in sync.
 */
export function noise1(t: number, seed: number): number {
  const p1 = rnd(seed, 1) * TAU
  const p2 = rnd(seed, 2) * TAU
  const p3 = rnd(seed, 3) * TAU
  return 0.5 * Math.sin(t * 0.83 + p1) + 0.3 * Math.sin(t * 1.37 + p2) + 0.2 * Math.sin(t * 2.11 + p3)
}

// ---------------------------------------------------------------------------------------------
// 3x4 affine matrices
// ---------------------------------------------------------------------------------------------

export type Mat = Float64Array | Float32Array

export const MAT = 12

/** Identity at offset `o`. */
export function setIdentity(m: Mat, o: number): void {
  m[o] = 1
  m[o + 1] = 0
  m[o + 2] = 0
  m[o + 3] = 0
  m[o + 4] = 0
  m[o + 5] = 1
  m[o + 6] = 0
  m[o + 7] = 0
  m[o + 8] = 0
  m[o + 9] = 0
  m[o + 10] = 1
  m[o + 11] = 0
}

/** All zero: a degenerate matrix, used to hide an optional part (a skirt on someone in trousers). */
export function setZero(m: Mat, o: number): void {
  for (let i = 0; i < MAT; i++) m[o + i] = 0
}

export function copyMat(dst: Mat, d: number, src: Mat, s: number): void {
  for (let i = 0; i < MAT; i++) dst[d + i] = src[s + i]
}

/**
 * Rotation Ry(yaw) * Rx(pitch) * Rz(roll) with zero translation: roll is applied to a vector first, yaw
 * last. Natural for the torso: yaw about the vertical spine, then lean forward, then lean sideways.
 */
export function setRotYXZ(m: Mat, o: number, yaw: number, pitch: number, roll: number): void {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cz = Math.cos(roll)
  const sz = Math.sin(roll)
  m[o] = cy * cz + sy * sp * sz
  m[o + 1] = -cy * sz + sy * sp * cz
  m[o + 2] = sy * cp
  m[o + 3] = 0
  m[o + 4] = cp * sz
  m[o + 5] = cp * cz
  m[o + 6] = -sp
  m[o + 7] = 0
  m[o + 8] = -sy * cz + cy * sp * sz
  m[o + 9] = sy * sz + cy * sp * cz
  m[o + 10] = cy * cp
  m[o + 11] = 0
}

/**
 * Rotation Rx(pitch) * Rz(roll) * Ry(twist), zero translation. For a limb that hangs along -Y: `twist`
 * spins it about its own axis first, `roll` swings it sideways, `pitch` swings it about the X axis (a
 * positive pitch moves the end of a hanging limb backwards, so callers pass the negative of "forward").
 */
export function setRotXZY(m: Mat, o: number, pitch: number, roll: number, twist: number): void {
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cz = Math.cos(roll)
  const sz = Math.sin(roll)
  const cy = Math.cos(twist)
  const sy = Math.sin(twist)
  m[o] = cz * cy
  m[o + 1] = -sz
  m[o + 2] = cz * sy
  m[o + 3] = 0
  m[o + 4] = cp * sz * cy + sp * sy
  m[o + 5] = cp * cz
  m[o + 6] = cp * sz * sy - sp * cy
  m[o + 7] = 0
  m[o + 8] = sp * sz * cy - cp * sy
  m[o + 9] = sp * cz
  m[o + 10] = sp * sz * sy + cp * cy
  m[o + 11] = 0
}

/** out = a * b (apply b first, then a). `out` may alias neither input. */
export function mul(out: Mat, o: number, a: Mat, ao: number, b: Mat, bo: number): void {
  const a00 = a[ao]
  const a01 = a[ao + 1]
  const a02 = a[ao + 2]
  const a03 = a[ao + 3]
  const a10 = a[ao + 4]
  const a11 = a[ao + 5]
  const a12 = a[ao + 6]
  const a13 = a[ao + 7]
  const a20 = a[ao + 8]
  const a21 = a[ao + 9]
  const a22 = a[ao + 10]
  const a23 = a[ao + 11]
  const b00 = b[bo]
  const b01 = b[bo + 1]
  const b02 = b[bo + 2]
  const b03 = b[bo + 3]
  const b10 = b[bo + 4]
  const b11 = b[bo + 5]
  const b12 = b[bo + 6]
  const b13 = b[bo + 7]
  const b20 = b[bo + 8]
  const b21 = b[bo + 9]
  const b22 = b[bo + 10]
  const b23 = b[bo + 11]
  out[o] = a00 * b00 + a01 * b10 + a02 * b20
  out[o + 1] = a00 * b01 + a01 * b11 + a02 * b21
  out[o + 2] = a00 * b02 + a01 * b12 + a02 * b22
  out[o + 3] = a00 * b03 + a01 * b13 + a02 * b23 + a03
  out[o + 4] = a10 * b00 + a11 * b10 + a12 * b20
  out[o + 5] = a10 * b01 + a11 * b11 + a12 * b21
  out[o + 6] = a10 * b02 + a11 * b12 + a12 * b22
  out[o + 7] = a10 * b03 + a11 * b13 + a12 * b23 + a13
  out[o + 8] = a20 * b00 + a21 * b10 + a22 * b20
  out[o + 9] = a20 * b01 + a21 * b11 + a22 * b21
  out[o + 10] = a20 * b02 + a21 * b12 + a22 * b22
  out[o + 11] = a20 * b03 + a21 * b13 + a22 * b23 + a23
}

/** m = m * T(x, y, z): move along the matrix's own axes (child joint offset in the parent's frame). */
export function translateLocal(m: Mat, o: number, x: number, y: number, z: number): void {
  m[o + 3] += m[o] * x + m[o + 1] * y + m[o + 2] * z
  m[o + 7] += m[o + 4] * x + m[o + 5] * y + m[o + 6] * z
  m[o + 11] += m[o + 8] * x + m[o + 9] * y + m[o + 10] * z
}

/** Set the translation part. */
export function setTranslation(m: Mat, o: number, x: number, y: number, z: number): void {
  m[o + 3] = x
  m[o + 7] = y
  m[o + 11] = z
}

/** m = m * diag(sx, sy, sz): scale the part's own geometry (after its rotation, so no shear). */
export function scaleLocal(m: Mat, o: number, sx: number, sy: number, sz: number): void {
  m[o] *= sx
  m[o + 4] *= sx
  m[o + 8] *= sx
  m[o + 1] *= sy
  m[o + 5] *= sy
  m[o + 9] *= sy
  m[o + 2] *= sz
  m[o + 6] *= sz
  m[o + 10] *= sz
}

/** Transform the point (x, y, z) by the matrix; writes into `out` (3 floats from `oo`). */
export function transformPoint(m: Mat, o: number, x: number, y: number, z: number, out: Mat | number[], oo = 0): void {
  out[oo] = m[o] * x + m[o + 1] * y + m[o + 2] * z + m[o + 3]
  out[oo + 1] = m[o + 4] * x + m[o + 5] * y + m[o + 6] * z + m[o + 7]
  out[oo + 2] = m[o + 8] * x + m[o + 9] * y + m[o + 10] * z + m[o + 11]
}

/** True if every one of the 12 values is a finite number. */
export function isFiniteMat(m: Mat, o: number): boolean {
  for (let i = 0; i < MAT; i++) if (!Number.isFinite(m[o + i])) return false
  return true
}

/** Critically damped spring step (SmoothDamp). `vel` is a one-element carrier so it can live in a state object. */
export function smoothDamp(current: number, target: number, vel: { v: number }, smoothTime: number, maxSpeed: number, dt: number): number {
  if (dt <= 0) return current
  const omega = 2 / Math.max(1e-4, smoothTime)
  const x = omega * dt
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  let change = current - target
  const maxChange = maxSpeed * smoothTime
  change = clamp(change, -maxChange, maxChange)
  const adjusted = current - change
  const temp = (vel.v + omega * change) * dt
  vel.v = (vel.v - omega * temp) * e
  let out = adjusted + (change + temp) * e
  if (target - current > 0 === out > target) {
    out = target
    vel.v = (out - target) / dt
  }
  return out
}
