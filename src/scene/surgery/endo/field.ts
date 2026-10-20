/**
 * R3 (endoscope): the small maths the bakes share: an integer hash, seeded value noise on a 256 x 256 lattice (quintic interpolation, wrapping), fbm and
 * ridged fbm, Worley cells (for fat lobules and follicles), and the signed distances of the shapes the anatomy is drawn with. Pure: no canvas, no three.js,
 * no `Math.random` (every value is a function of its seed), so a plate bakes identically in node and in the browser.
 *
 * Everything here runs per pixel of a bake (hundreds of thousands of times): nothing allocates, results that are more than one number go into a caller's
 * object.
 */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
export const mix = (a: number, b: number, k: number): number => a + (b - a) * k

/** Hermite smoothstep from `e0` to `e1` (either order). */
export function smooth(e0: number, e1: number, x: number): number {
  const u = clamp01((x - e0) / (e1 - e0))
  return u * u * (3 - 2 * u)
}

/** A 32-bit unsigned integer hash of (seed, a, b). */
export function hash32(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return (h ^ (h >>> 15)) >>> 0
}

/** The same hash to [0, 1). */
export function hash01(seed: number, a: number, b: number): number {
  return hash32(seed, a, b) / 4294967296
}

const N = 256
const MASK = N - 1

/** Seeded random values on a wrapping 256 x 256 lattice: the base of every noise here. */
export class Lattice {
  readonly v = new Float32Array(N * N)
  constructor(readonly seed: number) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) this.v[y * N + x] = hash01(seed, x, y)
  }
}

/** Value noise in [0, 1]: one lattice cell per unit, quintic fade. */
export function vnoise(L: Lattice, x: number, y: number): number {
  const fx = Math.floor(x)
  const fy = Math.floor(y)
  const tx = x - fx
  const ty = y - fy
  const ux = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
  const uy = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
  const x0 = fx & MASK
  const y0 = (fy & MASK) * N
  const x1 = (fx + 1) & MASK
  const y1 = ((fy + 1) & MASK) * N
  const v = L.v
  const a = v[y0 + x0] + (v[y0 + x1] - v[y0 + x0]) * ux
  const b = v[y1 + x0] + (v[y1 + x1] - v[y1 + x0]) * ux
  return a + (b - a) * uy
}

/** Fractal value noise in about [0, 1]: `oct` octaves, each twice the frequency and half the weight (rotated a little so the lattice never shows). */
export function fbm(L: Lattice, x: number, y: number, oct: number): number {
  let sum = 0
  let amp = 0.5
  let px = x
  let py = y
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(L, px, py)
    // x2 and a turn of about 37 degrees, plus an offset per octave
    const nx = 1.6 * px - 1.2 * py + 17.3
    const ny = 1.2 * px + 1.6 * py + 5.1
    px = nx
    py = ny
    amp *= 0.5
  }
  // the weights add up to 1 - 2^-oct
  return sum / (1 - amp * 2)
}

/** Ridged noise: 1 on the zero crossings of the noise, falling away on both sides (thin, branching lines: vessels, fibres). */
export function ridge(L: Lattice, x: number, y: number, oct: number): number {
  const n = fbm(L, x, y, oct)
  return 1 - Math.abs(n - 0.5) * 2
}

/** One Worley sample: the nearest and second-nearest feature points' distances (in cells), the nearest cell's id hash, and its point. */
export interface Cell {
  f1: number
  f2: number
  id: number
  px: number
  py: number
}

/** Worley (cellular) noise: one jittered feature point per unit cell, `jitter` 0..1 of the cell. Writes into `out`. */
export function worley(seed: number, x: number, y: number, jitter: number, out: Cell): Cell {
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  let f1 = 9
  let f2 = 9
  let id = 0
  let bx = 0
  let by = 0
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i
      const gy = cy + j
      // one hash per cell: its low 11 bits jitter x, the next 11 jitter y, the top 10 are the cell's id
      const hv = hash32(seed, gx, gy)
      const px = gx + 0.5 + ((hv & 2047) / 2047 - 0.5) * jitter
      const py = gy + 0.5 + (((hv >>> 11) & 2047) / 2047 - 0.5) * jitter
      const ddx = px - x
      const ddy = py - y
      const d = Math.sqrt(ddx * ddx + ddy * ddy)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = (hv >>> 22) / 1023
        bx = px
        by = py
      } else if (d < f2) f2 = d
    }
  }
  out.f1 = f1
  out.f2 = f2
  out.id = id
  out.px = bx
  out.py = by
  return out
}

// ---------------------------------------------------------------------------------------------
// Signed distances (negative inside), in plate units
// ---------------------------------------------------------------------------------------------

/** An ellipse at (cx, cy) with radii (rx, ry) turned by `rot`: an approximate distance (exact on the axes), good for soft edges and domes. */
export function sdEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number, rot: number): number {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const dx = x - cx
  const dy = y - cy
  const u = (c * dx + s * dy) / rx
  const v = (-s * dx + c * dy) / ry
  const k = Math.sqrt(u * u + v * v)
  if (k < 1e-6) return -Math.min(rx, ry)
  // the implicit value over its gradient's length: a first-order distance that is right at the rim, the part a soft edge needs
  const gu = u / rx
  const gv = v / ry
  const g = Math.sqrt(gu * gu + gv * gv) / k
  return (k - 1) / g
}

/** Where a point lies against a polyline: the distance to it and how far along it (0..1 of its length) the nearest point is. */
export interface OnLine {
  d: number
  t: number
}

/** The distance from (x, y) to a polyline given as [x0, y0, x1, y1, ...] with its cumulative lengths `acc` (acc[0] = 0, last = the total). */
export function distPolyline(x: number, y: number, pts: ArrayLike<number>, acc: ArrayLike<number>, out: OnLine): OnLine {
  let best = 1e9
  let bestT = 0
  const n = pts.length / 2
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2]
    const ay = pts[i * 2 + 1]
    const bx = pts[i * 2 + 2]
    const by = pts[i * 2 + 3]
    const ex = bx - ax
    const ey = by - ay
    const l2 = ex * ex + ey * ey
    let k = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0
    k = k < 0 ? 0 : k > 1 ? 1 : k
    const qx = x - ax - ex * k
    const qy = y - ay - ey * k
    const d = Math.sqrt(qx * qx + qy * qy)
    if (d < best) {
      best = d
      bestT = acc[i] + (acc[i + 1] - acc[i]) * k
    }
  }
  out.d = best
  out.t = bestT / acc[n - 1]
  return out
}

/** The cumulative lengths of a polyline [x0, y0, x1, y1, ...]. */
export function polylineLengths(pts: ArrayLike<number>): Float64Array {
  const n = pts.length / 2
  const acc = new Float64Array(n)
  for (let i = 1; i < n; i++) acc[i] = acc[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1])
  return acc
}
